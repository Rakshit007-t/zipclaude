import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { addToCloset } from '../services/closet';
import { AppBar, Button, EmptyState, Spinner, Badge } from '../components/ui';

interface Gift {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  product: {
    id: string; title: string; brand: string;
    price: string; image: string; url: string; affiliateLink: string;
  };
  note: string;
  sentAt: any;
  seen: boolean;
  action: null | 'carted' | 'wardrobed' | 'liked';
}

const GiftInbox: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { navigate('/login'); return; }

    const q = query(
      collection(db, 'gifts'),
      where('recipientUid', '==', user.uid),
      orderBy('sentAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Gift[];
      setGifts(fetched);
      setLoading(false);

      // Mark unseen gifts as seen in one batch (single snapshot re-fire) and
      // award +5 coins each — both best-effort, never blocking the render.
      const unseenGifts = snap.docs.filter(d => !d.data().seen);
      if (unseenGifts.length === 0) return;
      const batch = writeBatch(db);
      unseenGifts.forEach(g => batch.update(doc(db, 'gifts', g.id), { seen: true }));
      batch.commit().catch(() => {});
      updateDoc(doc(db, 'users', user.uid), { zipPoints: increment(5 * unseenGifts.length) }).catch(() => {});
    });

    return () => unsub();
  }, [navigate]);

  const handleGiftAction = async (
    gift: Gift,
    action: 'carted' | 'wardrobed' | 'liked'
  ) => {
    const user = auth.currentUser;
    if (!user) return;

    const closetKind = action === 'carted' ? 'cart' : action === 'wardrobed' ? 'wardrobe' : 'likes';
    const dateField = action === 'carted' ? 'addedAt' : action === 'wardrobed' ? 'savedAt' : 'timestamp';

    try {
      await updateDoc(doc(db, 'gifts', gift.id), {
        action,
        actionAt: new Date(),
      });

      await addDoc(collection(db, 'users', user.uid, closetKind), {
        productRefId: gift.product.id,
        productUrl: gift.product.affiliateLink || gift.product.url,
        [dateField]: new Date(),
        source: 'gift',
      });

      // Firestore writes succeeded — now mirror into the local closet so the
      // item shows up in Bag/Wardrobe/Wishlist immediately.
      addToCloset(closetKind, {
        id: gift.product.id,
        title: gift.product.title,
        brand: gift.product.brand,
        price: gift.product.price,
        image: gift.product.image,
        url: gift.product.url,
        affiliateLink: gift.product.affiliateLink,
      });

      // The card collapsing to "Added to cart / Saved / Liked" is the feedback;
      // only the cart action gets a toast because it carries the coin reward.
      if (action === 'carted') {
        updateDoc(doc(db, 'users', user.uid), { zipPoints: increment(10) }).catch(() => {});
        showToast('Added to cart! +10 ZipCoins', 'success');
      }
    } catch {
      showToast('Could not save that. Try again.', 'error');
    }
  };

  const unseenCount = gifts.filter(g => !g.seen || g.action === null).length;

  const actionLabel = (a: Gift['action']) =>
    a === 'carted' ? 'Added to cart' : a === 'wardrobed' ? 'Saved to wardrobe' : 'Liked';

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
      <AppBar
        title="Gift inbox"
        onBack={() => navigate(-1)}
        trailing={unseenCount > 0 ? <Badge variant="brand">{unseenCount} new</Badge> : undefined}
      />

      {/* BODY */}
      <div className="flex-1 px-6 py-6 overflow-y-auto">

        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-faint">
            <Spinner size={26} />
          </div>
        ) : gifts.length === 0 ? (
          <EmptyState
            icon="featured_seasonal_and_gifts"
            title="No gifts yet"
            description="When a friend gifts you a look, it'll appear here."
            action={<Button icon="explore" onClick={() => navigate('/home')}>Explore the feed</Button>}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <AnimatePresence>
              {gifts.map((gift, i) => {
                const isNew = !gift.seen || gift.action === null;
                return (
                  <motion.div
                    key={gift.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`rounded-card border overflow-hidden ${isNew ? 'border-brand/40 bg-surface-1' : 'border-line bg-surface-1'}`}
                  >
                    {/* NEW badge */}
                    {isNew && (
                      <div className="px-5 pt-3.5 flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-brand" />
                        <span className="text-brand text-[10px] font-semibold uppercase tracking-[0.14em]">New gift</span>
                      </div>
                    )}

                    {/* Product row */}
                    <div className="p-4 flex gap-4">
                      <button
                        className="h-24 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2"
                        onClick={() => window.open(gift.product.affiliateLink || gift.product.url, '_blank')}
                        aria-label={`Open ${gift.product.title}`}
                      >
                        <img src={gift.product.image} alt={gift.product.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      </button>
                      <div className="flex-1 flex flex-col justify-between py-0.5 min-w-0">
                        <div>
                          <p className="font-display text-[16px] font-medium text-ink leading-tight">{gift.product.brand}</p>
                          <p className="text-ink-soft text-[12px] leading-tight mt-0.5 line-clamp-2">{gift.product.title}</p>
                          <p className="text-ink font-semibold text-[13px] mt-1">{gift.product.price}</p>
                        </div>
                        <div className="mt-2">
                          <p className="text-ink-faint text-[12px]">
                            From <span className="text-ink font-medium">@{gift.senderUsername}</span>
                          </p>
                          {gift.note ? (
                            <p className="text-ink-soft text-[12px] italic mt-0.5">"{gift.note}"</p>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {gift.action === null ? (
                      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                        <Button size="sm" variant="outline" icon="shopping_bag" onClick={() => handleGiftAction(gift, 'carted')}>Cart</Button>
                        <Button size="sm" variant="outline" icon="checkroom" onClick={() => handleGiftAction(gift, 'wardrobed')}>Keep</Button>
                        <Button size="sm" variant="outline" icon="favorite" onClick={() => handleGiftAction(gift, 'liked')}>Like</Button>
                      </div>
                    ) : (
                      <div className="px-5 pb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-success text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span>
                        <p className="text-ink-faint text-[12px]">{actionLabel(gift.action)}</p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default GiftInbox;
