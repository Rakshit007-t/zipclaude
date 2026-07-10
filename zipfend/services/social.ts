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
    await setDoc(ref, {
      displayName,
      displayNameLower: displayName.toLowerCase(),
      username: data.username || defaultUsername(user.displayName),
      photoURL: user.photoURL || data.photoURL || null,
      email: (user.email || data.email || '').toLowerCase(),
      lastActiveAt: serverTimestamp(),
    }, { merge: true });
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
    updateDoc(doc(db, 'users', user.uid), { lastActiveAt: serverTimestamp() }).catch(() => {});
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
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? toProfile(uid, snap.data()) : null;
  } catch {
    return null;
  }
}

/** Search by @username (exact), name prefix, or email (exact). */
export async function searchUsers(term: string): Promise<PublicProfile[]> {
  const clean = term.trim().replace(/^@/, '').toLowerCase();
  if (clean.length < 2) return [];
  const users = collection(db, 'users');
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
  if (!user || target.uid === user.uid) return;
  const mine = await myProfile();
  await setDoc(doc(db, 'users', user.uid, 'following', target.uid), {
    uid: target.uid,
    displayName: target.displayName,
    username: target.username,
    photoURL: target.photoURL,
    followedAt: serverTimestamp(),
  });
  // Reverse edge + counters are best-effort (their doc, permissive rules assumed)
  setDoc(doc(db, 'users', target.uid, 'followers', user.uid), {
    uid: user.uid,
    displayName: mine?.displayName || user.displayName || 'ZipRIGHT member',
    username: mine?.username || defaultUsername(user.displayName),
    photoURL: mine?.photoURL || user.photoURL || null,
    followedAt: serverTimestamp(),
  }).catch(() => {});
  updateDoc(doc(db, 'users', target.uid), { followersCount: increment(1) }).catch(() => {});
  updateDoc(doc(db, 'users', user.uid), { followingCount: increment(1) }).catch(() => {});
}

export async function unfollow(targetUid: string): Promise<void> {
  const user = socialUser();
  if (!user) return;
  await deleteDoc(doc(db, 'users', user.uid, 'following', targetUid));
  deleteDoc(doc(db, 'users', targetUid, 'followers', user.uid)).catch(() => {});
  updateDoc(doc(db, 'users', targetUid), { followersCount: increment(-1) }).catch(() => {});
  updateDoc(doc(db, 'users', user.uid), { followingCount: increment(-1) }).catch(() => {});
}

/** Live set of uids I follow (badge/button state). Returns unsubscribe. */
export function onFollowing(cb: (uids: Set<string>) => void): () => void {
  const user = socialUser();
  if (!user) { cb(new Set()); return () => {}; }
  return onSnapshot(collection(db, 'users', user.uid, 'following'), snap => {
    cb(new Set(snap.docs.map(d => d.id)));
  }, () => cb(new Set()));
}

export async function listFollowers(uid: string): Promise<PublicProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'followers'));
    return snap.docs.map(d => toProfile(d.id, d.data()));
  } catch { return []; }
}

export async function listFollowing(uid: string): Promise<PublicProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'following'));
    return snap.docs.map(d => toProfile(d.id, d.data()));
  } catch { return []; }
}

// ---- Block & report --------------------------------------------------------

export async function blockUser(target: PublicProfile): Promise<void> {
  const user = socialUser();
  if (!user) return;
  await setDoc(doc(db, 'users', user.uid, 'blocked', target.uid), {
    uid: target.uid,
    displayName: target.displayName,
    username: target.username,
    blockedAt: serverTimestamp(),
  });
  // Blocking severs the graph both ways, best-effort
  unfollow(target.uid).catch(() => {});
  deleteDoc(doc(db, 'users', user.uid, 'followers', target.uid)).catch(() => {});
  deleteDoc(doc(db, 'users', target.uid, 'following', user.uid)).catch(() => {});
}

export async function unblockUser(targetUid: string): Promise<void> {
  const user = socialUser();
  if (!user) return;
  await deleteDoc(doc(db, 'users', user.uid, 'blocked', targetUid));
}

export function onBlocked(cb: (uids: Set<string>) => void): () => void {
  const user = socialUser();
  if (!user) { cb(new Set()); return () => {}; }
  return onSnapshot(collection(db, 'users', user.uid, 'blocked'), snap => {
    cb(new Set(snap.docs.map(d => d.id)));
  }, () => cb(new Set()));
}

export async function report(subjectType: 'user' | 'look' | 'message', subjectId: string, reason: string): Promise<void> {
  const user = socialUser();
  if (!user) return;
  await addDoc(collection(db, 'reports'), {
    reporterUid: user.uid,
    subjectType,
    subjectId,
    reason,
    createdAt: serverTimestamp(),
  });
}
