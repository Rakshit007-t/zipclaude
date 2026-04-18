import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fallbackProducts, Product } from './Marketplace';

const pickSuggestedProducts = (query: string): Product[] => {
  const normalizedQuery = query.toLowerCase();
  const matchedProducts = fallbackProducts.filter((product) => {
    const productText = `${product.title} ${product.brand} ${product.category} ${product.type}`.toLowerCase();
    return normalizedQuery.split(/\s+/).some((term) => term.length > 2 && productText.includes(term));
  });

  if (matchedProducts.length >= 2) {
    return matchedProducts.slice(0, 2);
  }

  return fallbackProducts.slice(0, 2);
};

const buildFallbackReply = (query: string): string => {
  const [firstPick, secondPick] = pickSuggestedProducts(query);

  return `I am in demo mode right now, but I would style this with [PRODUCT:${firstPick.id}] and [PRODUCT:${secondPick.id}]. They keep the look polished, wearable, and easy to shop right away.`;
};

interface Message {
  role: 'user' | 'model';
  text: string;
}

const StylistChat: React.FC = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      text: 'Hi! I am your AI Stylist. Ask me anything about trends, fits, or outfits and I will suggest looks from the marketplace.'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const userMessage = textToSend || input.trim();
    if (!userMessage || isLoading) return;

    if (!textToSend) setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      // Simulate a brief thinking delay
      await new Promise(resolve => setTimeout(resolve, 800));
      setMessages(prev => [...prev, { role: 'model', text: buildFallbackReply(userMessage) }]);
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const allSuggestions = [
    "What are the latest streetwear trends?",
    "How to style a denim jacket?",
    "Suggest an outfit for a summer wedding",
    "What shoes go well with cargo pants?",
    "How to dress for a smart casual event?",
    "Best colors for a winter wardrobe?",
    "How to accessorize a plain black dress?",
    "What to wear on a first date?",
    "Are skinny jeans still in style?",
    "How to build a capsule wardrobe?"
  ];

  const [currentSuggestions, setCurrentSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoading) {
      const shuffled = [...allSuggestions].sort(() => 0.5 - Math.random());
      setCurrentSuggestions(shuffled.slice(0, 3));
    }
  }, [isLoading]);

  const renderMessageText = (text: string) => {
    const parts = text.split(/(\[PRODUCT:[^\]]+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[PRODUCT:([^\]]+)\]/);
      if (match) {
        const productId = match[1];
        const product = fallbackProducts.find(p => p.id === productId);
        if (product) {
          return (
            <div 
              key={i} 
              onClick={() => navigate('/marketplace')}
              className="my-3 p-3 bg-black/20 rounded-xl border border-white/10 flex gap-3 items-center cursor-pointer active:scale-95 transition-transform"
            >
              <img src={product.image} alt={product.title} className="w-12 h-12 rounded-lg object-cover" />
              <div>
                <p className="text-xs font-bold text-white">{product.title}</p>
                <p className="text-[10px] text-white/50">{product.brand} • {product.price}</p>
              </div>
            </div>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#111111] text-white font-display">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5 shrink-0">
        <button onClick={() => navigate(-1)} className="h-12 w-12 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C]">AI Stylist</h1>
        <div className="w-12"></div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-[2rem] p-5 ${msg.role === 'user' ? 'bg-[#C9A06C] text-black rounded-tr-sm' : 'bg-white/5 border border-white/10 text-white/90 rounded-tl-sm'}`}>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{renderMessageText(msg.text)}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-[2rem] p-5 bg-white/5 border border-white/10 text-white/90 rounded-tl-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#C9A06C] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 pb-24 bg-[#111111] shrink-0 border-t border-white/5">
        {!isLoading && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 -mx-6 px-6">
            {currentSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(suggestion)}
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about trends, fits..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-6 pr-14 text-sm focus:outline-none focus:border-[#C9A06C]/50 transition-colors"
          />
          <button 
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
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
