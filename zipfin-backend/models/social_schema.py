from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field


class PostCreate(BaseModel):
    caption: str = Field(..., max_length=1000, description="Post caption or text description.")
    type: str = Field("post", description="'post' | 'reel'")
    media_url: Optional[str] = Field(None, description="Image or video URL.")
    thumbnail_url: Optional[str] = Field(None, description="Thumbnail URL for video reels.")
    tags: List[str] = Field(default_factory=list, description="Style or category tags.")
    linked_product_ids: List[str] = Field(default_factory=list, description="Tagged product IDs.")


class PostResponse(BaseModel):
    id: str
    user_id: str
    user_display_name: str
    user_username: str
    user_photo_url: Optional[str] = None
    type: str
    caption: str
    media_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    linked_product_ids: List[str] = Field(default_factory=list)
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    is_liked_by_me: bool = False
    is_saved_by_me: bool = False
    created_at: str


class CommentCreate(BaseModel):
    text: str = Field(..., max_length=500, description="Comment text.")
    parent_comment_id: Optional[str] = Field(None, description="Parent comment ID for replies.")


class ReportCreate(BaseModel):
    target_type: str = Field(..., pattern="^(post|comment|user)$")
    target_id: str = Field(..., min_length=1, max_length=256)
    reason: str = Field(..., pattern="^(spam|harassment|nudity|hate|violence|scam|impersonation|other)$")
    description: Optional[str] = Field(None, max_length=1000)


class ShareCreate(BaseModel):
    recipient_uid: str = Field(..., min_length=1, max_length=128)


class CommentResponse(BaseModel):
    id: str
    post_id: str
    user_id: str
    user_display_name: str
    user_username: str
    user_photo_url: Optional[str] = None
    text: str
    parent_comment_id: Optional[str] = None
    created_at: str


class FollowResponse(BaseModel):
    follower_id: str
    following_id: str
    is_following: bool
    followers_count: int
    following_count: int


class UserSummary(BaseModel):
    uid: str
    display_name: str
    username: str
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    is_following: bool = False


class FeedResponse(BaseModel):
    posts: List[PostResponse]
    next_cursor: Optional[str] = None
    has_more: bool = False


class NotificationItem(BaseModel):
    id: str
    recipient_id: str
    actor_id: str
    actor_name: str
    actor_avatar: Optional[str] = None
    type: str  # "follow" | "like" | "comment" | "mention"
    target_id: Optional[str] = None
    is_read: bool = False
    created_at: str
