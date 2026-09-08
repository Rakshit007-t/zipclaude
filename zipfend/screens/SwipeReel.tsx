import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { auth } from '../firebase';
import { Button, EmptyState, Input, Sheet, Spinner } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { authorizedFetch, getBackendBaseUrl } from '../services/ziprightApi';
import { blockUser, report, searchUsers, socialUser, type PublicProfile } from '../services/social';
import { addToCloset } from '../services/closet';

type Reel = {
  id: string; user_id: string; user_display_name: string; user_username: string;
  user_photo_url?: string | null; caption: string; media_url?: string | null;
  thumbnail_url?: string | null; likes_count: number; comments_count: number;
  shares_count: number; is_liked_by_me: boolean;
};
type Comment = {
  id: string; user_id: string; user_display_name: string; user_username: string;
  user_photo_url?: string | null; text: string;
};

const IconAction = ({ icon, label, onClick, filled }: { icon: string; label: string; onClick: () => void; filled?: boolean }) => (
  <motion.button whileTap={{ scale: 0.88 }} onClick={onClick} aria-label={label} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md ring-1 ring-white/20">
    <span className={`material-symbols-outlined text-[22px] ${filled ? 'filled' : ''}`}>{icon}</span>
  </motion.button>
);

const avatar = (name: string, url?: string | null) => url
  ? <img src={url} alt={`${name}'s avatar`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
  : <span className="flex h-full w-full items-center justify-center bg-surface-2 text-sm font-semibold text-ink">{name.slice(0, 1).toUpperCase()}</span>;

const SwipeReel: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [reels, setReels] = useState<Reel[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipientTerm, setRecipientTerm] = useState('');
  const [recipients, setRecipients] = useState<PublicProfile[]>([]);

  const reel = reels[index];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setError(null);
      try {
        const response = await authorizedFetch(`${getBackendBaseUrl()}/feed/reels`);
        if (!response.ok) throw new Error('Could not load reels.');
        const payload = await response.json();
        if (!cancelled) setReels(payload.data?.posts || []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load reels.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!commentsOpen || !reel) return;
    let cancelled = false;
    void (async () => {
      setCommentsLoading(true);
      try {
        const response = await authorizedFetch(`${getBackendBaseUrl()}/social/posts/${encodeURIComponent(reel.id)}/comments`);
        if (!response.ok) throw new Error('Could not load comments.');
        const payload = await response.json();
        if (!cancelled) setComments(payload.data || []);
      } catch {
        if (!cancelled) showToast('Could not load comments.', 'error');
      } finally { if (!cancelled) setCommentsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [commentsOpen, reel?.id, showToast]);

  useEffect(() => {
    if (!shareOpen || recipientTerm.trim().length < 2) { setRecipients([]); return; }
    let cancelled = false;
    void searchUsers(recipientTerm).then(results => { if (!cancelled) setRecipients(results); }).catch(() => {
      if (!cancelled) setRecipients([]);
    });
    return () => { cancelled = true; };
  }, [shareOpen, recipientTerm]);

  const requireUser = () => {
    if (socialUser()) return true;
    showToast('Sign in to use social actions.', 'error');
    return false;
  };

  const toggleLike = async () => {
    if (!reel || busy || !requireUser()) return;
    setBusy(true);
    try {
      const response = await authorizedFetch(`${getBackendBaseUrl()}/social/posts/${encodeURIComponent(reel.id)}/like`, { method: 'POST' });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setReels(current => current.map(item => item.id === reel.id ? { ...item, is_liked_by_me: payload.data.liked, likes_count: payload.data.likes_count } : item));
    } catch { showToast('Could not update like.', 'error'); } finally { setBusy(false); }
  };

  const sendComment = async () => {
    const text = comment.trim();
    if (!reel || !text || busy || !requireUser()) return;
    setBusy(true);
    try {
      const response = await authorizedFetch(`${getBackendBaseUrl()}/social/posts/${encodeURIComponent(reel.id)}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setComments(current => [...current, payload.data]);
      setComment('');
      setReels(current => current.map(item => item.id === reel.id ? { ...item, comments_count: item.comments_count + 1 } : item));
    } catch { showToast('Comment was not posted. Please try again.', 'error'); } finally { setBusy(false); }
  };

  const sendShare = async (recipient: PublicProfile) => {
    if (!reel || busy || !requireUser()) return;
    setBusy(true);
    try {
      const response = await authorizedFetch(`${getBackendBaseUrl()}/social/posts/${encodeURIComponent(reel.id)}/share`, { method: 'POST', body: JSON.stringify({ recipient_uid: recipient.uid }) });
      if (!response.ok) throw new Error();
      setShareOpen(false); setRecipientTerm('');
      showToast(`Shared with ${recipient.displayName}.`, 'success');
    } catch { showToast('Could not share this reel.', 'error'); } finally { setBusy(false); }
  };

  const copyLink = async () => {
    if (!reel) return;
    const url = `${window.location.origin}${window.location.pathname}#/reels/${encodeURIComponent(reel.id)}`;
    try { await navigator.clipboard.writeText(url); showToast('Link copied.', 'success'); }
    catch { showToast('Could not copy link.', 'error'); }
  };

  const getReelProduct = (r: Reel) => ({
    id: r.id,
    title: r.caption || 'Fashion Reel Look',
    brand: r.user_display_name || 'ZipRIGHT Atelier',
    price: '₹2,999',
    image: r.media_url || r.thumbnail_url || '',
    url: window.location.href,
  });

  const handleAddToCart = () => {
    if (!reel) return;
    const added = addToCloset('cart', getReelProduct(reel));
    if (added) showToast('Added to Cart', 'success');
    else showToast('Already in Cart', 'info');
  };

  const handleAddToWishlist = () => {
    if (!reel) return;
    const added = addToCloset('likes', getReelProduct(reel));
    if (added) showToast('Saved to Wishlist', 'success');
    else showToast('Already in Wishlist', 'info');
  };

  const handleDragEnd = (_: any, info: { offset: { x: number; y: number } }) => {
    const { x, y } = info.offset;
    if (Math.abs(x) > Math.abs(y)) {
      if (x > 80) handleAddToCart();
      else if (x < -80) handleAddToWishlist();
    } else {
      if (y < -80 && reels.length > 1) {
        setIndex(current => (current + 1) % reels.length);
      } else if (y > 80 && reels.length > 1) {
        setIndex(current => (current - 1 + reels.length) % reels.length);
      }
    }
  };

  if (loading) return <main className="flex min-h-dvh items-center justify-center bg-surface-0"><Spinner size={30} /></main>;
  if (error) return <main className="p-6 pt-24"><EmptyState icon="error" title="Reels unavailable" description={error} action={<Button onClick={() => window.location.reload()}>Try again</Button>} /></main>;
  if (!reel) return <main className="p-6 pt-24"><EmptyState icon="movie" title="No reels yet" description="Published reels will appear here. There are no demo reels in this feed." /></main>;

  return (
    <main className="relative isolate h-screen min-h-[640px] max-h-dvh overflow-hidden bg-black text-white touch-none select-none">
      <AnimatePresence mode="wait">
        <motion.section
          key={reel.id}
          drag
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={0.5}
          onDragEnd={handleDragEnd}
          initial={{ opacity: 0, scale: 1.025 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0 bg-surface-3 cursor-grab active:cursor-grabbing"
        >
          {reel.media_url ? <img src={reel.media_url} alt={reel.caption || 'Reel'} className="h-full w-full object-cover pointer-events-none" /> : <div className="h-full w-full bg-gradient-to-br from-surface-3 to-ink" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/85 pointer-events-none" />
        </motion.section>
      </AnimatePresence>
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <button onClick={() => navigate(`/profile/${reel.user_id}`)} className="flex items-center gap-2.5 text-left"><span className="h-9 w-9 overflow-hidden rounded-full border border-white/60">{avatar(reel.user_display_name, reel.user_photo_url)}</span><span className="text-[13px] font-semibold tracking-wide">@{reel.user_username}</span></button>
        <div className="flex items-center gap-2">
          {reels.length > 1 && <button onClick={() => setIndex(current => (current + 1) % reels.length)} className="rounded-full bg-white/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur">Next</button>}
        </div>
      </header>
      <aside className="absolute bottom-[196px] right-5 z-10 flex flex-col items-center gap-2">
        <IconAction icon="favorite" filled={reel.is_liked_by_me} label="Like" onClick={toggleLike} /><span className="text-[10px]">{reel.likes_count}</span>
        <IconAction icon="chat_bubble" label="Comment" onClick={() => setCommentsOpen(true)} /><span className="text-[10px]">{reel.comments_count}</span>
        <IconAction icon="shopping_bag" label="Add to Cart" onClick={handleAddToCart} />
        <IconAction icon="bookmark" label="Add to Wishlist" onClick={handleAddToWishlist} />
        <IconAction icon="send" label="Share" onClick={() => setShareOpen(true)} />
        <IconAction icon="more_horiz" label="More" onClick={() => setMoreOpen(true)} />
      </aside>
      <section className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pr-20">
        <p className="text-[14px] font-semibold">{reel.user_display_name}</p>
        <p className="mt-1 max-w-[290px] text-[13px] leading-relaxed text-white/85">{reel.caption || 'No caption.'}</p>
        <p className="mt-2 text-[10px] text-white/50 tracking-wider uppercase">Swipe ↑↓ for Reel | Swipe → Cart | Swipe ← Wishlist</p>
      </section>
      <Sheet title="Share" open={shareOpen} onClose={() => setShareOpen(false)}><Input value={recipientTerm} onChange={event => setRecipientTerm(event.target.value)} placeholder="Search username or name" /><div className="mt-4 space-y-2">{recipients.map(recipient => <button key={recipient.uid} disabled={busy} onClick={() => void sendShare(recipient)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2"><span className="h-10 w-10 overflow-hidden rounded-full">{avatar(recipient.displayName, recipient.photoURL)}</span><span><b className="block text-sm text-ink">{recipient.displayName}</b><small className="text-ink-faint">@{recipient.username}</small></span></button>)}{recipientTerm.trim().length >= 2 && !recipients.length && <p className="py-6 text-center text-sm text-ink-faint">No matching members.</p>}</div><Button variant="secondary" fullWidth className="mt-5" onClick={() => void copyLink()}>Copy link</Button></Sheet>
      <Sheet title="Options" open={moreOpen} onClose={() => setMoreOpen(false)}><button onClick={() => void copyLink()} className="flex w-full border-b border-line py-4 text-left text-ink">Copy link</button><button onClick={() => { void report('post', reel.id, 'Other').then(() => showToast('Report submitted.', 'success')).catch(() => showToast('Could not submit report.', 'error')); setMoreOpen(false); }} className="flex w-full border-b border-line py-4 text-left text-ink">Report</button><button onClick={() => { void blockUser({ uid: reel.user_id, displayName: reel.user_display_name, username: reel.user_username, photoURL: reel.user_photo_url || null }).then(() => { setReels(current => current.filter(item => item.id !== reel.id)); setIndex(0); showToast('Creator blocked.', 'success'); }).catch(() => showToast('Could not block creator.', 'error')); setMoreOpen(false); }} className="flex w-full py-4 text-left text-danger">Block creator</button></Sheet>
      <Sheet title="Comments" open={commentsOpen} onClose={() => setCommentsOpen(false)}><div className="space-y-5 pb-20">{commentsLoading ? <div className="flex justify-center py-10"><Spinner size={24} /></div> : comments.map(entry => <div key={entry.id} className="flex gap-3"><span className="h-9 w-9 shrink-0 overflow-hidden rounded-full">{avatar(entry.user_display_name, entry.user_photo_url)}</span><p className="pt-0.5 text-[13px] text-ink"><strong className="mr-1.5">@{entry.user_username}</strong>{entry.text}</p></div>)}</div><div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface-1 py-3"><span className="h-8 w-8 shrink-0 overflow-hidden rounded-full">{avatar(auth.currentUser?.displayName || 'You', auth.currentUser?.photoURL)}</span><Input value={comment} onChange={event => setComment(event.target.value.slice(0, 500))} onKeyDown={event => event.key === 'Enter' && void sendComment()} placeholder="Add a comment..." className="flex-1 !rounded-full" /><button disabled={busy} onClick={() => void sendComment()} className="text-[11px] font-semibold text-brand">Post</button></div></Sheet>
    </main>
  );
};

export default SwipeReel;
