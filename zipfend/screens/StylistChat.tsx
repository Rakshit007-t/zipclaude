import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { getStylistResponse } from '../services/stylistService';
import { springs } from '../components/ui';
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

/** Small gold spark avatar that identifies the stylist's messages. */
const StylistAvatar: React.FC = () => (
  <div className="h-8 w-8 rounded-full bg-[#6157FF]/15 border border-[#6157FF]/30 flex items-center justify-center shrink-0 mt-1" aria-hidden="true">
    <span className="material-symbols-outlined text-[#6157FF] text-[16px]">auto_awesome</span>
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
    <div className="flex flex-col h-screen h-dvh bg-surface-0 text-ink font-sans">
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 bg-surface-0/80 backdrop-blur-xl border-b border-line shrink-0">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="h-11 w-11 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-[22px] text-[#6157FF]" aria-hidden="true">arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-xs font-bold text-[#6157FF]">AI Stylist</h1>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="text-[11px] text-ink-soft">Personal · Private</span>
          </span>
        </div>
        <div className="w-11"></div>
      </div>

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
              className={`max-w-[80%] overflow-visible rounded-[1.5rem] px-5 py-4 ${
                msg.role === 'user'
                  ? 'bg-[#6157FF] text-ink rounded-br-md'
                  : 'bg-surface-2 border border-line text-ink-soft rounded-tl-md'
              }`}
            >
              <div className="overflow-visible whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</div>
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
              <div className="rounded-[1.5rem] rounded-tl-md border border-line bg-surface-2 px-5 py-4 flex items-center gap-1.5">
                <span className="text-[11px] text-ink-soft mr-1">Styling</span>
                <div className="w-1.5 h-1.5 rounded-full bg-[#6157FF] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#6157FF] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#6157FF] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      <div className="p-6 pb-24 bg-surface-0 shrink-0 border-t border-line">
        {!loading && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 -mx-6 px-6" role="group" aria-label="Suggested questions">
            {currentSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(suggestion)}
                className="flex-shrink-0 bg-surface-2 border border-line rounded-full px-4 py-2.5 text-xs text-ink-soft active:scale-95 transition-transform hover:border-[#6157FF]/40 hover:text-ink"
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
            className="w-full bg-surface-2 border border-line rounded-full py-4 pl-6 pr-14 text-sm focus:outline-none focus:border-[#6157FF]/50 focus:ring-2 focus:ring-[#6157FF]/20 transition-[border-color,box-shadow]"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className="absolute right-2 h-10 w-10 rounded-full bg-[#6157FF] text-ink flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50 disabled:active:scale-100"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">send</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StylistChat;
