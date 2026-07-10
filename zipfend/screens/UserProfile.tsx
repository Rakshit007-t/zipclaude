import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import {
  PublicProfile, getProfile, follow, unfollow, onFollowing, onBlocked,
  blockUser, unblockUser, report, isOnline,
} from '../services/social';
import { AppBar, Button, EmptyState, Eyebrow, Sheet, Spinner } from '../components/ui';

interface LookThumb {
  id: string;
  mediaUrl: string;
  caption: string;
  likesCount: number;
}

const REPORT_REASONS = [
  'Inappropriate content',
  'Spam or scam',
  'Impersonation',
  'Harassment',
  'Something else',
];

const UserProfile: React.FC = () => {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [looks, setLooks] = useState<LookThumb[]>([]);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isMe = uid === auth.currentUser?.uid;
  const followed = !!uid && followingSet.has(uid);
  const blocked = !!uid && blockedSet.has(uid);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [p, looksSnap] = await Promise.all([
        getProfile(uid),
        getDocs(query(
          collection(db, 'looks'),
          where('creatorId', '==', uid),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(30),
        )).catch(() => null),
      ]);
      if (cancelled) return;
      setProfile(p);
      if (looksSnap) {
        setLooks(looksSnap.docs.map(d => {
          const data = d.data();
          return { id: d.id, mediaUrl: data.mediaUrl, caption: data.caption || '', likesCount: data.likesCount || 0 };
        }));
      }
      setLoading(false);
    })();
    const unsubs = [onFollowing(setFollowingSet), onBlocked(setBlockedSet)];
    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, [uid]);

  const handleFollowToggle = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      if (followed) await unfollow(profile.uid);
      else await follow(profile);
    } catch {
      showToast('Could not update follow. Try again.', 'error');
    }
    setBusy(false);
  };

  const handleBlockToggle = async () => {
    if (!profile || busy) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      if (blocked) {
        await unblockUser(profile.uid);
      } else {
        await blockUser(profile);
        showToast(`@${profile.username} blocked`, 'success');
      }
    } catch {
      showToast('Could not update. Try again.', 'error');
    }
    setBusy(false);
  };

  const handleReport = async (reason: string) => {
    if (!profile) return;
    setReportOpen(false);
    try {
      await report('user', profile.uid, reason);
      showToast('Report received. Thank you.', 'success');
    } catch {
      showToast('Could not send report. Try again.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
        <AppBar title="Profile" onBack={() => navigate(-1)} />
        <div className="flex-1 flex items-center justify-center px-8">
          <EmptyState icon="person_off" title="Profile not found" description="This member may have left ZipRIGHT." />
        </div>
      </div>
    );
  }

  const online = isOnline(profile.lastActiveAt);

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink pb-28">
      <AppBar
        title={`@${profile.username}`}
        onBack={() => navigate(-1)}
        trailing={!isMe ? (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="More options"
            className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">more_horiz</span>
          </button>
        ) : undefined}
      />

      <div className="px-6 pt-6">
        {/* Identity */}
        <div className="flex items-start gap-5">
          <div className="relative shrink-0">
            <div className="h-20 w-20 rounded-full border border-line overflow-hidden flex items-center justify-center bg-surface-1">
              {profile.photoURL ? (
                <img src={profile.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="font-display text-[28px] font-medium text-ink">{profile.displayName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            {online && (
              <span
                className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-0"
                aria-label="Online now"
              />
            )}
          </div>
          <div className="min-w-0 pt-1">
            <h1 className="font-display text-[24px] leading-tight font-medium truncate">{profile.displayName}</h1>
            <p className="text-ink-faint text-[13px] mt-0.5">@{profile.username}{online ? ' · online' : ''}</p>
            {profile.bio ? <p className="text-ink-soft text-[13px] leading-relaxed mt-2">{profile.bio}</p> : null}
          </div>
        </div>

        {/* Stats — editorial hairline row */}
        <div className="flex items-center mt-6 border-y border-line divide-x divide-line">
          {[
            { n: looks.length, label: looks.length === 1 ? 'Look' : 'Looks' },
            { n: profile.followersCount || 0, label: 'Followers' },
            { n: profile.followingCount || 0, label: 'Following' },
          ].map(s => (
            <div key={s.label} className="flex-1 py-3.5 text-center">
              <p className="font-display text-[20px] font-medium leading-none">{s.n}</p>
              <p className="eyebrow !text-[9px] mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        {!isMe && (
          <div className="flex gap-3 mt-5">
            {blocked ? (
              <Button variant="outline" fullWidth onClick={handleBlockToggle} loading={busy}>Unblock</Button>
            ) : (
              <>
                <Button
                  fullWidth
                  variant={followed ? 'outline' : 'primary'}
                  icon={followed ? 'check' : 'person_add'}
                  onClick={handleFollowToggle}
                  loading={busy}
                >
                  {followed ? 'Following' : 'Follow'}
                </Button>
                <Button variant="outline" fullWidth icon="chat_bubble" onClick={() => navigate(`/chat/${profile.uid}`)}>
                  Message
                </Button>
              </>
            )}
          </div>
        )}
        {isMe && (
          <Button variant="outline" fullWidth icon="edit" className="mt-5" onClick={() => navigate('/settings', { state: { view: 'edit-profile' } })}>
            Edit profile
          </Button>
        )}

        {/* Looks grid */}
        <div className="mt-8">
          <Eyebrow className="mb-3">{isMe ? 'Your looks' : 'Looks'}</Eyebrow>
          {looks.length === 0 ? (
            <div className="py-10 text-center">
              <span className="material-symbols-outlined text-ink-faint text-[32px] mb-2" aria-hidden="true">photo_camera</span>
              <p className="text-ink-faint text-[13px]">{isMe ? 'Post your first look to The Salon.' : 'No looks posted yet.'}</p>
              {isMe && (
                <Button className="mt-4" icon="add" onClick={() => navigate('/create-look')}>Post a look</Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {looks.map(l => (
                <button
                  key={l.id}
                  onClick={() => navigate('/community')}
                  aria-label={l.caption || 'View look'}
                  className="relative aspect-[3/4] rounded-lg overflow-hidden bg-surface-2 active:scale-[0.98] transition-transform"
                >
                  <img src={l.mediaUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                  {l.likesCount > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 text-white text-[10px] font-semibold" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">favorite</span>
                      {l.likesCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ⋯ menu */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={`@${profile.username}`}>
        <div className="flex flex-col pb-4">
          <button
            onClick={handleBlockToggle}
            className="flex items-center gap-4 py-4 border-b border-line text-left active:opacity-70"
          >
            <span className="material-symbols-outlined text-danger text-[20px]" aria-hidden="true">block</span>
            <div>
              <p className="text-ink font-medium text-[14px]">{blocked ? 'Unblock' : 'Block'} @{profile.username}</p>
              <p className="text-ink-faint text-[12px]">{blocked ? 'They can appear in your feed again' : "They won't appear in your feed or message you"}</p>
            </div>
          </button>
          <button
            onClick={() => { setMenuOpen(false); setReportOpen(true); }}
            className="flex items-center gap-4 py-4 text-left active:opacity-70"
          >
            <span className="material-symbols-outlined text-warning text-[20px]" aria-hidden="true">flag</span>
            <div>
              <p className="text-ink font-medium text-[14px]">Report @{profile.username}</p>
              <p className="text-ink-faint text-[12px]">We review reports within 24 hours</p>
            </div>
          </button>
        </div>
      </Sheet>

      {/* Report reasons */}
      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title="Report">
        <div className="flex flex-col pb-4">
          <AnimatePresence>
            {REPORT_REASONS.map((r, i) => (
              <motion.button
                key={r}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => handleReport(r)}
                className="py-4 border-b border-line last:border-none text-left text-ink text-[14px] active:opacity-70"
              >
                {r}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </Sheet>
    </div>
  );
};

export default UserProfile;
