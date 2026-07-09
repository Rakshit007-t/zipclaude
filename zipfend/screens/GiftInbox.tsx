import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';

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

    const unsub = onSnapshot(q, async (snap) => {
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Gift[];
      setGifts(fetched);
      setLoading(false);

      // Mark unseen gifts as seen + award recipient coins
      const unseenGifts = snap.docs.filter(d => !d.data().seen);
      for (const giftDoc of unseenGifts) {
        await updateDoc(doc(db, 'gifts', giftDoc.id), { seen: true });
        // Award 5 ZipCoins to recipient for opening
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const currentPoints = userSnap.data().zipPoints || 0;
          await updateDoc(userRef, { zipPoints: currentPoints + 5 });
        }
      }
    });

    return () => unsub();
  }, [navigate]);

  const handleGiftAction = async (
    gift: Gift,
    action: 'carted' | 'wardrobed' | 'liked'
  ) => {
    const user = auth.currentUser;
    if (!user) return;

    // Update gift action
    await updateDoc(doc(db, 'gifts', gift.id), {
      action,
      actionAt: new Date(),
    });

    // Write to appropriate user subcollection
    if (action === 'carted') {
      await addDoc(collection(db, 'users', user.uid, 'cart'), {
        productRefId: gift.product.id,
        productUrl: gift.product.affiliateLink || gift.product.url,
        addedAt: new Date(),
        source: 'gift',
      });
      // Award extra ZipCoins for carting a gifted item
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (userSnap.exists()) {
        const currentPoints = userSnap.data().zipPoints || 0;
        await updateDoc(doc(db, 'users', user.uid), { zipPoints: currentPoints + 10 });
      }
      showToast(`Added to cart! +10 ZipCoins 🛒`, 'success');
    } else if (action === 'wardrobed') {
      await addDoc(collection(db, 'users', user.uid, 'wardrobe'), {
        productRefId: gift.product.id,
        productUrl: gift.product.affiliateLink || gift.product.url,
        savedAt: new Date(),
        source: 'gift',
      });
      showToast('Saved to your wardrobe ✦', 'success');
    } else if (action === 'liked') {
      await addDoc(collection(db, 'users', user.uid, 'likes'), {
        productRefId: gift.product.id,
        productUrl: gift.product.affiliateLink || gift.product.url,
        timestamp: new Date(),
        source: 'gift',
      });
      showToast('Added to wishlist ♥', 'success');
    }
  };

  const unseenCount = gifts.filter(g => !g.seen || g.action === null).length;

  return (
    <div className="min-h-screen bg-surface-0 text-ink font-body flex flex-col">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5
        bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back" onClick={() => navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 active:scale-90">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]">arrow_back</span>
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-xs font-bold text-[#6157FF]">Gift Inbox</h1>
          {unseenCount > 0 && (
            <span className="bg-[#6157FF] text-ink text-[11px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {unseenCount}
            </span>
          )}
        </div>
        <div className="w-10" />
      </div>

      {/* BODY */}
      <div className="flex-1 px-5 py-6 overflow-y-auto">

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#6157FF]" />
          </div>
        ) : gifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center">
            <div className="h-24 w-24 rounded-full bg-[#6157FF]/10 flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-[#6157FF] text-5xl"
                style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
            </div>
            <p className="text-ink font-bold text-lg mb-2">No gifts yet</p>
            <p className="text-ink-soft text-sm max-w-[220px] leading-relaxed">
              When a friend gifts you a look, it'll appear here.
            </p>
            <button
              onClick={() => navigate('/home')}
              className="mt-8 px-8 py-3 bg-[#6157FF] text-ink rounded-full font-bold text-xs active:scale-95"
            >
              Explore Feed
            </button>
          </div>
        ) : (
          <AnimatePresence>
            {gifts.map((gift, i) => (
              <motion.div
                key={gift.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`mb-4 rounded-3xl border overflow-hidden ${
                  !gift.seen || gift.action === null
                    ? 'border-[#6157FF]/30 bg-[#6157FF]/5'
                    : 'border-line bg-surface-2'
                }`}
              >
                {/* NEW badge */}
                {(!gift.seen || gift.action === null) && (
                  <div className="px-5 pt-3 pb-0 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#6157FF]" />
                    <span className="text-[#6157FF] text-[11px] font-bold">New gift</span>
                  </div>
                )}

                {/* Product row */}
                <div className="p-4 flex gap-4">
                  <div
                    className="h-24 w-24 rounded-xl overflow-hidden flex-shrink-0 bg-black/20 cursor-pointer"
                    onClick={() => window.open(gift.product.affiliateLink || gift.product.url, '_blank')}
                  >
                    <img src={gift.product.image} alt={gift.product.title}
                      className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-0.5">
                    <div>
                      <span className="text-[#6157FF] text-[11px] font-bold">
                        {gift.product.brand}
                      </span>
                      <p className="text-ink font-bold text-sm leading-tight mt-0.5 line-clamp-2">
                        {gift.product.title}
                      </p>
                      <p className="text-ink font-bold text-sm mt-1">{gift.product.price}</p>
                    </div>

                    {/* From + note */}
                    <div className="mt-2">
                      <p className="text-ink-soft text-[12px]">
                        From <span className="text-[#6157FF] font-bold">@{gift.senderUsername}</span>
                      </p>
                      {gift.note ? (
                        <p className="text-ink-soft text-xs mt-0.5">"{gift.note}"</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                {gift.action === null ? (
                  <div className="flex gap-2 px-4 pb-4">
                    <button
                      onClick={() => handleGiftAction(gift, 'carted')}
                      className="flex-1 bg-[#22c55e]/10 border border-[#22c55e]/25 text-[#22c55e] rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm"
                        style={{ fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
                      Cart
                    </button>
                    <button
                      onClick={() => handleGiftAction(gift, 'wardrobed')}
                      className="flex-1 bg-[#6157FF]/10 border border-[#6157FF]/25 text-[#6157FF] rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm"
                        style={{ fontVariationSettings: "'FILL' 1" }}>checkroom</span>
                      Wardrobe
                    </button>
                    <button
                      onClick={() => handleGiftAction(gift, 'liked')}
                      className="flex-1 bg-[#FF4D6D]/10 border border-[#FF4D6D]/25 text-[#FF4D6D] rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm"
                        style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                      Like
                    </button>
                  </div>
                ) : (
                  <div className="px-4 pb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-ink-faint text-sm"
                      style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <p className="text-ink-faint text-xs">
                      {gift.action === 'carted' ? 'Added to cart' :
                       gift.action === 'wardrobed' ? 'Saved to wardrobe' : 'Liked'}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default GiftInbox;
