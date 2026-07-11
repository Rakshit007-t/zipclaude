import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { getStylistResponse } from '../services/stylistService';
import { springs, AppBar } from '../components/ui';
import { recordJourneyEvent } from '../services/styleJourney';

interface Message {
  role: 'user' | 'ai';
  content: string;
}

const ALL_SUGGESTIONS = [
  'What should I wear for a summer wedding?',
  'How do I style a denim jacket?',
  'What shoes go with cargo pants?',
  'Tomorrow is my presentation, outfit idea?',
  'Give me a classy interview look for hot weather.',
  'Best outfit for college fest evening?',
];

function pickRandomSuggestions(source: string[], count = 2) {
  return [...source].sort(() => 0.5 - Math.random()).slice(0, count);
}

/** Copper spark in a hairline ring — the stylist's mark. */
const StylistAvatar: React.FC = () => (
  <div className="h-8 w-8 rounded-full border border-brand/40 flex items-center justify-center shrink-0 mt-1" aria-hidden="true">
    <span className="material-symbols-outlined text-brand text-[15px]">auto_awesome</span>
  </div>
);

const StylistChat: React.FC = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'ai',
      content: "Tell me your occasion, vibe, and one piece you want to wear - I'll style it.",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentSuggestions, setCurrentSuggestions] = useState<string[]>(() => pickRandomSuggestions(ALL_SUGGESTIONS, 2));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshSuggestions = () => {
    setCurrentSuggestions(pickRandomSuggestions(ALL_SUGGESTIONS, 2));
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (userInput: string) => {
    if (!userInput.trim() || loading) return;

    const userMsg = { role: 'user' as const, content: userInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // Backend caps message at 1000 chars (StylistRequest.max_length)
      const { reply } = await getStylistResponse(userInput.slice(0, 1000));

      if (!reply.trim()) {
        throw new Error('Empty response');
      }

      setMessages(prev => [...prev, { role: 'ai', content: reply.trim() }]);
      recordJourneyEvent('stylist_chat');
    } catch (error) {
      console.error('Stylist error:', error);
      setMessages(prev => [...prev, {
        role: 'ai',
        content: 'I had a styling emergency! Please try again in a moment.',
      }]);
    } finally {
      setLoading(false);
      refreshSuggestions();
    }
  };

  return (
    <div className="flex flex-col h-screen h-dvh bg-surface-0 text-ink">
      <AppBar
        title={
          <div>
            <h1 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink">The Stylist</h1>
            <span className="flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              <span className="text-[11px] text-ink-faint normal-case tracking-normal">Personal · Private</span>
            </span>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5 no-scrollbar" role="log" aria-label="Conversation with your AI stylist" aria-live="polite">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
            className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'ai' && <StylistAvatar />}
            <div
              className={`max-w-[80%] overflow-visible rounded-3xl px-5 py-3.5 ${
                msg.role === 'user'
                  ? 'bg-ink text-ink-invert rounded-br-lg'
                  : 'bg-surface-1 border border-line text-ink-soft rounded-tl-lg'
              }`}
            >
              <div className="overflow-visible whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{msg.content}</div>
            </div>
          </motion.div>
        ))}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex gap-2.5 justify-start"
              aria-label="Stylist is thinking"
            >
              <StylistAvatar />
              <div className="rounded-3xl rounded-tl-lg border border-line bg-surface-1 px-5 py-3.5 flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-faint mr-1">Styling</span>
                <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      <div className="p-6 pb-28 bg-surface-0 shrink-0 border-t border-line">
        {!loading && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 -mx-6 px-6" role="group" aria-label="Suggested questions">
            {currentSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(suggestion)}
                className="flex-shrink-0 border border-line rounded-full px-4 py-2.5 text-[12px] text-ink-soft press transition-[transform,border-color,color] hover:border-line-strong hover:text-ink"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className="relative flex items-center max-w-md mx-auto">
          <input
            type="text"
            value={input}
            aria-label="Message your stylist"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask for outfit, fit, color, and styling advice"
            className="w-full bg-surface-1 border border-line rounded-full py-4 pl-5 pr-14 text-[13.5px] focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow] placeholder:text-ink-faint"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className="absolute right-2 h-10 w-10 rounded-full bg-ink text-ink-invert flex items-center justify-center press-icon disabled:opacity-40 disabled:active:scale-100"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">send</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StylistChat;
