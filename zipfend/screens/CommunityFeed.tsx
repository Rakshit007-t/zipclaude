import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { addToCloset, inCloset } from '../services/closet';
import { follow, unfollow, onFollowing, onBlocked, searchUsers, myProfile, socialUser } from '../services/social';
import { safeOpenUrl, sanitizeText } from '../utils/sanitize';
import { SEED_LOOKS } from '../services/salonSeed';
import { Spinner, Sheet, Button } from '../components/ui';

const PAGE_SIZE = 20;

// Local persistence: seed-look likes always, and every like/save for demo
// sessions (no Firebase auth to write with).
function readIdSet(key: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}
function writeIdSet(key: string, set: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}
const LOCAL_LIKES_KEY = 'zr_salon_likes';
const SAVED_LOOKS_KEY = 'zr_saved_looks';

interface LookComment {
  id: string;
  from: string;
  name: string;
  avatar: string | null;
  text: string;
  createdAt: { toMillis?: () => number } | null;
}

function readLocalComments(lookId: string): LookComment[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`zr_salon_comments:${lookId}`) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

interface Look {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorUsername: string;
  creatorAvatar: string | null;
  mediaUrl: string;
  mediaUrls?: string[];
  mediaType?: 'image' | 'video';
  audience?: 'public' | 'followers';
  caption: string;
  taggedProducts: {
    id: string; title: string; brand: string;
    price: string; image: string; url: string; affiliateLink: string;
  }[];
  likesCount: number;
  viewsCount: number;
  commentsCount?: number;
  createdAt: any;
}

/** A look's media: video reel, multi-photo carousel, or single photo. */
const LookMedia: React.FC<{ look: Look; active: boolean }> = ({ look, active }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [slide, setSlide] = useState(0);
  const urls = look.mediaUrls?.length ? look.mediaUrls : [look.mediaUrl];

  // Play only the on-screen reel; pause the rest
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) void v.play().catch(() => {});
    else v.pause();
  }, [active]);

  if (look.mediaType === 'video') {
    return (
      <video
        ref={videoRef}
        src={urls[0]}
        className="h-full w-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
      />
    );
  }

  if (urls.length === 1) {
    return <img src={urls[0]} alt={look.caption} className="h-full w-full object-cover" referrerPolicy="no-referrer" />;
  }

  return (
    <div className="relative h-full w-full">
      <div
        className="h-full w-full overflow-x-auto no-scrollbar snap-x snap-mandatory flex"
        onScroll={e => {
          const el = e.currentTarget;
          setSlide(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {urls.map((u, i) => (
          <img key={i} src={u} alt={`${look.caption} — photo ${i + 1}`} className="h-full w-full object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" loading={i > 0 ? 'lazy' : undefined} />
        ))}
      </div>
      {/* Dots */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 flex gap-1.5 z-40" aria-label={`Photo ${slide + 1} of ${urls.length}`}>
        {urls.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`} />
        ))}
      </div>
    </div>
  );
};

interface CommunityFeedProps {
  /** Rendered inside the Friends social hub — header shows the hub switcher */
  inHub?: boolean;
  onShowPeople?: () => void;
}

const CommunityFeed: React.FC<CommunityFeedProps> = ({ inHub, onShowPeople }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [looks, setLooks] = useState<Look[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLookIndex, setActiveLookIndex] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [productsOpen, setProductsOpen] = useState(false);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [baggedIds, setBaggedIds] = useState<Set<string>>(new Set());
  const [ownMenuLook, setOwnMenuLook] = useState<Look | null>(null);
  const [editingLook, setEditingLook] = useState<Look | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [localLikes, setLocalLikes] = useState<Set<string>>(() => readIdSet(LOCAL_LIKES_KEY));
  const [savedLooks, setSavedLooks] = useState<Set<string>>(() => readIdSet(SAVED_LOOKS_KEY));
  const [commentsFor, setCommentsFor] = useState<Look | null>(null);
  const [comments, setComments] = useState<LookComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const fetchingMoreRef = useRef(false);
  const viewedRef = useRef<Set<string>>(new Set());

  // Paged fetch — first page on mount, more as the user nears the end
  const fetchPage = async () => {
    if (fetchingMoreRef.current) return;
    fetchingMoreRef.current = true;
    try {
      const parts = [
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc'),
        ...(lastDocRef.current ? [startAfter(lastDocRef.current)] : []),
        limit(PAGE_SIZE),
      ];
      const snap = await getDocs(query(collection(db, 'looks'), ...parts));
      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;
      if (snap.docs.length < PAGE_SIZE) setHasMore(false);
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Look[];
      setLooks(prev => {
        const seen = new Set(prev.map(l => l.id));
        return [...prev, ...fetched.filter(l => !seen.has(l.id))];
      });
    } catch (err) {
      console.error(err);
      setHasMore(false);
    } finally {
      fetchingMoreRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // Live listeners: my likes, who I follow, who I've blocked
    const user = auth.currentUser;
    const unsubs: (() => void)[] = [
      onFollowing(setFollowingSet),
      onBlocked(setBlockedSet),
    ];
    if (user) {
      const likesRef = collection(db, 'users', user.uid, 'lookLikes');
      unsubs.push(onSnapshot(likesRef, snap => {
        const map: Record<string, boolean> = {};
        snap.docs.forEach(d => { map[d.id] = true; });
        setLikedMap(map);
      }));
    }
    return () => unsubs.forEach(u => u());
  }, []);

  const me = auth.currentUser?.uid;
  const isSeed = (l: Look) => l.id.startsWith('seed-');

  // Feed = real community posts first, then the editorial opening collection.
  // Hide blocked creators; honor followers-only audience.
  const audienceOk = (l: Look) =>
    !blockedSet.has(l.creatorId) &&
    (l.audience !== 'followers' || l.creatorId === me || followingSet.has(l.creatorId));
  const visibleLooks = [...looks.filter(audienceOk), ...(SEED_LOOKS as unknown as Look[]).filter(audienceOk)];

  // Intersection observer: active card, one view per session, load-more
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-index'));
            setActiveLookIndex(index);
            setProductsOpen(false);
            const look = visibleLooks[index];
            if (look && !isSeed(look) && !viewedRef.current.has(look.id)) {
              viewedRef.current.add(look.id);
              updateDoc(doc(db, 'looks', look.id), { viewsCount: increment(1) }).catch(() => {});
            }
            // Near the end of the real posts → pull the next page
            if (hasMore && index >= looks.length - 3) fetchPage();
          }
        });
      },
      { threshold: 0.7 }
    );
    cardRefs.current.forEach(card => { if (card) observer.observe(card); });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLooks.length, looks.length, hasMore]);

  const isLiked = (look: Look) => !!likedMap[look.id] || localLikes.has(look.id);
  const shownLikes = (look: Look) =>
    look.likesCount + ((isSeed(look) || !auth.currentUser) && localLikes.has(look.id) ? 1 : 0);

  const toggleLike = async (look: Look) => {
    const user = auth.currentUser;
    // Editorial seeds and demo sessions: the like lives on this device
    if (isSeed(look) || !user) {
      const next = new Set(localLikes);
      if (next.has(look.id)) next.delete(look.id); else next.add(look.id);
      setLocalLikes(next);
      writeIdSet(LOCAL_LIKES_KEY, next);
      return;
    }
    const likeRef = doc(db, 'users', user.uid, 'lookLikes', look.id);
    const wasLiked = likedMap[look.id];
    const delta = wasLiked ? -1 : 1;
    // Optimistic: the visible count moves with the tap
    setLooks(prev => prev.map(l => l.id === look.id ? { ...l, likesCount: Math.max(0, l.likesCount + delta) } : l));
    try {
      if (wasLiked) {
        await deleteDoc(likeRef);
        await updateDoc(doc(db, 'looks', look.id), { likesCount: increment(-1) });
      } else {
        await setDoc(likeRef, { createdAt: new Date() });
        await updateDoc(doc(db, 'looks', look.id), { likesCount: increment(1) });
      }
    } catch {
      // Roll back the optimistic count
      setLooks(prev => prev.map(l => l.id === look.id ? { ...l, likesCount: Math.max(0, l.likesCount - delta) } : l));
    }
  };

  const toggleSave = (look: Look) => {
    const saving = !savedLooks.has(look.id);
    const next = new Set(savedLooks);
    if (saving) next.add(look.id); else next.delete(look.id);
    setSavedLooks(next);
    writeIdSet(SAVED_LOOKS_KEY, next);
    // Renderable snapshot for the profile's Saved grid
    try {
      const data = JSON.parse(localStorage.getItem('zr_saved_looks_data') || '{}');
      if (saving) data[look.id] = { id: look.id, mediaUrl: look.mediaUrl, caption: look.caption, creatorUsername: look.creatorUsername };
      else delete data[look.id];
      localStorage.setItem('zr_saved_looks_data', JSON.stringify(data));
    } catch {}
    // Cloud mirror, best-effort, real accounts only
    const user = socialUser();
    if (user) {
      (saving
        ? setDoc(doc(db, 'users', user.uid, 'savedLooks', look.id), {
            lookId: look.id, mediaUrl: look.mediaUrl, caption: look.caption, savedAt: serverTimestamp(),
          })
        : deleteDoc(doc(db, 'users', user.uid, 'savedLooks', look.id))
      ).catch(() => {});
    }
  };

  const toggleFollow = async (look: Look) => {
    if (!socialUser()) { showToast('Sign in to follow creators', 'error'); return; }
    const isFollowing = followingSet.has(look.creatorId);
    try {
      if (isFollowing) {
        await unfollow(look.creatorId);
      } else {
        await follow({
          uid: look.creatorId,
          displayName: look.creatorName,
          username: look.creatorUsername,
          photoURL: look.creatorAvatar,
        });
      }
    } catch {}
  };

  // Comments: live from Firestore for signed-in users (works for seeds too —
  // subcollections don't need the parent doc); device-local for demo sessions.
  useEffect(() => {
    if (!commentsFor) return;
    setComments([]);
    if (!auth.currentUser) {
      setComments(readLocalComments(commentsFor.id));
      return;
    }
    const q = query(collection(db, 'looks', commentsFor.id, 'comments'), orderBy('createdAt', 'asc'), limit(100));
    return onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as LookComment)));
    }, () => setComments([]));
  }, [commentsFor]);

  const postComment = async () => {
    const text = sanitizeText(commentDraft, 300);
    if (!text || !commentsFor) return;
    setCommentDraft('');
    const user = auth.currentUser;
    if (!user) {
      // Demo session: comment lives on this device
      const local: LookComment[] = [...readLocalComments(commentsFor.id), { id: `local-${Date.now()}`, from: 'demo', name: 'You', avatar: null, text, createdAt: null }];
      try { localStorage.setItem(`zr_salon_comments:${commentsFor.id}`, JSON.stringify(local)); } catch {}
      setComments(local);
      return;
    }
    try {
      const mine = await myProfile();
      await addDoc(collection(db, 'looks', commentsFor.id, 'comments'), {
        from: user.uid,
        name: mine?.displayName || user.displayName || 'ZipRIGHT member',
        avatar: mine?.photoURL || user.photoURL || null,
        text,
        createdAt: serverTimestamp(),
      });
      if (!isSeed(commentsFor)) updateDoc(doc(db, 'looks', commentsFor.id), { commentsCount: increment(1) }).catch(() => {});
    } catch {
      setCommentDraft(text);
      showToast('Comment not posted. Try again.', 'error');
    }
  };

  // Through the closet so the item appears in the Cart screen instantly
  // (closet mirrors to Firestore users/{uid}/cart itself).
  const handleCartProduct = (product: Look['taggedProducts'][0]) => {
    addToCloset('cart', {
      id: product.id,
      title: product.title,
      brand: product.brand,
      price: product.price,
      image: product.image,
      url: product.url,
      affiliateLink: product.affiliateLink,
    });
    setBaggedIds(prev => new Set(prev).add(product.id));
  };

  // Caption with live #hashtags and tappable @mentions
  const renderCaption = (text: string) => text.split(/(\s+)/).map((w, i) => {
    if (/^#[\p{L}\p{N}_]+$/u.test(w)) return <span key={i} className="text-brand-on-media font-medium">{w}</span>;
    if (/^@[\w.]+$/.test(w)) {
      return (
        <button
          key={i}
          className="text-brand-on-media font-medium"
          onClick={async () => {
            const found = await searchUsers(w).catch(() => []);
            if (found[0]) navigate(`/profile/${found[0].uid}`);
          }}
        >
          {w}
        </button>
      );
    }
    return w;
  });

  const handleDeleteLook = async (look: Look) => {
    setOwnMenuLook(null);
    try {
      await updateDoc(doc(db, 'looks', look.id), { status: 'deleted' });
      setLooks(prev => prev.filter(l => l.id !== look.id));
      updateDoc(doc(db, 'users', look.creatorId), { postsCount: increment(-1) }).catch(() => {});
    } catch {
      showToast('Could not delete. Try again.', 'error');
    }
  };

  const handleSaveCaption = async () => {
    if (!editingLook) return;
    const caption = editCaption.trim();
    try {
      await updateDoc(doc(db, 'looks', editingLook.id), {
        caption,
        hashtags: [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).toLowerCase()))],
      });
      setLooks(prev => prev.map(l => l.id === editingLook.id ? { ...l, caption } : l));
      setEditingLook(null);
    } catch {
      showToast('Could not save. Try again.', 'error');
    }
  };

  const handleShare = async (look: Look) => {
    const shareUrl = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: look.caption || 'ZipRIGHT look', text: `${look.caption} — @${look.creatorUsername} on ZipRIGHT`, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link copied', 'success');
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  if (visibleLooks.length === 0) {
    return (
      <div className="h-dvh bg-surface-0 flex flex-col items-center justify-center px-8 text-center">
        <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-ink-faint text-[28px]" aria-hidden="true">photo_camera</span>
        </div>
        <p className="eyebrow mb-3">The Salon</p>
        <h2 className="text-ink font-display text-[28px] font-light mb-3">Be the <em className="font-medium">first.</em></h2>
        <p className="text-ink-soft text-[14px] mb-8 max-w-[260px] leading-relaxed">No community looks yet. Post yours and inspire the community.</p>
        <button onClick={() => navigate('/create-look')} className="h-12 px-7 bg-ink text-ink-invert rounded-full font-semibold text-[12px] uppercase tracking-[0.12em] active:scale-95 transition-transform">
          Post a look
        </button>
        <button onClick={() => navigate(-1)} className="mt-4 text-ink-faint text-[12px] active:opacity-70">← Back</button>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full bg-black overflow-hidden relative">

      {/* TOP HEADER — overlaid */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-5 pt-[22px] pt-safe pb-10 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
        {inHub ? (
          <div className="h-10 w-10" aria-hidden="true" />
        ) : (
          <button aria-label="Go back"
            onClick={() => navigate(-1)}
            className="h-10 w-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90 border border-white/15"
          >
            <span className="material-symbols-outlined text-white text-[20px]" aria-hidden="true">arrow_back</span>
          </button>
        )}

        {inHub ? (
          /* Hub switcher — Salon is home; your people are one tap away */
          <div className="flex items-center rounded-full bg-black/40 backdrop-blur-md border border-white/15 p-1 pointer-events-auto" role="tablist" aria-label="Social hub">
            <button
              role="tab"
              aria-selected={true}
              className="h-8 px-4 rounded-full bg-white text-black text-[10px] font-semibold uppercase tracking-[0.14em]"
            >
              Salon
            </button>
            <button
              role="tab"
              aria-selected={false}
              onClick={onShowPeople}
              className="h-8 px-4 rounded-full text-white/80 text-[10px] font-semibold uppercase tracking-[0.14em] active:scale-95 transition-transform"
            >
              Friends
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center pointer-events-none">
            <span className="text-white text-[10px] font-semibold uppercase tracking-[0.2em]">The Salon</span>
            <span className="text-white/60 text-[11px] mt-0.5">Real looks, real people</span>
          </div>
        )}

        <button
          onClick={() => navigate('/create-look')}
          aria-label="Post a look"
          className="h-10 w-10 rounded-full bg-brand-on-media backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90"
        >
          <span className="material-symbols-outlined text-black text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">add</span>
        </button>
      </div>

      {/* REEL FEED */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll no-scrollbar snap-y snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {visibleLooks.map((look, index) => (
          <div
            key={look.id}
            data-index={index}
            ref={el => {
              cardRefs.current[index] = el;
            }}
            className="h-dvh w-full flex-shrink-0 relative bg-black snap-start snap-always"
          >
            {/* Look media — photo, carousel, or reel */}
            <LookMedia look={look} active={activeLookIndex === index} />

            {/* Gradient overlays */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 45%, transparent 65%, rgba(0,0,0,0.3) 100%)' }} />

            {/* RIGHT ACTION BAR */}
            <div className="absolute right-4 bottom-40 z-40 flex flex-col items-center gap-3">

              {/* Creator avatar → profile; badge → follow/unfollow */}
              <div className="relative">
                <button
                  onClick={() => navigate(`/profile/${look.creatorId}`)}
                  aria-label={`View @${look.creatorUsername}'s profile`}
                  className="h-12 w-12 rounded-full border-2 border-white overflow-hidden block active:scale-90 transition-transform"
                >
                  {look.creatorAvatar ? (
                    <img src={look.creatorAvatar} alt={`${look.creatorUsername}'s avatar`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-black/50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-xl" aria-hidden="true">person</span>
                    </div>
                  )}
                </button>
                {look.creatorId !== auth.currentUser?.uid && (
                  <button
                    onClick={() => toggleFollow(look)}
                    aria-label={followingSet.has(look.creatorId) ? `Unfollow @${look.creatorUsername}` : `Follow @${look.creatorUsername}`}
                    aria-pressed={followingSet.has(look.creatorId)}
                    className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-5 w-5 rounded-full flex items-center justify-center border border-black active:scale-90 transition-[transform,background-color] ${followingSet.has(look.creatorId) ? 'bg-white' : 'bg-brand-on-media'}`}
                  >
                    <span className="material-symbols-outlined text-black text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                      {followingSet.has(look.creatorId) ? 'check' : 'add'}
                    </span>
                  </button>
                )}
              </div>

              {/* Like */}
              <button
                onClick={() => toggleLike(look)}
                aria-label={isLiked(look) ? 'Unlike this look' : 'Like this look'}
                aria-pressed={isLiked(look)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-11 w-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span
                    className={`material-symbols-outlined text-[24px] ${isLiked(look) ? 'text-brand-on-media' : 'text-white'}`}
                    style={{ fontVariationSettings: isLiked(look) ? "'FILL' 1" : "'FILL' 0" }}
                    aria-hidden="true"
                  >favorite</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {shownLikes(look) > 0 ? shownLikes(look) : 'Like'}
                </span>
              </button>

              {/* Comment */}
              <button
                onClick={() => setCommentsFor(look)}
                aria-label="View comments"
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-11 w-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span className="material-symbols-outlined text-white text-[24px]" aria-hidden="true">mode_comment</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {look.commentsCount ? look.commentsCount : 'Comment'}
                </span>
              </button>

              {/* Products sheet toggle */}
              <button onClick={() => setProductsOpen(o => !o)} className="flex flex-col items-center gap-1 active:scale-90">
                <div className={`h-11 w-11 rounded-full backdrop-blur-md flex items-center justify-center border ${productsOpen ? 'bg-brand-on-media border-brand-on-media' : 'bg-black/40 border-white/15'}`}>
                  <span className={`material-symbols-outlined text-[24px] ${productsOpen ? 'text-black' : 'text-white'}`} style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">sell</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {look.taggedProducts.length > 0 ? `Shop (${look.taggedProducts.length})` : 'Shop'}
                </span>
              </button>

              {/* Share */}
              <button
                onClick={() => handleShare(look)}
                aria-label="Share this look"
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-11 w-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span className="material-symbols-outlined text-white text-[24px]" aria-hidden="true">ios_share</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">Share</span>
              </button>

              {/* Save */}
              <button
                onClick={() => toggleSave(look)}
                aria-label={savedLooks.has(look.id) ? 'Remove from saved' : 'Save this look'}
                aria-pressed={savedLooks.has(look.id)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-11 w-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span
                    className={`material-symbols-outlined text-[24px] ${savedLooks.has(look.id) ? 'text-brand-on-media' : 'text-white'}`}
                    style={{ fontVariationSettings: savedLooks.has(look.id) ? "'FILL' 1" : "'FILL' 0" }}
                    aria-hidden="true"
                  >bookmark</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {savedLooks.has(look.id) ? 'Saved' : 'Save'}
                </span>
              </button>

              {/* Own post — manage */}
              {look.creatorId === me && (
                <button
                  onClick={() => setOwnMenuLook(look)}
                  aria-label="Manage this post"
                  className="flex flex-col items-center gap-1 active:scale-90"
                >
                  <div className="h-11 w-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                    <span className="material-symbols-outlined text-white text-[24px]" aria-hidden="true">more_horiz</span>
                  </div>
                  <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">You</span>
                </button>
              )}
            </div>

            {/* BOTTOM INFO — creator + caption */}
            <div className="absolute bottom-24 left-0 right-20 z-40 pl-4">
              <div className="bg-black/50 backdrop-blur-xl rounded-2xl px-5 py-4 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                    {look.creatorAvatar ? (
                      <img src={look.creatorAvatar} alt={`${look.creatorUsername}'s avatar`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-full w-full bg-black/40 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-xs" aria-hidden="true">person</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => navigate(`/profile/${look.creatorId}`)} className="text-white text-[12px] font-medium active:opacity-70">@{look.creatorUsername}</button>
                  {look.taggedProducts.length > 0 && (
                    <span className="ml-auto text-brand-on-media text-[9px] font-semibold uppercase tracking-[0.1em]">
                      {look.taggedProducts.length} shoppable
                    </span>
                  )}
                </div>
                <p className="text-white text-[13.5px] leading-snug line-clamp-2">{renderCaption(look.caption)}</p>
              </div>
            </div>

            {/* SHOPPABLE PRODUCTS DRAWER — slides up */}
            <AnimatePresence>
              {productsOpen && activeLookIndex === index && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[55] bg-black/40"
                    onClick={() => setProductsOpen(false)}
                  />
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                    className="absolute inset-x-0 bottom-0 z-[60] bg-surface-1 rounded-t-sheet border-t border-line pb-16"
                  >
                    <div className="flex justify-center pt-4 pb-2">
                      <div className="w-10 h-1 bg-line-strong rounded-full" />
                    </div>
                    <div className="px-6 pb-2">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-display text-[19px] font-medium text-ink">Shop this look</h3>
                        <span className="text-ink-faint text-[11px] uppercase tracking-[0.1em]">{look.taggedProducts.length} items</span>
                      </div>

                      {look.taggedProducts.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-ink-faint text-[13px]">No products tagged in this look</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto no-scrollbar">
                          {look.taggedProducts.map(product => (
                            <div key={product.id} className="flex items-center gap-4 bg-surface-2 rounded-2xl p-3">
                              <button
                                className="h-16 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-surface-3"
                                onClick={() => safeOpenUrl(product.affiliateLink || product.url)}
                                aria-label={`Open ${product.title}`}
                              >
                                <img src={product.image} alt={product.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className="font-display text-[15px] font-medium text-ink leading-tight truncate">{product.brand}</p>
                                <p className="text-ink-faint text-[11px] leading-tight truncate mt-0.5">{product.title}</p>
                                <p className="text-ink font-semibold text-[13px] mt-0.5">{product.price}</p>
                              </div>
                              <button
                                onClick={() => handleCartProduct(product)}
                                aria-label={baggedIds.has(product.id) || inCloset('cart', product.id) ? `${product.brand} is in your bag` : `Add ${product.brand} to cart`}
                                className={`h-10 w-10 rounded-full border flex items-center justify-center active:scale-90 flex-shrink-0 transition-colors ${baggedIds.has(product.id) || inCloset('cart', product.id) ? 'border-success text-success' : 'border-line text-ink'}`}
                              >
                                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                                  {baggedIds.has(product.id) || inCloset('cart', product.id) ? 'check' : 'add_shopping_cart'}
                                </span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* Own-post management */}
      <Sheet open={!!ownMenuLook} onClose={() => setOwnMenuLook(null)} title="Your post">
        {ownMenuLook && (
          <div className="flex flex-col pb-4">
            <button
              onClick={() => { setEditCaption(ownMenuLook.caption); setEditingLook(ownMenuLook); setOwnMenuLook(null); }}
              className="flex items-center gap-4 py-4 border-b border-line text-left active:opacity-70"
            >
              <span className="material-symbols-outlined text-ink text-[20px]" aria-hidden="true">edit</span>
              <div>
                <p className="text-ink font-medium text-[14px]">Edit caption</p>
                <p className="text-ink-faint text-[12px]">Update the caption and hashtags</p>
              </div>
            </button>
            <button
              onClick={() => handleDeleteLook(ownMenuLook)}
              className="flex items-center gap-4 py-4 text-left active:opacity-70"
            >
              <span className="material-symbols-outlined text-danger text-[20px]" aria-hidden="true">delete</span>
              <div>
                <p className="text-danger font-medium text-[14px]">Delete post</p>
                <p className="text-ink-faint text-[12px]">Removes it from The Salon for everyone</p>
              </div>
            </button>
          </div>
        )}
      </Sheet>

      {/* Comments */}
      <Sheet open={!!commentsFor} onClose={() => setCommentsFor(null)} title="Comments">
        <div className="flex flex-col pb-4">
          <div className="max-h-[45vh] overflow-y-auto no-scrollbar flex flex-col">
            {comments.length === 0 ? (
              <p className="text-ink-faint text-[13px] text-center py-10">No comments yet — say something nice.</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className="flex gap-3 py-3 border-b border-line last:border-none">
                  <div className="h-8 w-8 rounded-full border border-line flex items-center justify-center shrink-0 overflow-hidden">
                    {c.avatar ? (
                      <img src={c.avatar} alt={`${c.name || 'Member'}'s avatar`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="text-ink font-display font-medium text-[13px]">{(c.name || '?').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-ink-faint text-[11px] font-semibold">{c.name}</p>
                    <p className="text-ink text-[13.5px] leading-snug break-words">{c.text}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-2 pt-4">
            <input
              type="text"
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && postComment()}
              placeholder="Add a comment…"
              aria-label="Add a comment"
              maxLength={300}
              className="flex-1 bg-surface-1 border border-line rounded-full px-4 h-11 text-ink text-[14px] placeholder:text-ink-faint outline-none focus:border-ink transition-colors"
            />
            <button
              onClick={postComment}
              disabled={!commentDraft.trim()}
              aria-label="Post comment"
              className="h-11 w-11 rounded-full bg-ink text-ink-invert flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40 shrink-0"
            >
              <span className="material-symbols-outlined text-[19px]" aria-hidden="true">arrow_upward</span>
            </button>
          </div>
        </div>
      </Sheet>

      {/* Edit caption */}
      <Sheet open={!!editingLook} onClose={() => setEditingLook(null)} title="Edit caption">
        <div className="flex flex-col gap-4 pb-4">
          <textarea
            value={editCaption}
            onChange={e => setEditCaption(e.target.value)}
            aria-label="Caption"
            rows={4}
            maxLength={300}
            className="w-full bg-surface-1 border border-line rounded-card px-4 py-3.5 text-ink text-[14px] placeholder:text-ink-faint outline-none resize-none focus:border-ink transition-colors"
          />
          <Button fullWidth onClick={handleSaveCaption}>Save</Button>
        </div>
      </Sheet>
    </div>
  );
};

export default CommunityFeed;
