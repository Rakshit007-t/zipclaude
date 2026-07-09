import React, { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';

interface Product {
  id: string; title: string; brand: string;
  price: string; image: string; url: string; affiliateLink?: string;
}

interface FoundUser {
  uid: string; username: string;
  displayName: string; photoURL: string | null;
}

const QUICK_NOTES = [
  "This screams you 👀",
  "Saw this and thought of you ✨",
  "Your vibe 100% 🔥",
  "We need you in this 😭",
  "Diwali look sorted? 🪔",
  "Office but make it fashion 💼",
];

const GiftLook: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const product = location.state?.product as Product | undefined;

  const [usernameQuery, setUsernameQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [searchError, setSearchError] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!product) {
    navigate('/home');
    return null;
  }

  // Debounced username search
  const handleUsernameChange = (val: string) => {
    setUsernameQuery(val);
    setFoundUser(null);
    setSearchError('');
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 3) return;
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const clean = val.startsWith('@') ? val.slice(1) : val;
        const q = query(collection(db, 'users'), where('username', '==', clean.toLowerCase()));
        const snap = await getDocs(q);
        if (snap.empty) {
          setSearchError('No user found with that username');
          setFoundUser(null);
        } else {
          const d = snap.docs[0];
          const data = d.data();
          // Prevent gifting to yourself
          if (d.id === auth.currentUser?.uid) {
            setSearchError("You can't gift to yourself 😄");
            setFoundUser(null);
          } else {
            setFoundUser({
              uid: d.id,
              username: data.username,
              displayName: data.displayName || data.username,
              photoURL: data.photoURL || data.photoUrl || null,
            });
          }
        }
      } catch {
        setSearchError('Search failed. Try again.');
      } finally {
        setSearching(false);
      }
    }, 600);
  };

  const handleSend = async () => {
    if (!foundUser || !auth.currentUser) return;
    setSending(true);
    try {
      const user = auth.currentUser;

      // Ensure sender has a username — if not, set a default
      const senderDoc = await getDoc(doc(db, 'users', user.uid));
      const senderData = senderDoc.data() || {};
      let senderUsername = senderData.username;
      if (!senderUsername) {
        senderUsername = (user.displayName || 'user').toLowerCase().replace(/\s+/g, '_') + '_zr';
        await updateDoc(doc(db, 'users', user.uid), { username: senderUsername });
      }

      // Write gift
      await addDoc(collection(db, 'gifts'), {
        senderId: user.uid,
        senderName: user.displayName || senderUsername,
        senderUsername,
        recipientUsername: foundUser.username,
        recipientUid: foundUser.uid,
        product: {
          id: product.id,
          title: product.title,
          brand: product.brand,
          price: product.price,
          image: product.image,
          url: product.url,
          affiliateLink: product.affiliateLink || product.url,
        },
        note: note.trim(),
        sentAt: new Date(),
        seen: false,
        action: null,
        actionAt: null,
        senderZipCoinsAwarded: true,
      });

      // Award ZipCoins to sender
      const currentPoints = senderData.zipPoints || 0;
      await updateDoc(doc(db, 'users', user.uid), {
        zipPoints: currentPoints + 15,
      });

      setSent(true);
    } catch (err) {
      showToast('Failed to send gift. Try again.', 'error');
    } finally {
      setSending(false);
    }
  };

  // SUCCESS STATE
  if (sent) {
    return (
      <div className="min-h-screen bg-surface-0 flex flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12 }}
          className="mb-8"
        >
          <div className="h-28 w-28 rounded-full bg-[#6157FF]/20 border border-[#6157FF]/30 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-[#6157FF] text-6xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              card_giftcard
            </span>
          </div>
          <h2 className="text-ink font-sans text-3xl font-bold mb-2">Gift Sent! 🎁</h2>
          <p className="text-ink-soft text-sm mb-1">
            @{foundUser?.username} will love it.
          </p>
          <p className="text-ink-faint text-xs">
            {note ? `"${note}"` : ''}
          </p>
        </motion.div>

        {/* ZipCoins earned */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-[#6157FF]/10 border border-[#6157FF]/20 rounded-2xl px-8 py-5 mb-10 flex items-center gap-4"
        >
          <span className="material-symbols-outlined text-[#6157FF] text-3xl"
            style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
          <div className="text-left">
            <p className="text-[#6157FF] font-bold text-xl">+15 ZipCoins</p>
            <p className="text-ink-soft text-xs">earned for gifting</p>
          </div>
        </motion.div>

        <button
          onClick={() => navigate('/home')}
          className="w-full max-w-xs bg-white text-[#111111] py-4 rounded-2xl font-bold text-sm active:scale-95"
        >
          Back to Feed
        </button>
        <button
          onClick={() => navigate('/gift-inbox')}
          className="mt-3 text-[#6157FF] text-sm font-bold active:opacity-70"
        >
          See your Gift Inbox →
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink font-body flex flex-col">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5
        bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back" onClick={() => navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 active:scale-90">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">Gift a Look</h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">

        {/* PRODUCT PREVIEW */}
        <div className="mx-5 mt-5 bg-surface-2 rounded-2xl p-4 border border-line flex gap-4">
          <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-black/30">
            <img src={product.image} alt={product.title}
              className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[#6157FF] text-[11px] font-bold mb-1">
              {product.brand}
            </span>
            <p className="text-ink font-bold text-sm leading-tight line-clamp-2">{product.title}</p>
            <p className="text-ink-soft text-sm font-bold mt-1">{product.price}</p>
          </div>
          <div className="ml-auto self-start">
            <span className="material-symbols-outlined text-[#6157FF] text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
          </div>
        </div>

        {/* FIND FRIEND */}
        <div className="mx-5 mt-7">
          <p className="text-ink-soft text-[12px] font-bold mb-3">
            Find your friend
          </p>

          {/* Search input */}
          <div className="flex items-center gap-3 bg-surface-2 border border-line rounded-2xl px-4 py-3.5">
            <span className="material-symbols-outlined text-ink-faint text-xl">alternate_email</span>
            <input
              type="text"
              placeholder="username"
              value={usernameQuery}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className="flex-1 bg-transparent text-ink text-sm placeholder-white/20 outline-none"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {searching && (
              <div className="h-4 w-4 rounded-full border-2 border-[#6157FF] border-t-transparent animate-spin" />
            )}
          </div>

          {/* Found user card */}
          <AnimatePresence>
            {foundUser && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mt-3 bg-[#6157FF]/10 border border-[#6157FF]/25 rounded-2xl px-4 py-3.5 flex items-center gap-3"
              >
                <div className="h-10 w-10 rounded-full bg-[#6157FF]/30 flex items-center justify-center flex-shrink-0">
                  {foundUser.photoURL ? (
                    <img src={foundUser.photoURL} className="h-full w-full rounded-full object-cover" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="material-symbols-outlined text-[#6157FF] text-xl">person</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-ink font-bold text-sm">{foundUser.displayName}</p>
                  <p className="text-[#6157FF] text-xs">@{foundUser.username}</p>
                </div>
                <span className="material-symbols-outlined text-[#22c55e] text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </motion.div>
            )}
            {searchError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 flex items-center gap-2 px-1"
              >
                <span className="material-symbols-outlined text-[#FF4D6D] text-sm">info</span>
                <p className="text-[#FF4D6D] text-xs">{searchError}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* NOTE SECTION */}
        <div className="mx-5 mt-7">
          <p className="text-ink-soft text-[12px] font-bold mb-3">
            Add a note <span className="text-ink-faint normal-case tracking-normal font-normal">(optional)</span>
          </p>

          {/* Quick note chips */}
          <div className="flex gap-2 flex-wrap mb-4">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                onClick={() => setNote(n)}
                className={`text-xs px-4 py-2 rounded-full border transition-none active:scale-95 ${
                  note === n
                    ? 'bg-[#6157FF] border-[#6157FF] text-ink font-bold'
                    : 'border-line text-ink-soft bg-surface-2'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Free text */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write your own note..."
            rows={3}
            maxLength={120}
            className="w-full bg-surface-2 border border-line rounded-2xl px-4 py-3.5 text-ink text-sm placeholder-white/20 outline-none resize-none"
          />
          <p className="text-right text-ink-faint text-[12px] mt-1">{note.length}/120</p>
        </div>

        {/* SEND CTA */}
        <div className="mx-5 mt-6">
          <button
            onClick={handleSend}
            disabled={!foundUser || sending}
            className={`w-full py-5 rounded-2xl font-bold text-sm active:scale-95 transition-none flex items-center justify-center gap-3 ${
              foundUser
                ? 'bg-[#6157FF] text-ink shadow-lg shadow-[#6157FF]/25'
                : 'bg-surface-2 text-ink-faint'
            }`}
          >
            {sending ? (
              <>
                <div className="h-5 w-5 rounded-full border-2 border-line border-t-white animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
                Send Gift
              </>
            )}
          </button>

          {/* ZipCoins hint */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="material-symbols-outlined text-[#6157FF] text-sm"
              style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
            <p className="text-[#6157FF]/70 text-xs font-bold">
              You'll earn +15 ZipCoins for this gift
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GiftLook;
