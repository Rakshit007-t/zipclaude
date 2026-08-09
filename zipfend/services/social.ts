/**
 * Social — public profiles, follow graph, presence, block/report.
 * Frontend-only on Firestore (backend is frozen). Collections:
 *   users/{uid}                    — public profile fields (merge-written, never clobbers fit data)
 *   users/{uid}/following/{uid2}   — I follow uid2 (doc ID = target uid)
 *   users/{uid}/followers/{uid2}   — uid2 follows me
 *   users/{uid}/blocked/{uid2}
 *   reports                        — { reporterUid, subjectType, subjectId, reason, createdAt }
 *
 * ponytail: counters via increment() on the profile doc — good enough until a
 * Cloud Function maintains them transactionally.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { authorizedFetch, getBackendBaseUrl } from './ziprightApi';

export interface PublicProfile {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string | null;
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  lastActiveAt?: { toMillis?: () => number } | null;
}

/** Real (non-anonymous) Firebase user — social writes need a real account. */
export function socialUser() {
  const user = auth.currentUser;
  return user && !user.isAnonymous ? user : null;
}

/** Same username formula CreateLook/GiftLook already use. */
export function defaultUsername(displayName?: string | null) {
  return (displayName || 'user').toLowerCase().replace(/\s+/g, '_') + '_zr';
}

function toProfile(uid: string, data: Record<string, any>): PublicProfile {
  return {
    uid,
    displayName: data.displayName || data.username || 'ZipRIGHT member',
    username: data.username || defaultUsername(data.displayName),
    photoURL: data.photoURL || data.photoUrl || null,
    bio: data.bio || '',
    followersCount: data.followersCount || 0,
    followingCount: data.followingCount || 0,
    postsCount: data.postsCount || 0,
    lastActiveAt: data.lastActiveAt || null,
  };
}

/** My own public profile snapshot (for stamping onto edges/messages). */
export async function myProfile(): Promise<PublicProfile | null> {
  const user = socialUser();
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.data() || {};
    return toProfile(user.uid, {
      displayName: user.displayName || data.displayName,
      username: data.username,
      photoURL: user.photoURL || data.photoURL,
      ...data,
    });
  } catch {
    return toProfile(user.uid, { displayName: user.displayName, photoURL: user.photoURL });
  }
}

/**
 * Merge public profile fields onto users/{uid} so search/presence work.
 * Call once per app boot for signed-in users; safe to repeat.
 */
export async function ensureUserDoc(): Promise<void> {
  const user = socialUser();
  if (!user) return;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const data = snap.data() || {};
    const displayName = user.displayName || data.displayName || 'ZipRIGHT member';
    const publicProfile = {
      uid: user.uid,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      username: data.username || defaultUsername(user.displayName),
      photoURL: user.photoURL || data.photoURL || null,
      lastActiveAt: serverTimestamp(),
    };
    await setDoc(ref, publicProfile, { merge: true });
    await setDoc(doc(db, 'publicProfiles', user.uid), publicProfile, { merge: true });
  } catch {}
}

// ---- Presence ------------------------------------------------------------

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function isOnline(lastActiveAt?: PublicProfile['lastActiveAt']): boolean {
  const ms = lastActiveAt?.toMillis?.();
  return !!ms && Date.now() - ms < ONLINE_WINDOW_MS;
}

/** Heartbeat lastActiveAt every 60s while the tab is visible. Returns stop. */
export function startPresence(): () => void {
  const beat = () => {
    const user = socialUser();
    if (!user || document.visibilityState !== 'visible') return;
    const timestamp = serverTimestamp();
    updateDoc(doc(db, 'users', user.uid), { lastActiveAt: timestamp }).catch(() => {});
    updateDoc(doc(db, 'publicProfiles', user.uid), { lastActiveAt: timestamp }).catch(() => {});
  };
  beat();
  const id = setInterval(beat, 60_000);
  document.addEventListener('visibilitychange', beat);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', beat);
  };
}

// ---- Profiles & search ----------------------------------------------------

export async function getProfile(uid: string): Promise<PublicProfile | null> {
  try {
    const source = uid === auth.currentUser?.uid ? 'users' : 'publicProfiles';
    const snap = await getDoc(doc(db, source, uid));
    return snap.exists() ? toProfile(uid, snap.data()) : null;
  } catch {
    return null;
  }
}

/** Search by @username (exact), name prefix, or email (exact). */
export async function searchUsers(term: string): Promise<PublicProfile[]> {
  const clean = term.trim().replace(/^@/, '').toLowerCase();
  if (clean.length < 2) return [];
  const users = collection(db, 'publicProfiles');
  const queries = [
    query(users, where('username', '==', clean), limit(5)),
    query(users, where('displayNameLower', '>=', clean), where('displayNameLower', '<=', clean + ''), limit(8)),
  ];
  if (clean.includes('@')) queries.push(query(users, where('email', '==', clean), limit(3)));
  const results = await Promise.allSettled(queries.map(q => getDocs(q)));
  const seen = new Map<string, PublicProfile>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    r.value.docs.forEach(d => { if (!seen.has(d.id)) seen.set(d.id, toProfile(d.id, d.data())); });
  }
  const meUid = auth.currentUser?.uid;
  return [...seen.values()].filter(p => p.uid !== meUid);
}

// ---- Follow graph ----------------------------------------------------------

export async function follow(target: PublicProfile): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to follow members.');
  if (target.uid === user.uid) throw new Error("You can't follow yourself.");
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/follow/${encodeURIComponent(target.uid)}`, { method: 'POST' });
  if (!response.ok) throw new Error('Could not update follow status.');
}

export async function unfollow(targetUid: string): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to update follows.');
  if (targetUid === user.uid) return;
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/follow/${encodeURIComponent(targetUid)}`, { method: 'POST' });
  if (!response.ok) throw new Error('Could not update follow status.');
}

/** Live set of the signed-in user's following edges. Firestore rules only
 * expose this collection to its owner; other profile lists go through the API. */
export function onFollowing(cb: (uids: Set<string>) => void): () => void {
  const user = socialUser();
  if (!user) { cb(new Set()); return () => {}; }
  return onSnapshot(collection(db, 'users', user.uid, 'following'), snap => {
    cb(new Set(snap.docs.map(d => d.id)));
  }, () => cb(new Set()));
}

export async function listFollowers(uid: string): Promise<PublicProfile[]> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/users/${encodeURIComponent(uid)}/followers`);
  if (!response.ok) throw new Error('Could not load followers.');
  const payload = await response.json();
  return (payload.data || []).map((entry: any) => toProfile(entry.uid, {
    displayName: entry.display_name,
    username: entry.username,
    photoURL: entry.photo_url,
  }));
}

export async function listFollowing(uid: string): Promise<PublicProfile[]> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/users/${encodeURIComponent(uid)}/following`);
  if (!response.ok) throw new Error('Could not load following.');
  const payload = await response.json();
  return (payload.data || []).map((entry: any) => toProfile(entry.uid, {
    displayName: entry.display_name,
    username: entry.username,
    photoURL: entry.photo_url,
  }));
}

// ---- Block & report --------------------------------------------------------

export async function blockUser(target: PublicProfile): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to block members.');
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/users/${encodeURIComponent(target.uid)}/blocked`, { method: 'PUT' });
  if (!response.ok) throw new Error('Could not block member.');
}

export async function unblockUser(targetUid: string): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to update blocks.');
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/users/${encodeURIComponent(targetUid)}/blocked?enabled=false`, { method: 'PUT' });
  if (!response.ok) throw new Error('Could not unblock member.');
}

export async function muteUser(targetUid: string, enabled = true): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to mute members.');
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/users/${encodeURIComponent(targetUid)}/muted?enabled=${enabled}`, { method: 'PUT' });
  if (!response.ok) throw new Error('Could not update mute.');
}

export function onBlocked(cb: (uids: Set<string>) => void): () => void {
  const user = socialUser();
  if (!user) { cb(new Set()); return () => {}; }
  return onSnapshot(collection(db, 'users', user.uid, 'blocked'), snap => {
    cb(new Set(snap.docs.map(d => d.id)));
  }, () => cb(new Set()));
}

export async function report(subjectType: 'user' | 'post' | 'comment', subjectId: string, reason: string, description?: string): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('Sign in to submit a report.');
  const reasonMap: Record<string, string> = {
    'Spam': 'spam', 'Harassment': 'harassment', 'Nudity / Sexual Content': 'nudity',
    'Hate': 'hate', 'Violence': 'violence', 'Scam / Fraud': 'scam',
    'Impersonation': 'impersonation', 'Other': 'other',
  };
  const response = await authorizedFetch(`${getBackendBaseUrl()}/social/reports`, {
    method: 'POST',
    body: JSON.stringify({ target_type: subjectType, target_id: subjectId, reason: reasonMap[reason] || 'other', description }),
  });
  if (!response.ok) throw new Error('Could not submit report.');
}
