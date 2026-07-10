/**
 * Direct messages — Firestore + Storage, frontend-only (backend frozen).
 *
 *   conversations/{convId}          convId = both uids sorted, joined by '_'
 *     members: [uidA, uidB]
 *     memberInfo: { [uid]: { displayName, username, photoURL } }
 *     lastMessage: { type, text, from, at }
 *     updatedAt, lastRead: { [uid]: ts }, typing: { [uid]: ts }
 *   conversations/{convId}/messages/{id}
 *     from, type: 'text'|'image'|'voice'|'product', text?, mediaUrl?,
 *     durationSec?, product?, createdAt
 *
 * Images/voice upload to Storage under dm/{convId}/ (same pattern CreateLook
 * already uses for look photos).
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import app, { auth, db } from '../firebase';
import { PublicProfile, myProfile, socialUser } from './social';

const storage = getStorage(app);

export type MessageType = 'text' | 'image' | 'voice' | 'product';

export interface DMProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  url: string;
}

export interface DirectMessage {
  id: string;
  from: string;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  durationSec?: number;
  product?: DMProduct;
  createdAt: { toMillis?: () => number } | null;
}

export interface Conversation {
  id: string;
  members: string[];
  memberInfo: Record<string, { displayName: string; username: string; photoURL: string | null }>;
  lastMessage?: { type: MessageType; text: string; from: string; at?: { toMillis?: () => number } };
  updatedAt?: { toMillis?: () => number };
  lastRead?: Record<string, { toMillis?: () => number }>;
  typing?: Record<string, { toMillis?: () => number }>;
}

export function conversationId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/** Create/refresh the conversation doc for me + other. Returns convId. */
export async function openConversation(other: PublicProfile): Promise<string | null> {
  const user = socialUser();
  if (!user || other.uid === user.uid) return null;
  const convId = conversationId(user.uid, other.uid);
  const mine = await myProfile();
  await setDoc(doc(db, 'conversations', convId), {
    members: [user.uid, other.uid].sort(),
    memberInfo: {
      [user.uid]: {
        displayName: mine?.displayName || 'ZipRIGHT member',
        username: mine?.username || 'member',
        photoURL: mine?.photoURL || null,
      },
      [other.uid]: {
        displayName: other.displayName,
        username: other.username,
        photoURL: other.photoURL,
      },
    },
  }, { merge: true });
  return convId;
}

/** Preview line for the chat list. */
function preview(type: MessageType, text?: string, product?: DMProduct): string {
  if (type === 'image') return '📷 Photo';
  if (type === 'voice') return '🎙 Voice message';
  if (type === 'product') return `👗 ${product?.brand || 'A look'}`;
  return text || '';
}

async function writeMessage(convId: string, payload: Omit<DirectMessage, 'id' | 'createdAt' | 'from'>): Promise<void> {
  const user = socialUser();
  if (!user) throw new Error('not signed in');
  await addDoc(collection(db, 'conversations', convId, 'messages'), {
    ...payload,
    from: user.uid,
    createdAt: serverTimestamp(),
  });
  // Conversation summary — also clears my typing state in the same write
  await setDoc(doc(db, 'conversations', convId), {
    lastMessage: {
      type: payload.type,
      text: preview(payload.type, payload.text, payload.product),
      from: user.uid,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
    typing: { [user.uid]: null },
    lastRead: { [user.uid]: serverTimestamp() },
  }, { merge: true });
}

export function sendText(convId: string, text: string): Promise<void> {
  return writeMessage(convId, { type: 'text', text: text.trim() });
}

export async function sendImage(convId: string, file: File | Blob): Promise<void> {
  const path = `dm/${convId}/${Date.now()}_photo.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const mediaUrl = await getDownloadURL(storageRef);
  return writeMessage(convId, { type: 'image', mediaUrl });
}

export async function sendVoice(convId: string, blob: Blob, durationSec: number): Promise<void> {
  const path = `dm/${convId}/${Date.now()}_voice.webm`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  const mediaUrl = await getDownloadURL(storageRef);
  return writeMessage(convId, { type: 'voice', mediaUrl, durationSec: Math.round(durationSec) });
}

export function sendProduct(convId: string, product: DMProduct, text?: string): Promise<void> {
  return writeMessage(convId, { type: 'product', product, ...(text ? { text } : {}) });
}

/** Live message stream, oldest first. Returns unsubscribe. */
export function onMessages(convId: string, cb: (msgs: DirectMessage[]) => void): () => void {
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as DirectMessage)));
  }, () => cb([]));
}

/** Live conversation doc (typing, lastRead). Returns unsubscribe. */
export function onConversation(convId: string, cb: (conv: Conversation | null) => void): () => void {
  return onSnapshot(doc(db, 'conversations', convId), snap => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Conversation) : null);
  }, () => cb(null));
}

/** Live chat list for the signed-in user, newest first. Returns unsubscribe. */
export function onConversations(cb: (convs: Conversation[]) => void): () => void {
  const user = socialUser();
  if (!user) { cb([]); return () => {}; }
  const q = query(
    collection(db, 'conversations'),
    where('members', 'array-contains', user.uid),
  );
  return onSnapshot(q, snap => {
    const convs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
    convs.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    cb(convs);
  }, () => cb([]));
}

// Typing writes are throttled: one Firestore write per 3s of continuous typing
let lastTypingWrite = 0;

export function setTyping(convId: string): void {
  const user = socialUser();
  if (!user) return;
  const now = Date.now();
  if (now - lastTypingWrite < 3000) return;
  lastTypingWrite = now;
  setDoc(doc(db, 'conversations', convId), {
    typing: { [user.uid]: serverTimestamp() },
  }, { merge: true }).catch(() => {});
}

export function clearTyping(convId: string): void {
  const user = socialUser();
  if (!user) return;
  setDoc(doc(db, 'conversations', convId), {
    typing: { [user.uid]: null },
  }, { merge: true }).catch(() => {});
}

/** Typing is live if the other side wrote a typing timestamp in the last 6s. */
export function isTypingNow(conv: Conversation | null, otherUid: string): boolean {
  const ts = conv?.typing?.[otherUid]?.toMillis?.();
  return !!ts && Date.now() - ts < 6000;
}

export function markRead(convId: string): void {
  const user = socialUser();
  if (!user) return;
  setDoc(doc(db, 'conversations', convId), {
    lastRead: { [user.uid]: serverTimestamp() },
  }, { merge: true }).catch(() => {});
}

/** Has the other participant seen this message of mine? */
export function seenByOther(conv: Conversation | null, otherUid: string, msg: DirectMessage): boolean {
  const read = conv?.lastRead?.[otherUid]?.toMillis?.();
  const sent = msg.createdAt?.toMillis?.();
  return !!read && !!sent && read >= sent;
}

/** Unread count for the chat list: conversations whose lastMessage is newer than my lastRead. */
export function unreadConversations(convs: Conversation[]): number {
  const user = auth.currentUser;
  if (!user) return 0;
  return convs.filter(c => {
    const last = c.lastMessage?.at?.toMillis?.();
    if (!last || c.lastMessage?.from === user.uid) return false;
    const read = c.lastRead?.[user.uid]?.toMillis?.();
    return !read || last > read;
  }).length;
}
