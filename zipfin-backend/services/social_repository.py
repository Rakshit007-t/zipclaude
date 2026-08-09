from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4
from hashlib import sha256
from typing import List, Optional

from fastapi import HTTPException, status
from firebase_admin import firestore
from firebase_config import get_firestore_client
from models.social_schema import (
    CommentCreate,
    CommentResponse,
    FeedResponse,
    NotificationItem,
    PostCreate,
    PostResponse,
    UserSummary,
    ReportCreate,
    ShareCreate,
)

logger = logging.getLogger(__name__)


class SocialRepository:
    """Repository managing feed posts, reels, follow graph, comments, and notifications."""

    def __init__(self):
        try:
            self.db = get_firestore_client()
        except Exception:
            self.db = None

    def create_post(self, user_id: str, payload: PostCreate) -> PostResponse:
        self._require_db()
        now_iso = datetime.now(timezone.utc).isoformat()
        post_id = f"post_{uuid4().hex[:12]}"
        
        # User profile lookup
        user_name = "ZipRIGHT Member"
        username = f"user_{user_id[:6]}"
        photo_url = None
        
        if self.db:
            try:
                user_doc = self.db.collection("users").document(user_id).get()
                if user_doc.exists:
                    udata = user_doc.to_dict() or {}
                    user_name = udata.get("displayName", user_name)
                    username = udata.get("username", username)
                    photo_url = udata.get("photoURL")
            except Exception as exc:
                logger.warning("Failed to load user for post creation: %s", exc)

        post_data = {
            "id": post_id,
            "user_id": user_id,
            "user_display_name": user_name,
            "user_username": username,
            "user_photo_url": photo_url,
            "type": payload.type,
            "caption": payload.caption,
            "media_url": payload.media_url,
            "thumbnail_url": payload.thumbnail_url,
            "tags": payload.tags,
            "linked_product_ids": payload.linked_product_ids,
            "likes_count": 0,
            "comments_count": 0,
            "shares_count": 0,
            "created_at": now_iso,
        }

        try:
            self.db.collection("posts").document(post_id).set(post_data)
        except Exception as exc:
            logger.exception("Failed writing post to Firestore")
            raise HTTPException(status_code=503, detail="Social persistence is unavailable.") from exc

        return PostResponse(
            **post_data,
            is_liked_by_me=False,
            is_saved_by_me=False,
        )

    def get_feed(self, user_id: str, post_type: Optional[str] = None, limit: int = 20) -> FeedResponse:
        posts: List[PostResponse] = []
        if self.db:
            try:
                query = self.db.collection("posts")
                if post_type:
                    query = query.where(filter=firestore.FieldFilter("type", "==", post_type))
                
                docs = query.limit(limit).get()
                for doc in docs:
                    data = doc.to_dict() or {}
                    author_id = str(data.get("user_id", ""))
                    if user_id and author_id and (self._is_blocked(user_id, author_id) or self._is_muted(user_id, author_id)):
                        continue
                    posts.append(
                        PostResponse(
                            id=doc.id,
                            user_id=data.get("user_id", ""),
                            user_display_name=data.get("user_display_name", "ZipRIGHT Member"),
                            user_username=data.get("user_username", "user"),
                            user_photo_url=data.get("user_photo_url"),
                            type=data.get("type", "post"),
                            caption=data.get("caption", ""),
                            media_url=data.get("media_url"),
                            thumbnail_url=data.get("thumbnail_url"),
                            tags=data.get("tags", []),
                            linked_product_ids=data.get("linked_product_ids", []),
                            likes_count=data.get("likes_count", 0),
                            comments_count=data.get("comments_count", 0),
                            shares_count=data.get("shares_count", 0),
                            is_liked_by_me=bool(
                                user_id and doc.reference.collection("likes").document(user_id).get().exists
                            ),
                            is_saved_by_me=False,
                            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
                        )
                    )
            except Exception as exc:
                logger.warning("Failed fetching feed from Firestore: %s", exc)

        return FeedResponse(posts=posts, has_more=False)

    def toggle_follow(self, follower_id: str, target_id: str) -> bool:
        if follower_id == target_id:
            raise HTTPException(status_code=400, detail="You cannot follow yourself.")
        self._require_db()
        target = self._public_profile(target_id)
        actor = self._public_profile(follower_id)
        if not target:
            raise HTTPException(status_code=404, detail="The requested member does not exist.")
        if not actor:
            raise HTTPException(status_code=409, detail="Create a public profile before following members.")

        following_ref = self.db.collection("users").document(follower_id).collection("following").document(target_id)
        follower_ref = self.db.collection("users").document(target_id).collection("followers").document(follower_id)
        now = datetime.now(timezone.utc).isoformat()

        @firestore.transactional
        def toggle(transaction):
            existing = following_ref.get(transaction=transaction)
            if existing.exists:
                transaction.delete(following_ref)
                transaction.delete(follower_ref)
                self._set_counts(transaction, follower_id, target_id, -1)
                return False
            # A block is evaluated by the backend, not by caller-supplied UI state.
            blocked_by_actor = self.db.collection("users").document(follower_id).collection("blocked").document(target_id).get(transaction=transaction)
            blocked_by_target = self.db.collection("users").document(target_id).collection("blocked").document(follower_id).get(transaction=transaction)
            if blocked_by_actor.exists or blocked_by_target.exists:
                raise HTTPException(status_code=403, detail="This follow is not allowed.")
            transaction.set(following_ref, self._edge(target, now))
            transaction.set(follower_ref, self._edge(actor, now))
            self._set_counts(transaction, follower_id, target_id, 1)
            return True

        try:
            is_following = toggle(self.db.transaction())
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Error updating follow relationship")
            raise HTTPException(status_code=503, detail="Could not persist follow status.") from exc
        if is_following:
            self.send_notification(recipient_id=target_id, actor_id=follower_id, notif_type="follow")
        return is_following

    def toggle_like(self, user_id: str, post_id: str) -> tuple[bool, int]:
        self._require_db()
        post_ref = self.db.collection("posts").document(post_id)
        like_ref = post_ref.collection("likes").document(user_id)

        @firestore.transactional
        def toggle(transaction):
            post = post_ref.get(transaction=transaction)
            if not post.exists:
                raise HTTPException(status_code=404, detail="Post not found.")
            data = post.to_dict() or {}
            current_count = max(0, int(data.get("likes_count", 0)))
            existing = like_ref.get(transaction=transaction)
            if existing.exists:
                transaction.delete(like_ref)
                count = max(0, current_count - 1)
                transaction.update(post_ref, {"likes_count": count})
                return False, count
            transaction.set(like_ref, {"user_id": user_id, "created_at": datetime.now(timezone.utc).isoformat()})
            count = current_count + 1
            transaction.update(post_ref, {"likes_count": count})
            return True, count

        try:
            return toggle(self.db.transaction())
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Error persisting post like")
            raise HTTPException(status_code=503, detail="Could not persist like status.") from exc

    def add_comment(self, user_id: str, post_id: str, payload: CommentCreate) -> CommentResponse:
        self._require_db()
        text = payload.text.strip()
        if not text:
            raise HTTPException(status_code=422, detail="Comment text cannot be empty.")
        post_ref = self.db.collection("posts").document(post_id)
        post = post_ref.get()
        if not post.exists:
            raise HTTPException(status_code=404, detail="Post not found.")
        profile = self._public_profile(user_id) or {}
        now = datetime.now(timezone.utc).isoformat()
        comment_id = f"cmt_{uuid4().hex[:12]}"
        comment = {
            "id": comment_id, "post_id": post_id, "user_id": user_id,
            "user_display_name": profile.get("displayName", "ZipRIGHT Member"),
            "user_username": profile.get("username", f"user_{user_id[:6]}"),
            "user_photo_url": profile.get("photoURL"), "text": text,
            "parent_comment_id": payload.parent_comment_id, "created_at": now,
        }
        if payload.parent_comment_id:
            parent = post_ref.collection("comments").document(payload.parent_comment_id).get()
            if not parent.exists:
                raise HTTPException(status_code=404, detail="Parent comment not found.")
        try:
            batch = self.db.batch()
            batch.set(post_ref.collection("comments").document(comment_id), comment)
            batch.update(post_ref, {"comments_count": firestore.Increment(1)})
            batch.commit()
        except Exception as exc:
            logger.exception("Error persisting comment")
            raise HTTPException(status_code=503, detail="Could not persist comment.") from exc
        return CommentResponse(**comment)

    def list_comments(self, post_id: str, limit: int = 100) -> List[CommentResponse]:
        self._require_db()
        post_ref = self.db.collection("posts").document(post_id)
        if not post_ref.get().exists:
            raise HTTPException(status_code=404, detail="Post not found.")
        docs = post_ref.collection("comments").order_by("created_at").limit(limit).get()
        return [CommentResponse(**(doc.to_dict() or {})) for doc in docs]

    def list_relationship(self, uid: str, relationship: str, limit: int = 100) -> List[UserSummary]:
        self._require_db()
        if relationship not in {"followers", "following"}:
            raise HTTPException(status_code=404, detail="Unknown social relationship.")
        docs = self.db.collection("users").document(uid).collection(relationship).limit(limit).get()
        return [
            UserSummary(
                uid=str((doc.to_dict() or {}).get("uid") or doc.id),
                display_name=str((doc.to_dict() or {}).get("displayName") or "ZipRIGHT Member"),
                username=str((doc.to_dict() or {}).get("username") or "member"),
                photo_url=(doc.to_dict() or {}).get("photoURL"),
            )
            for doc in docs
        ]

    def create_report(self, reporter_id: str, payload: ReportCreate) -> dict:
        self._require_db()
        target_type, target_id = payload.target_type, payload.target_id
        if target_type == "user":
            exists = bool(self._public_profile(target_id))
        elif target_type == "post":
            exists = self.db.collection("posts").document(target_id).get().exists
        else:
            # A comment ID is only meaningful inside a post in the current schema;
            # require the caller to use the immutable post/comment compound ID.
            post_id, separator, comment_id = target_id.partition(":")
            exists = bool(separator and self.db.collection("posts").document(post_id).collection("comments").document(comment_id).get().exists)
        if not exists:
            raise HTTPException(status_code=404, detail="Report target not found.")
        report_key = f"{reporter_id}:{target_type}:{target_id}"
        report_id = f"report_{sha256(report_key.encode()).hexdigest()[:24]}"
        report_ref = self.db.collection("reports").document(report_id)
        if report_ref.get().exists:
            raise HTTPException(status_code=409, detail="You have already reported this item.")
        record = {
            "id": report_id,
            "reporter_id": reporter_id,
            "target_type": target_type,
            "target_id": target_id,
            "reason": payload.reason,
            "description": (payload.description or "").strip() or None,
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            report_ref.set(record)
        except Exception as exc:
            logger.exception("Error persisting report")
            raise HTTPException(status_code=503, detail="Could not persist report.") from exc
        return record

    def share_post(self, sender_id: str, post_id: str, payload: ShareCreate) -> dict:
        self._require_db()
        if payload.recipient_uid == sender_id:
            raise HTTPException(status_code=400, detail="You cannot share a post with yourself.")
        post_ref = self.db.collection("posts").document(post_id)
        post = post_ref.get()
        if not post.exists:
            raise HTTPException(status_code=404, detail="Post not found.")
        recipient = self._public_profile(payload.recipient_uid)
        if not recipient:
            raise HTTPException(status_code=404, detail="Recipient not found.")
        if self._is_blocked(sender_id, payload.recipient_uid):
            raise HTTPException(status_code=403, detail="This share is not allowed.")
        share_id = f"share_{sha256(f'{sender_id}:{payload.recipient_uid}:{post_id}'.encode()).hexdigest()[:24]}"
        share_ref = self.db.collection("users").document(payload.recipient_uid).collection("sharedPosts").document(share_id)
        if share_ref.get().exists:
            raise HTTPException(status_code=409, detail="This post has already been shared with that member.")
        post_data = post.to_dict() or {}
        record = {
            "id": share_id, "post_id": post_id, "sender_id": sender_id,
            "recipient_id": payload.recipient_uid,
            "post_caption": post_data.get("caption", ""),
            "post_media_url": post_data.get("media_url"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            batch = self.db.batch()
            batch.set(share_ref, record)
            batch.update(post_ref, {"shares_count": firestore.Increment(1)})
            batch.commit()
        except Exception as exc:
            logger.exception("Error persisting share")
            raise HTTPException(status_code=503, detail="Could not persist share.") from exc
        self.send_notification(payload.recipient_uid, sender_id, "share", post_id)
        return record

    def set_user_preference(self, actor_id: str, target_id: str, preference: str, enabled: bool) -> bool:
        self._require_db()
        if preference not in {"blocked", "muted"}:
            raise HTTPException(status_code=404, detail="Unknown safety preference.")
        if actor_id == target_id:
            raise HTTPException(status_code=400, detail="You cannot apply this setting to yourself.")
        target = self._public_profile(target_id)
        if not target:
            raise HTTPException(status_code=404, detail="Member not found.")
        preference_ref = self.db.collection("users").document(actor_id).collection(preference).document(target_id)
        try:
            batch = self.db.batch()
            if enabled:
                batch.set(preference_ref, {"uid": target_id, "created_at": datetime.now(timezone.utc).isoformat()})
            else:
                batch.delete(preference_ref)
            if enabled and preference == "blocked":
                # A block invalidates both directions of an existing follow graph.
                for follower_id, followed_id in ((actor_id, target_id), (target_id, actor_id)):
                    following_ref = self.db.collection("users").document(follower_id).collection("following").document(followed_id)
                    follower_ref = self.db.collection("users").document(followed_id).collection("followers").document(follower_id)
                    if following_ref.get().exists:
                        batch.delete(following_ref)
                        batch.delete(follower_ref)
                        batch.set(self.db.collection("users").document(follower_id), {"followingCount": firestore.Increment(-1)}, merge=True)
                        batch.set(self.db.collection("users").document(followed_id), {"followersCount": firestore.Increment(-1)}, merge=True)
                        batch.set(self.db.collection("publicProfiles").document(follower_id), {"followingCount": firestore.Increment(-1)}, merge=True)
                        batch.set(self.db.collection("publicProfiles").document(followed_id), {"followersCount": firestore.Increment(-1)}, merge=True)
            batch.commit()
        except Exception as exc:
            logger.exception("Error updating safety preference")
            raise HTTPException(status_code=503, detail="Could not persist safety preference.") from exc
        return enabled

    def _is_blocked(self, first_uid: str, second_uid: str) -> bool:
        return (
            self.db.collection("users").document(first_uid).collection("blocked").document(second_uid).get().exists
            or self.db.collection("users").document(second_uid).collection("blocked").document(first_uid).get().exists
        )

    def _is_muted(self, viewer_uid: str, author_uid: str) -> bool:
        return self.db.collection("users").document(viewer_uid).collection("muted").document(author_uid).get().exists

    def _require_db(self) -> None:
        if not self.db:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Social persistence is unavailable.")

    def _public_profile(self, uid: str) -> dict:
        snap = self.db.collection("publicProfiles").document(uid).get()
        return snap.to_dict() or {} if snap.exists else {}

    @staticmethod
    def _edge(profile: dict, created_at: str) -> dict:
        return {"uid": profile.get("uid"), "displayName": profile.get("displayName"), "username": profile.get("username"), "photoURL": profile.get("photoURL"), "followedAt": created_at}

    def _set_counts(self, transaction, follower_id: str, target_id: str, direction: int) -> None:
        for collection_name, uid, field in (("users", follower_id, "followingCount"), ("users", target_id, "followersCount"), ("publicProfiles", follower_id, "followingCount"), ("publicProfiles", target_id, "followersCount")):
            transaction.set(self.db.collection(collection_name).document(uid), {field: firestore.Increment(direction)}, merge=True)

    def send_notification(
        self,
        recipient_id: str,
        actor_id: str,
        notif_type: str,
        target_id: Optional[str] = None,
    ) -> None:
        if recipient_id == actor_id:
            return
        notif_id = f"notif_{uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        
        actor_name = "A ZipRIGHT user"
        actor_avatar = None
        
        if self.db:
            try:
                actor_snap = self.db.collection("users").document(actor_id).get()
                if actor_snap.exists:
                    data = actor_snap.to_dict() or {}
                    actor_name = data.get("displayName", actor_name)
                    actor_avatar = data.get("photoURL")

                notif_payload = {
                    "id": notif_id,
                    "recipient_id": recipient_id,
                    "actor_id": actor_id,
                    "actor_name": actor_name,
                    "actor_avatar": actor_avatar,
                    "type": notif_type,
                    "target_id": target_id,
                    "is_read": False,
                    "created_at": now_iso,
                }
                self.db.collection("notifications").document(notif_id).set(notif_payload)
            except Exception as exc:
                logger.warning("Failed writing notification: %s", exc)


def get_social_repository() -> SocialRepository:
    return SocialRepository()
