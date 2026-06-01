import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

interface CartItem {
  id: string;
  productRefId?: string;
  brand?: string;
  title?: string;
  price?: string;
  image?: string;
  url?: string;
  productUrl?: string;
  affiliateLink?: string;
}

const Cart: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    const user = auth.currentUser;
    if (!user && !hasDemoSession()) {
      navigate('/login');
      return;
    }
    setItems([]);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, [navigate]);

  const removeItem = async (id: string) => {
    void id;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate('/home')} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#22c55e]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#22c55e]">My Cart</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6 pb-32">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#22c55e]"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center opacity-60">
            <span className="material-symbols-outlined text-6xl mb-4 text-[#22c55e]">shopping_cart</span>
            <p className="text-lg font-medium">Your cart is empty</p>
            <p className="text-sm mt-2">Swipe right on items in the feed to add them here.</p>
            <button 
              onClick={() => navigate('/home')}
              className="mt-8 px-8 py-3 bg-[#22c55e] text-black rounded-full font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
            >
              Explore Feed
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white/5 rounded-2xl p-4 border border-white/5 flex gap-4 relative group"
                >
                  <div 
                    className="h-24 w-24 rounded-xl overflow-hidden flex-shrink-0 bg-black/20 cursor-pointer"
                    onClick={() => window.open(item.affiliateLink || item.productUrl || item.url || '#', '_blank')}
                  >
                    <img 
                      src={item.image || ''} 
                      alt={item.title || item.productRefId || ''} 
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <p className="text-[10px] font-bold text-[#22c55e] uppercase tracking-wider mb-0.5">{item.brand || ''}</p>
                      <h3 className="text-sm font-bold leading-tight line-clamp-2">{item.title || item.productRefId || ''}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black text-white">{item.price || ''}</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => window.open(item.affiliateLink || item.productUrl || item.url || '#', '_blank')}
                          className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                        </button>
                        <button 
                          onClick={() => removeItem(item.id)}
                          className="h-8 w-8 rounded-full bg-[#FF4D6D]/10 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[#FF4D6D]">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Checkout Bar */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#111111]/90 backdrop-blur-xl border-t border-white/5">
          <button 
            disabled
            className="w-full py-4 bg-white/10 text-white/40 rounded-xl font-black text-sm uppercase tracking-widest cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">lock</span>
            Checkout Unavailable ({items.length} items)
          </button>
        </div>
      )}
    </div>
  );
};

export default Cart;
