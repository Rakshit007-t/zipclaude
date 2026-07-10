/**
 * Closet — the user's saved things: wishlist ("likes"), cart, wardrobe, and
 * passed (swiped-away) products. One tiny API used by Home, the Reel,
 * Marketplace, Wishlist, Cart, and Recent Scans so every heart/bag button in
 * the app is real.
 *
 * Persistence: localStorage is the source of truth for the UI (instant,
 * works for demo sessions). For signed-in Firebase users each write is
 * mirrored best-effort to the same Firestore subcollections the gifting flow
 * already uses (users/{uid}/likes|cart|wardrobe) — never blocking the UI.
 * ponytail: local-first mirror, add conflict sync only if multi-device matters.
 */
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

/**
 * 'likes'   = wishlist (saved from Marketplace, mirrored to Firestore)
 * 'liked'   = lightweight hearts from the Reel/Home (local taste signal only)
 * 'cart'    = the bag
 * 'wardrobe'= kept pieces
 * 'passed'  = reel dismissals (deck memory)
 */
export type ClosetKind = 'likes' | 'liked' | 'cart' | 'wardrobe' | 'passed';

/** Kinds that are device-local taste signals — never mirrored to Firestore. */
const LOCAL_ONLY: ClosetKind[] = ['passed', 'liked'];

export interface ClosetItem {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  url: string;
  affiliateLink?: string;
  category?: string;
  addedAt: number;
}

const CHANGE_EVENT = 'zr-closet-changed';
const keyFor = (kind: ClosetKind) => `zr_closet_${kind}`;

function read(kind: ClosetKind): ClosetItem[] {
  try {
    const raw = localStorage.getItem(keyFor(kind));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(kind: ClosetKind, items: ClosetItem[]) {
  try {
    localStorage.setItem(keyFor(kind), JSON.stringify(items));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Real (non-anonymous) Firebase user — mirror writes so data follows the account. */
function firestoreUser() {
  const user = auth.currentUser;
  return user && !user.isAnonymous ? user : null;
}

function mirrorAdd(kind: ClosetKind, item: ClosetItem) {
  const user = firestoreUser();
  if (!user || LOCAL_ONLY.includes(kind)) return;
  setDoc(doc(db, 'users', user.uid, kind, item.id), {
    productRefId: item.id,
    productUrl: item.affiliateLink || item.url,
    title: item.title,
    brand: item.brand,
    price: item.price,
    image: item.image,
    source: 'closet',
    timestamp: new Date(),
  }).catch(() => {});
}

function mirrorRemove(kind: ClosetKind, id: string) {
  const user = firestoreUser();
  if (!user || LOCAL_ONLY.includes(kind)) return;
  deleteDoc(doc(db, 'users', user.uid, kind, id)).catch(() => {});
}

export function listCloset(kind: ClosetKind): ClosetItem[] {
  return read(kind).sort((a, b) => b.addedAt - a.addedAt);
}

export function inCloset(kind: ClosetKind, id: string): boolean {
  return read(kind).some(i => i.id === id);
}

export function closetCount(kind: ClosetKind): number {
  return read(kind).length;
}

export function addToCloset(kind: ClosetKind, item: Omit<ClosetItem, 'addedAt'>): boolean {
  const items = read(kind);
  if (items.some(i => i.id === item.id)) return false;
  write(kind, [...items, { ...item, addedAt: Date.now() }]);
  mirrorAdd(kind, { ...item, addedAt: Date.now() });
  return true;
}

export function removeFromCloset(kind: ClosetKind, id: string) {
  write(kind, read(kind).filter(i => i.id !== id));
  mirrorRemove(kind, id);
}

/** Returns true if the item is now saved, false if it was removed. */
export function toggleCloset(kind: ClosetKind, item: Omit<ClosetItem, 'addedAt'>): boolean {
  if (inCloset(kind, item.id)) {
    removeFromCloset(kind, item.id);
    return false;
  }
  addToCloset(kind, item);
  return true;
}

/** Subscribe to any closet change (badges, lists). Returns unsubscribe. */
export function onClosetChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
