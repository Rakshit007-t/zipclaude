import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleGenAI } from '@google/genai';

// Lazy-initialize to prevent crashing the entire app if the API key is missing
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('VITE_GEMINI_API_KEY is not configured. Please add it to your .env file.');
    }
    _ai = new GoogleGenAI({ apiKey });
  }
  return _ai;
}

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
      const conversationHistory = newMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      const chat = getAI().chats.create({
        model: 'gemini-2.0-flash-exp',
        config: {
          maxOutputTokens: 1024,
          temperature: 0.9,
          systemInstruction: `You are ZipStyle, ZipRIGHT's elite AI fashion stylist for the Indian market. 
You give COMPLETE, detailed outfit recommendations - never cut off mid-sentence.

Rules:
- Always give a FULL outfit: top + bottom + footwear + 1 accessory
- Mention Indian brands where relevant (Manyavar, FabIndia, W, Allen Solly, Van Heusen, H&M India, Zara India)
- Tailor advice to Indian weather, occasions, and culture (weddings, festivals, office, college)
- For fancy dress or costume requests, go creative and specific with a WINNING look
- Format responses clearly:
  ✦ TOP: [specific item + color]
  ✦ BOTTOM: [specific item + color]  
  ✦ FOOTWEAR: [specific item]
  ✦ ACCESSORY: [1 item]
  ✦ PRO TIP: [1 styling tip]
- NEVER end a sentence without completing it
- NEVER repeat the same answer for different questions
- Keep responses under 120 words but always COMPLETE`,
        },
        history: conversationHistory.slice(0, -1),
      });

      const response = await chat.sendMessage({
        message: userInput,
      });

      const aiText = response.text;

      if (!aiText || aiText.trim() === '') {
        throw new Error('Empty response');
      }

      setMessages(prev => [...prev, { role: 'ai', content: aiText.trim() }]);
    } catch (error) {
      console.error('Gemini error:', error);
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
    <div className="flex flex-col h-screen bg-[#111111] text-white font-display">
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5 shrink-0">
        <button onClick={() => navigate(-1)} className="h-12 w-12 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C]">AI Stylist</h1>
        <div className="w-12"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] overflow-visible rounded-[2rem] p-5 ${msg.role === 'user' ? 'bg-[#C9A06C] text-black rounded-tr-sm' : 'bg-white/5 border border-white/10 text-white/90 rounded-tl-sm'}`}>
              <div className="overflow-visible whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] overflow-visible rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white/90 rounded-tl-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-6 pb-24 bg-[#111111] shrink-0 border-t border-white/5">
        {!loading && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 -mx-6 px-6">
            {currentSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(suggestion)}
                className="flex-shrink-0 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-xs text-white/70 active:scale-95 transition-transform"
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask for outfit, fit, color, and styling advice"
            className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-6 pr-14 text-sm focus:outline-none focus:border-[#C9A06C]/50 transition-colors"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="absolute right-2 h-10 w-10 rounded-full bg-[#C9A06C] text-black flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50 disabled:active:scale-100"
          >
            <span className="material-symbols-outlined text-[20px]">send</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StylistChat;
