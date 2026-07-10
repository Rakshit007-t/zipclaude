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
import { AppBar, Button, Eyebrow, Badge } from '../components/ui';

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
      <div className="min-h-screen min-h-dvh bg-surface-0 flex flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14 }}
          className="mb-8"
        >
          <div className="h-24 w-24 rounded-full border border-brand/30 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-brand text-[46px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
              featured_seasonal_and_gifts
            </span>
          </div>
          <Eyebrow className="mb-3">Delivered</Eyebrow>
          <h2 className="text-ink font-display text-[32px] font-light mb-2">Gift <em className="font-medium">sent.</em></h2>
          <p className="text-ink-soft text-[14px] mb-1">
            @{foundUser?.username} will love it.
          </p>
          <p className="text-ink-faint text-[12px]">
            {note ? `"${note}"` : ''}
          </p>
        </motion.div>

        {/* ZipCoins earned */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-brass-soft rounded-2xl px-8 py-4 mb-10 flex items-center gap-4"
        >
          <span className="material-symbols-outlined text-brass text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
          <div className="text-left">
            <p className="text-brass font-display font-medium text-[20px]">+15 ZipCoins</p>
            <p className="text-ink-faint text-[11px] uppercase tracking-[0.1em]">earned for gifting</p>
          </div>
        </motion.div>

        <div className="w-full max-w-xs flex flex-col gap-3">
          <Button size="lg" fullWidth onClick={() => navigate('/home')}>Back to home</Button>
          <Button variant="ghost" fullWidth trailingIcon="arrow_forward" onClick={() => navigate('/gift-inbox')}>
            See your gift inbox
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
      <AppBar title="Gift a look" onBack={() => navigate(-1)} />

      <div className="flex-1 overflow-y-auto pb-8 px-6">

        {/* PRODUCT PREVIEW */}
        <div className="mt-5 bg-surface-1 rounded-card p-4 border border-line flex gap-4">
          <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2">
            <img src={product.image} alt={product.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <span className="font-display text-[16px] font-medium text-ink leading-tight">{product.brand}</span>
            <p className="text-ink-soft text-[12px] leading-tight line-clamp-2 mt-0.5">{product.title}</p>
            <p className="text-ink font-semibold text-[13px] mt-1">{product.price}</p>
          </div>
          <span className="material-symbols-outlined text-brand text-[20px] ml-auto self-start" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">featured_seasonal_and_gifts</span>
        </div>

        {/* FIND FRIEND */}
        <div className="mt-8">
          <Eyebrow className="mb-3">Find your friend</Eyebrow>

          {/* Search input */}
          <div className="flex items-center gap-3 bg-surface-1 border border-line rounded-full px-4 h-12 focus-within:border-ink transition-colors">
            <span className="material-symbols-outlined text-ink-faint text-[19px]" aria-hidden="true">alternate_email</span>
            <input
              type="text"
              placeholder="username"
              value={usernameQuery}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className="flex-1 bg-transparent text-ink text-[15px] placeholder:text-ink-faint outline-none"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {searching && (
              <div className="h-4 w-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            )}
          </div>

          {/* Found user card */}
          <AnimatePresence>
            {foundUser && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mt-3 bg-surface-1 border border-line rounded-card px-4 py-3.5 flex items-center gap-3"
              >
                <div className="h-10 w-10 rounded-full border border-line flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {foundUser.photoURL ? (
                    <img src={foundUser.photoURL} className="h-full w-full rounded-full object-cover" alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-ink font-display font-medium text-[16px]">{foundUser.displayName.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-[14px] truncate">{foundUser.displayName}</p>
                  <p className="text-ink-faint text-[12px]">@{foundUser.username}</p>
                </div>
                <span className="material-symbols-outlined text-success text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span>
              </motion.div>
            )}
            {searchError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 flex items-center gap-2 px-1"
              >
                <span className="material-symbols-outlined text-danger text-[15px]" aria-hidden="true">info</span>
                <p className="text-danger text-[12px]">{searchError}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* NOTE SECTION */}
        <div className="mt-8">
          <Eyebrow className="mb-3">Add a note <span className="text-ink-faint normal-case tracking-normal font-normal lowercase">(optional)</span></Eyebrow>

          {/* Quick note chips */}
          <div className="flex gap-2 flex-wrap mb-4">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                onClick={() => setNote(n)}
                className={`text-[12px] px-4 py-2 rounded-full border active:scale-95 transition-[transform,border-color,background-color,color] ${
                  note === n
                    ? 'bg-ink border-ink text-ink-invert'
                    : 'border-line text-ink-soft hover:border-line-strong'
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
            placeholder="Write your own note…"
            rows={3}
            maxLength={120}
            className="w-full bg-surface-1 border border-line rounded-card px-4 py-3.5 text-ink text-[14px] placeholder:text-ink-faint outline-none resize-none focus:border-ink transition-colors"
          />
          <p className="text-right text-ink-faint text-[11px] mt-1">{note.length}/120</p>
        </div>

        {/* SEND CTA */}
        <div className="mt-6">
          <Button
            variant="accent"
            size="lg"
            fullWidth
            icon="featured_seasonal_and_gifts"
            loading={sending}
            disabled={!foundUser || sending}
            onClick={handleSend}
          >
            Send gift
          </Button>

          {/* ZipCoins hint */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="material-symbols-outlined text-brass text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
            <p className="text-ink-faint text-[11px] font-semibold uppercase tracking-[0.1em]">
              You'll earn +15 ZipCoins for this gift
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GiftLook;
