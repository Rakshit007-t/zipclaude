import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { PublicProfile, getProfile, isOnline, onBlocked } from '../services/social';
import {
  Conversation, DirectMessage, openConversation, onMessages, onConversation,
  sendText, sendImage, sendVoice, setTyping, clearTyping, isTypingNow,
  markRead, seenByOther,
} from '../services/messages';
import { Spinner, EmptyState, Button } from '../components/ui';
import { compressImage } from '../utils/media';
import { safeOpenUrl, sanitizeText } from '../utils/sanitize';

function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
}

function timeLabel(ts?: { toMillis?: () => number } | null): string {
  const ms = ts?.toMillis?.();
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Tiny voice-note player: play/pause + duration, one Audio element. */
const VoiceBubble: React.FC<{ url: string; durationSec?: number; mine: boolean }> = ({ url, durationSec, mine }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play();
      setPlaying(true);
    }
  };

  const secs = durationSec || 0;
  return (
    <button
      onClick={toggle}
      aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      className="flex items-center gap-3 min-w-[132px]"
    >
      <span className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${mine ? 'bg-ink-invert/15' : 'bg-surface-2'}`}>
        <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
          {playing ? 'pause' : 'play_arrow'}
        </span>
      </span>
      {/* Static editorial waveform — hairlines, no theatrics */}
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {[9, 14, 7, 16, 11, 6, 13, 9, 15, 8].map((h, i) => (
          <span key={i} className={`w-[2px] rounded-full ${mine ? 'bg-ink-invert/50' : 'bg-ink-faint'}`} style={{ height: h }} />
        ))}
      </span>
      <span className="text-[11px] opacity-70 tabular-nums">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
    </button>
  );
};

const MAX_VOICE_SEC = 60;

const ChatScreen: React.FC = () => {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const me = auth.currentUser?.uid;

  const [other, setOther] = useState<PublicProfile | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [, forceTick] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordSecRef = useRef(0);

  const voiceSupported = !!pickAudioMime() && !!navigator.mediaDevices?.getUserMedia;

  // Load other profile + open conversation
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const p = await getProfile(uid);
      if (cancelled) return;
      setOther(p);
      if (p) {
        const id = await openConversation(p).catch(() => null);
        if (!cancelled) setConvId(id);
      }
      setLoading(false);
    })();
    const unsubBlocked = onBlocked(setBlockedSet);
    return () => { cancelled = true; unsubBlocked(); };
  }, [uid]);

  // Live messages + conversation meta; mark read as messages arrive
  useEffect(() => {
    if (!convId) return;
    const unsubs = [
      onMessages(convId, msgs => { setMessages(msgs); markRead(convId); }),
      onConversation(convId, setConv),
    ];
    return () => { unsubs.forEach(u => u()); clearTyping(convId); };
  }, [convId]);

  // Typing indicator expires by time — tick to re-render while it's live
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 2500);
    return () => clearInterval(id);
  }, []);

  // Keep the newest message in view
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, conv && uid ? isTypingNow(conv, uid) : false]);

  // Never leave the mic running on unmount
  useEffect(() => () => {
    cancelledRef.current = true;
    recorderRef.current?.stop();
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  }, []);

  const handleSendText = async () => {
    const text = sanitizeText(draft, 1000);
    if (!text || !convId || sending) return;
    setDraft('');
    try {
      await sendText(convId, text);
    } catch {
      setDraft(text);
      showToast('Message not sent. Try again.', 'error');
    }
  };

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !convId) return;
    if (!file.type.startsWith('image/')) { showToast('Please pick an image', 'error'); return; }
    setSending(true);
    try {
      const blob = await compressImage(file);
      await sendImage(convId, blob);
    } catch {
      showToast('Photo not sent. Try again.', 'error');
    }
    setSending(false);
  };

  const startRecording = async () => {
    if (!convId || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = ev => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        const secs = recordSecRef.current;
        setRecording(false);
        setRecordSec(0);
        if (cancelledRef.current || secs < 1) return;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setSending(true);
        try {
          await sendVoice(convId, blob, secs);
        } catch {
          showToast('Voice note not sent. Try again.', 'error');
        }
        setSending(false);
      };
      rec.start();
      setRecording(true);
      recordSecRef.current = 0;
      setRecordSec(0);
      recordTimerRef.current = setInterval(() => {
        recordSecRef.current += 1;
        setRecordSec(recordSecRef.current);
        if (recordSecRef.current >= MAX_VOICE_SEC) recorderRef.current?.stop();
      }, 1000);
    } catch {
      showToast('Microphone unavailable', 'error');
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelledRef.current = cancel;
    recorderRef.current?.stop();
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  if (!other || !me) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
        <div className="flex-1 flex items-center justify-center px-8">
          <EmptyState
            icon="chat_error"
            title="Chat unavailable"
            description="This member may have left ZipRIGHT."
            action={<Button onClick={() => navigate(-1)}>Go back</Button>}
          />
        </div>
      </div>
    );
  }

  const iBlockedThem = blockedSet.has(other.uid);
  const online = isOnline(other.lastActiveAt);
  const typing = isTypingNow(conv, other.uid);
  const lastMineIdx = messages.map(m => m.from).lastIndexOf(me);

  return (
    <div className="h-dvh w-full bg-surface-0 text-ink flex flex-col">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-surface-0/90 backdrop-blur-xl border-b border-line px-4 pt-safe">
        <div className="flex items-center gap-3 h-16">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="h-10 w-10 rounded-full flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_back</span>
          </button>
          <button onClick={() => navigate(`/profile/${other.uid}`)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70">
            <div className="relative shrink-0">
              <div className="h-10 w-10 rounded-full border border-line overflow-hidden flex items-center justify-center bg-surface-1">
                {other.photoURL ? (
                  <img src={other.photoURL} alt={`${other.displayName}'s avatar`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="font-display font-medium text-[16px]">{other.displayName.charAt(0).toUpperCase()}</span>
                )}
              </div>
              {online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-surface-0" aria-label="Online" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-[14px] truncate">{other.displayName}</p>
              <p className="text-[11px] text-ink-faint truncate">
                {typing ? <span className="text-brand">typing…</span> : online ? 'Online now' : `@${other.username}`}
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-1.5">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <p className="eyebrow mb-3">New conversation</p>
            <p className="text-ink-soft text-[14px] leading-relaxed max-w-[240px]">
              Say hello to {other.displayName.split(' ')[0]} — share fits, looks, and voice notes.
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const mine = m.from === me;
          const showSeen = mine && i === lastMineIdx && seenByOther(conv, other.uid, m);
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                  mine
                    ? 'bg-ink text-ink-invert rounded-br-md'
                    : 'bg-surface-1 border border-line text-ink rounded-bl-md'
                } ${m.type === 'image' ? '!p-1.5' : ''}`}
              >
                {m.type === 'text' && <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>}
                {m.type === 'image' && m.mediaUrl && (
                  <img src={m.mediaUrl} alt="Shared photo" className="rounded-xl max-h-72 w-auto object-cover" loading="lazy" />
                )}
                {m.type === 'voice' && m.mediaUrl && (
                  <VoiceBubble url={m.mediaUrl} durationSec={m.durationSec} mine={mine} />
                )}
                {m.type === 'product' && m.product && (
                  <button
                    onClick={() => safeOpenUrl(m.product!.url)}
                    className="flex items-center gap-3 text-left"
                    aria-label={`Open ${m.product.title}`}
                  >
                    <img src={m.product.image} alt={m.product.title || 'Shared product preview'} className="h-14 w-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                    <span>
                      <span className={`block font-display text-[14px] font-medium ${mine ? '' : 'text-ink'}`}>{m.product.brand}</span>
                      <span className="block text-[11px] opacity-70 truncate max-w-[140px]">{m.product.title}</span>
                      <span className="block text-[12px] font-semibold mt-0.5">{m.product.price}</span>
                    </span>
                  </button>
                )}
              </motion.div>
              <div className="flex items-center gap-1.5 px-1 mt-0.5">
                <span className="text-[9.5px] text-ink-faint">{timeLabel(m.createdAt)}</span>
                {showSeen && <span className="text-[9.5px] text-brand font-semibold uppercase tracking-[0.08em]">Seen</span>}
              </div>
            </div>
          );
        })}

        {typing && (
          <div className="flex items-start">
            <div className="bg-surface-1 border border-line rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1" aria-label={`${other.displayName} is typing`}>
              {[0, 1, 2].map(i => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-ink-faint"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-surface-0 px-3 py-3 pb-safe">
        {iBlockedThem ? (
          <p className="text-center text-ink-faint text-[13px] py-2">
            You blocked @{other.username}. <button className="text-brand font-semibold" onClick={() => navigate(`/profile/${other.uid}`)}>Manage</button>
          </p>
        ) : recording ? (
          <div className="flex items-center gap-3 h-12">
            <button
              onClick={() => stopRecording(true)}
              aria-label="Cancel recording"
              className="h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink-faint active:scale-90"
            >
              <span className="material-symbols-outlined text-[19px]" aria-hidden="true">delete</span>
            </button>
            <div className="flex-1 flex items-center gap-2.5">
              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="h-2.5 w-2.5 rounded-full bg-danger" />
              <span className="text-[14px] tabular-nums text-ink">0:{String(recordSec).padStart(2, '0')}</span>
              <span className="text-ink-faint text-[11px]">· recording{recordSec >= MAX_VOICE_SEC - 10 ? ` · ${MAX_VOICE_SEC - recordSec}s left` : ''}</span>
            </div>
            <button
              onClick={() => stopRecording(false)}
              aria-label="Send voice message"
              className="h-11 w-11 rounded-full bg-ink text-ink-invert flex items-center justify-center active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_upward</span>
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={sending}
              aria-label="Send a photo"
              className="h-11 w-11 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform shrink-0 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">image</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePickImage} />
            <textarea
              value={draft}
              onChange={e => {
                setDraft(e.target.value);
                if (convId && e.target.value) setTyping(convId);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendText(); }
              }}
              placeholder="Message…"
              aria-label="Message"
              rows={1}
              className="flex-1 bg-surface-1 border border-line rounded-3xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-faint outline-none focus:border-ink transition-colors resize-none max-h-28 min-h-[44px]"
            />
            {draft.trim() ? (
              <button
                onClick={handleSendText}
                aria-label="Send message"
                className="h-11 w-11 rounded-full bg-ink text-ink-invert flex items-center justify-center active:scale-90 transition-transform shrink-0"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_upward</span>
              </button>
            ) : voiceSupported ? (
              <button
                onClick={startRecording}
                disabled={sending}
                aria-label="Record a voice message"
                className="h-11 w-11 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform shrink-0 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">mic</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatScreen;
