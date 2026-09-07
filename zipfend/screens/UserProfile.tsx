import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { updateProfile as updateAuthProfile } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { compressImage, uploadOrEncodeProfilePhoto } from '../utils/media';
import { calculateRank } from '../services/rewards';
import { listCloset } from '../services/closet';
import {
  PublicProfile, getProfile, follow, unfollow, onFollowing, onBlocked,
  blockUser, unblockUser, report, isOnline, defaultUsername,
} from '../services/social';
import { AppBar, Badge, Button, EmptyState, Eyebrow, Sheet, Spinner } from '../components/ui';

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

const HIGHLIGHTS = [
  { id: 'fits', title: 'Precision Fits', icon: 'straighten', badge: 'AI' },
  { id: 'vto', title: 'Try-Ons', icon: 'view_in_ar', badge: '3D' },
  { id: 'street', title: 'Street Style', icon: 'style', badge: '' },
  { id: 'favs', title: 'Top Looks', icon: 'auto_awesome', badge: '' },
];

type ProfileTab = 'posts' | 'tagged' | 'saved';

const UserProfile: React.FC = () => {
  const { uid: paramUid } = useParams<{ uid: string }>();
  const { navigate, goBack } = useAppNavigation();
  const { showToast } = useToast();
  const { userProfile, setUserProfile } = useUserProfile();

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [authUser, setAuthUser] = useState(auth.currentUser);
  const targetUid = paramUid || authUser?.uid;
  const isMe = !paramUid || (!!authUser && paramUid === authUser.uid);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [looks, setLooks] = useState<LookThumb[]>([]);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zipCoins, setZipCoins] = useState(0);
  const [giftsGiven, setGiftsGiven] = useState(0);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setAuthUser(user);
    });
    return () => unsubscribe();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file (JPG, PNG, or WebP).', 'error');
      return;
    }

    try {
      showToast('Updating profile photo...', 'info');
      const url = await uploadOrEncodeProfilePhoto(file);
      const user = auth.currentUser || authUser;

      if (user && !user.isAnonymous) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          await updateAuthProfile(user, { photoURL: url }).catch(() => {});
        }
        await setDoc(doc(db, 'users', user.uid), {
          photoURL: url,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        await setDoc(doc(db, 'publicProfiles', user.uid), {
          uid: user.uid,
          displayName: userProfile.displayName || userProfile.profileName || user.displayName || 'ZipRIGHT member',
          displayNameLower: (userProfile.displayName || userProfile.profileName || user.displayName || 'ZipRIGHT member').toLowerCase(),
          username: userProfile.username || defaultUsername(user.displayName),
          photoURL: url,
          bio: userProfile.bio || '',
          location: userProfile.location || '',
          website: userProfile.website || '',
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }

      try { localStorage.setItem('zipright_profile_photo', url); } catch {}
      setProfile(prev => prev ? { ...prev, photoURL: url } : {
        uid: user?.uid || '',
        displayName: userProfile.displayName || userProfile.profileName || user?.displayName || 'ZipRIGHT member',
        username: userProfile.username || 'member',
        photoURL: url,
        bio: userProfile.bio || '',
        location: userProfile.location || '',
        website: userProfile.website || '',
      });
      setUserProfile(prev => ({ ...prev, photoURL: url }));
      showToast('Profile photo updated!', 'success');
    } catch (err) {
      console.error('[UserProfile] Avatar upload error:', err);
      showToast('Could not upload photo. Try again.', 'error');
    }
  };

  // Previews
  const [wishlistItems, setWishlistItems] = useState(() => listCloset('likes'));

  const followed = !!targetUid && followingSet.has(targetUid);
  const blocked = !!targetUid && blockedSet.has(targetUid);

  useEffect(() => {
    if (!targetUid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [p, looksSnap] = await Promise.all([
        getProfile(targetUid),
        getDocs(query(
          collection(db, 'looks'),
          where('creatorId', '==', targetUid),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(30),
        )).catch(() => null),
      ]);
      if (cancelled) return;

      if (isMe) {
        setProfile({
          uid: (authUser || auth.currentUser)?.uid || targetUid,
          displayName: p?.displayName || userProfile.displayName || userProfile.profileName || (authUser || auth.currentUser)?.displayName || 'ZipRIGHT Member',
          username: p?.username || userProfile.username || 'member',
          photoURL: (userProfile.photoURL !== undefined ? userProfile.photoURL : (p?.photoURL || (authUser || auth.currentUser)?.photoURL)) || null,
          bio: p?.bio || userProfile.bio || '',
          location: p?.location || userProfile.location || '',
          website: p?.website || userProfile.website || '',
          followersCount: p?.followersCount || 0,
          followingCount: p?.followingCount || 0,
          postsCount: looksSnap?.docs.length || p?.postsCount || 0,
          lastActiveAt: p?.lastActiveAt || { toMillis: () => Date.now() },
        });
      } else if (p) {
        setProfile(p);
      }

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
  }, [targetUid, isMe, authUser, userProfile.displayName, userProfile.profileName, userProfile.photoURL, userProfile.username]);

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

  const handleShareProfile = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile?.displayName} on ZipRIGHT`, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Copied', 'success');
      }
    } catch {
      showToast('Copied', 'success');
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
        <AppBar title="Profile" onBack={() => goBack('/home')} />
        <div className="flex-1 flex items-center justify-center px-8">
          <EmptyState icon="person_off" title="Profile not found" description="This member may have left ZipRIGHT." />
        </div>
      </div>
    );
  }

  const online = isOnline(profile.lastActiveAt);
  const fitProfilesCount = Array.isArray(userProfile.fitProfiles) ? userProfile.fitProfiles.length : (userProfile.profileName ? 1 : 0);

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink pb-28">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
      {/* Top Header */}
      <AppBar
        title={`@${profile.username}`}
        onBack={() => goBack('/home')}
        trailing={
          isMe ? (
            <button
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">menu</span>
            </button>
          ) : (
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="More options"
              className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">more_horiz</span>
            </button>
          )
        }
      />

      {/* Main Profile Header - Clean Instagram + Apple Layout */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-6">
          {/* Large Avatar */}
          <button
            type="button"
            onClick={() => isMe && fileInputRef.current?.click()}
            className="relative shrink-0 group active:scale-95 transition-transform text-left"
            title={isMe ? 'Tap to change profile picture' : profile.displayName}
          >
            <div className="h-20 w-20 rounded-full border border-line p-0.5 overflow-hidden bg-surface-2 shadow-sm group-hover:border-brand">
              {profile.photoURL ? (
                <img src={profile.photoURL} alt={profile.displayName} className="h-full w-full object-cover rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="font-display text-[28px] font-medium text-ink flex items-center justify-center h-full">{(profile.displayName || 'Z').charAt(0).toUpperCase()}</span>
              )}
            </div>
            {isMe && (
              <div className="absolute bottom-0 right-0 bg-brand text-on-brand h-6 w-6 rounded-full flex items-center justify-center border-2 border-surface-0 shadow-sm">
                <span className="material-symbols-outlined text-[12px]">photo_camera</span>
              </div>
            )}
            {online && !isMe && (
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-0 shadow-sm" aria-label="Online" />
            )}
          </button>

          {/* Stats Bar */}
          <div className="flex-1 grid grid-cols-3 text-center">
            <button
              onClick={() => setActiveTab('posts')}
              className="py-1 rounded-xl hover:bg-surface-2/60 transition-colors active:scale-95"
            >
              <p className="font-display text-[18px] font-semibold text-ink leading-tight">{looks.length}</p>
              <p className="text-[11px] text-ink-faint mt-0.5">Posts</p>
            </button>
            <button
              onClick={() => navigate(targetUid ? `/profile/${targetUid}/followers` : '/profile/followers')}
              className="py-1 rounded-xl hover:bg-surface-2/60 transition-colors active:scale-95"
            >
              <p className="font-display text-[18px] font-semibold text-ink leading-tight">{profile.followersCount || 0}</p>
              <p className="text-[11px] text-ink-faint mt-0.5">Followers</p>
            </button>
            <button
              onClick={() => navigate(targetUid ? `/profile/${targetUid}/following` : '/profile/following')}
              className="py-1 rounded-xl hover:bg-surface-2/60 transition-colors active:scale-95"
            >
              <p className="font-display text-[18px] font-semibold text-ink leading-tight">{profile.followingCount || 0}</p>
              <p className="text-[11px] text-ink-faint mt-0.5">Following</p>
            </button>
          </div>
        </div>

        {/* Display Name & Bio */}
        <div className="mt-4">
          <h1 className="font-display text-[19px] font-semibold text-ink leading-tight">{profile.displayName}</h1>
          {profile.bio ? (
            <p className="text-[13px] text-ink-soft leading-relaxed mt-1.5">{profile.bio}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-faint mt-2">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">location_on</span>
              {profile.location ? profile.location : 'No location set'}
            </span>
            {profile.website ? (
              <a
                href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 hover:text-brand transition-colors truncate max-w-[180px]"
              >
                <span className="material-symbols-outlined text-[13px]">link</span>
                {profile.website.replace(/^https?:\/\//, '')}
              </a>
            ) : null}
          </div>
        </div>

        {/* Primary Action Buttons */}
        {isMe ? (
          <div className="flex gap-2.5 mt-5">
            <Button
              variant="outline"
              fullWidth
              size="sm"
              onClick={() => navigate('/profile/edit')}
            >
              Edit profile
            </Button>
            <Button
              variant="outline"
              fullWidth
              size="sm"
              onClick={handleShareProfile}
            >
              Share profile
            </Button>
          </div>
        ) : (
          <div className="flex gap-2.5 mt-5">
            {blocked ? (
              <Button variant="outline" fullWidth size="sm" onClick={handleBlockToggle} loading={busy}>Unblock</Button>
            ) : (
              <>
                <Button
                  fullWidth
                  size="sm"
                  variant={followed ? 'outline' : 'primary'}
                  onClick={handleFollowToggle}
                  loading={busy}
                >
                  {followed ? 'Following' : 'Follow'}
                </Button>
                <Button variant="outline" fullWidth size="sm" onClick={() => navigate(`/chat/${profile.uid}`)}>
                  Message
                </Button>
              </>
            )}
          </div>
        )}

        {/* Compact Rewards Section */}
        {false && (() => {
          const rankInfo = calculateRank(zipCoins);
          return (
            <button
              onClick={() => navigate('/rewards')}
              className="w-full text-left mt-5 p-4 rounded-2xl bg-surface-1 border border-line hover:border-brand/40 transition-colors shadow-sm active:scale-[0.99] group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="eyebrow !text-[9px]">Rewards & Status</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${rankInfo.badgeColor}`}>
                    <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>{rankInfo.icon}</span>
                    {rankInfo.rank}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-brand group-hover:underline flex items-center gap-0.5">
                  View <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-[12.5px] mt-2 mb-1.5">
                <span className="text-ink-soft">
                  <strong className="font-semibold text-ink">{zipCoins}</strong> ZipCoins · <strong className="font-semibold text-ink">{giftsGiven}</strong> Gifts Given
                </span>
                {rankInfo.nextRank && (
                  <span className="text-[11px] text-ink-faint">
                    Next: <strong className="text-ink">{rankInfo.nextRank}</strong>
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              {rankInfo.nextRank && (
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden border border-line/60">
                  <div
                    className="h-full bg-brand rounded-full transition-all duration-500"
                    style={{ width: `${rankInfo.progressPct}%` }}
                  />
                </div>
              )}
            </button>
          );
        })()}
      </div>

      {/* Tab Selector Bar - Instagram Hierarchy */}
      <div className="border-y border-line bg-surface-0 sticky top-[57px] z-20 flex">
        <button
          onClick={() => setActiveTab('posts')}
          aria-label="Posts tab"
          className={`flex-1 py-3 flex items-center justify-center border-b-2 transition-colors ${activeTab === 'posts' ? 'border-ink text-ink' : 'border-transparent text-ink-faint'}`}
        >
          <span className="material-symbols-outlined text-[22px]">grid_on</span>
        </button>
        <button
          onClick={() => setActiveTab('tagged')}
          aria-label="Tagged tab"
          className={`flex-1 py-3 flex items-center justify-center border-b-2 transition-colors ${activeTab === 'tagged' ? 'border-ink text-ink' : 'border-transparent text-ink-faint'}`}
        >
          <span className="material-symbols-outlined text-[22px]">person_pin</span>
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          aria-label="Saved tab"
          className={`flex-1 py-3 flex items-center justify-center border-b-2 transition-colors ${activeTab === 'saved' ? 'border-ink text-ink' : 'border-transparent text-ink-faint'}`}
        >
          <span className="material-symbols-outlined text-[22px]">bookmark</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="pt-2">
        {/* TAB 1: POSTS & LOOKS GRID */}
        {activeTab === 'posts' && (
          <div>
            {looks.length === 0 ? (
              <div className="py-16 text-center px-6">
                <span className="material-symbols-outlined text-ink-faint text-[36px] mb-2">photo_camera</span>
                <h3 className="font-display text-[18px] font-medium text-ink mb-1">{isMe ? 'No posts yet' : 'No posts'}</h3>
                <p className="text-[13px] text-ink-faint max-w-xs mx-auto mb-4">{isMe ? 'Share your fits and outfits with the ZipRIGHT community.' : 'This member has not posted any looks yet.'}</p>
                {isMe && (
                  <Button size="sm" icon="add" onClick={() => navigate('/create-look')}>Share your first look</Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {looks.map(l => (
                  <button
                    key={l.id}
                    onClick={() => navigate('/community')}
                    aria-label={l.caption || 'View look'}
                    className="relative aspect-square overflow-hidden bg-surface-2 active:opacity-80 transition-opacity"
                  >
                    <img src={l.mediaUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                    {l.likesCount > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 text-white text-[10px] font-semibold bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                        <span className="material-symbols-outlined text-[11px] text-brand" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                        {l.likesCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TAGGED LOOKS */}
        {activeTab === 'tagged' && (
          <div className="py-16 text-center px-6">
            <span className="material-symbols-outlined text-ink-faint text-[36px] mb-2">person_pin</span>
            <h3 className="font-display text-[18px] font-medium text-ink mb-1">Photos of you</h3>
            <p className="text-[13px] text-ink-faint max-w-xs mx-auto">When members tag you in their looks, they will appear here.</p>
          </div>
        )}

        {/* TAB 3: SAVED & WISHLIST */}
        {activeTab === 'saved' && (
          <div className="px-6 pt-4">
            {wishlistItems.length === 0 ? (
              <div className="py-16 text-center">
                <span className="material-symbols-outlined text-ink-faint text-[36px] mb-2">bookmark_border</span>
                <h3 className="font-display text-[18px] font-medium text-ink mb-1">No saved items</h3>
                <p className="text-[13px] text-ink-faint max-w-xs mx-auto mb-4">Only you can see what you've saved.</p>
                <Button size="sm" onClick={() => navigate('/marketplace')}>Explore Shop</Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {wishlistItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => navigate('/wishlist')}
                    className="aspect-square rounded-xl overflow-hidden bg-surface-2 border border-line active:opacity-80 transition-opacity"
                  >
                    <img src={item.image} alt={item.title} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Menu sheet for other users */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={`@${profile.username}`}>
        <div className="flex flex-col pb-4">
          <button
            onClick={handleBlockToggle}
            className="flex items-center gap-4 py-4 border-b border-line text-left active:opacity-70"
          >
            <span className="material-symbols-outlined text-danger text-[20px]">block</span>
            <div>
              <p className="text-ink font-medium text-[14px]">{blocked ? 'Unblock' : 'Block'} @{profile.username}</p>
              <p className="text-ink-faint text-[12px]">{blocked ? 'They can appear in your feed again' : "They won't appear in your feed or message you"}</p>
            </div>
          </button>
          <button
            onClick={() => { setMenuOpen(false); setReportOpen(true); }}
            className="flex items-center gap-4 py-4 text-left active:opacity-70"
          >
            <span className="material-symbols-outlined text-warning text-[20px]">flag</span>
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
