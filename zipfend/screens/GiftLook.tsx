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
      <div className="min-h-screen bg-[#111111] flex flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12 }}
          className="mb-8"
        >
          <div className="h-28 w-28 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-[#8B5CF6] text-6xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              card_giftcard
            </span>
          </div>
          <h2 className="text-white font-display text-3xl font-bold mb-2">Gift Sent! 🎁</h2>
          <p className="text-white/50 text-sm mb-1">
            @{foundUser?.username} will love it.
          </p>
          <p className="text-white/30 text-xs">
            {note ? `"${note}"` : ''}
          </p>
        </motion.div>

        {/* ZipCoins earned */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-[#B5853F]/10 border border-[#B5853F]/20 rounded-2xl px-8 py-5 mb-10 flex items-center gap-4"
        >
          <span className="material-symbols-outlined text-[#C9A06C] text-3xl"
            style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
          <div className="text-left">
            <p className="text-[#C9A06C] font-black text-xl">+15 ZipCoins</p>
            <p className="text-white/40 text-xs">earned for gifting</p>
          </div>
        </motion.div>

        <button
          onClick={() => navigate('/home')}
          className="w-full max-w-xs bg-white text-[#111111] py-4 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95"
        >
          Back to Feed
        </button>
        <button
          onClick={() => navigate('/gift-inbox')}
          className="mt-3 text-[#8B5CF6] text-sm font-bold active:opacity-70"
        >
          See your Gift Inbox →
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-white font-body flex flex-col">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5
        bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 active:scale-90">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.35em] uppercase text-[#C9A06C]">Gift a Look</h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">

        {/* PRODUCT PREVIEW */}
        <div className="mx-5 mt-5 bg-white/5 rounded-2xl p-4 border border-white/5 flex gap-4">
          <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-black/30">
            <img src={product.image} alt={product.title}
              className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[#C9A06C] text-[9px] font-bold uppercase tracking-widest mb-1">
              {product.brand}
            </span>
            <p className="text-white font-bold text-sm leading-tight line-clamp-2">{product.title}</p>
            <p className="text-white/60 text-sm font-black mt-1">{product.price}</p>
          </div>
          <div className="ml-auto self-start">
            <span className="material-symbols-outlined text-[#8B5CF6] text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
          </div>
        </div>

        {/* FIND FRIEND */}
        <div className="mx-5 mt-7">
          <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-3">
            Find your friend
          </p>

          {/* Search input */}
          <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5">
            <span className="material-symbols-outlined text-white/30 text-xl">alternate_email</span>
            <input
              type="text"
              placeholder="username"
              value={usernameQuery}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className="flex-1 bg-transparent text-white text-sm placeholder-white/20 outline-none"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {searching && (
              <div className="h-4 w-4 rounded-full border-2 border-[#8B5CF6] border-t-transparent animate-spin" />
            )}
          </div>

          {/* Found user card */}
          <AnimatePresence>
            {foundUser && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mt-3 bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 rounded-2xl px-4 py-3.5 flex items-center gap-3"
              >
                <div className="h-10 w-10 rounded-full bg-[#8B5CF6]/30 flex items-center justify-center flex-shrink-0">
                  {foundUser.photoURL ? (
                    <img src={foundUser.photoURL} className="h-full w-full rounded-full object-cover" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="material-symbols-outlined text-[#8B5CF6] text-xl">person</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold text-sm">{foundUser.displayName}</p>
                  <p className="text-[#8B5CF6] text-xs">@{foundUser.username}</p>
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
          <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-3">
            Add a note <span className="text-white/20 normal-case tracking-normal font-normal">(optional)</span>
          </p>

          {/* Quick note chips */}
          <div className="flex gap-2 flex-wrap mb-4">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                onClick={() => setNote(n)}
                className={`text-xs px-4 py-2 rounded-full border transition-none active:scale-95 ${
                  note === n
                    ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white font-bold'
                    : 'border-white/10 text-white/50 bg-white/5'
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
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm placeholder-white/20 outline-none resize-none"
          />
          <p className="text-right text-white/20 text-[10px] mt-1">{note.length}/120</p>
        </div>

        {/* SEND CTA */}
        <div className="mx-5 mt-6">
          <button
            onClick={handleSend}
            disabled={!foundUser || sending}
            className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] active:scale-95 transition-none flex items-center justify-center gap-3 ${
              foundUser
                ? 'bg-[#8B5CF6] text-white shadow-lg shadow-[#8B5CF6]/25'
                : 'bg-white/5 text-white/20'
            }`}
          >
            {sending ? (
              <>
                <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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
            <span className="material-symbols-outlined text-[#C9A06C] text-sm"
              style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
            <p className="text-[#C9A06C]/70 text-xs font-bold">
              You'll earn +15 ZipCoins for this gift
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GiftLook;
