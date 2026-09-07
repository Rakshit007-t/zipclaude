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
  quantity?: number;
}

const CHANGE_EVENT = 'zr-closet-changed';
// Saved commerce data is private. A browser can be used by multiple accounts,
// so never share one account's cart or wishlist through an unscoped key.
const keyFor = (kind: ClosetKind) => {
  const owner = auth.currentUser?.uid || 'guest';
  return `zr_closet_${owner}_${kind}`;
};

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
    quantity: item.quantity || 1,
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
  return read(kind).reduce((sum, item) => sum + (item.quantity || 1), 0);
}

export function addToCloset(kind: ClosetKind, item: Omit<ClosetItem, 'addedAt'>): boolean {
  const items = read(kind);
  const existingIndex = items.findIndex(i => i.id === item.id);
  if (existingIndex >= 0) {
    if (kind === 'cart') {
      const updated = [...items];
      const currentQty = updated[existingIndex].quantity || 1;
      updated[existingIndex] = { ...updated[existingIndex], quantity: currentQty + 1 };
      write(kind, updated);
      mirrorAdd(kind, updated[existingIndex]);
      return true;
    }
    return false;
  }
  const newItem = { ...item, quantity: item.quantity || 1, addedAt: Date.now() };
  write(kind, [...items, newItem]);
  mirrorAdd(kind, newItem);
  return true;
}

export function updateQuantity(kind: ClosetKind, id: string, delta: number) {
  const items = read(kind);
  const existing = items.find(i => i.id === id);
  if (!existing) return;
  const newQty = (existing.quantity || 1) + delta;
  if (newQty <= 0) {
    removeFromCloset(kind, id);
  } else {
    const updated = items.map(i => i.id === id ? { ...i, quantity: newQty } : i);
    write(kind, updated);
    mirrorAdd(kind, { ...existing, quantity: newQty });
  }
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
