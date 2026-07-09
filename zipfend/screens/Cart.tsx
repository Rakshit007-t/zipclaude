import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState, Button } from '../components/ui';

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
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button onClick={() => navigate('/home')} aria-label="Back to home" className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#22c55e]" aria-hidden="true">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#22c55e]">My Cart</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6 pb-32">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#22c55e]"></div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="shopping_cart"
            title="Your cart is empty"
            description="Swipe right on items in the feed to add them here."
            action={
              <Button onClick={() => navigate('/home')} icon="explore">
                Explore Feed
              </Button>
            }
          />
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
                  className="bg-surface-2 rounded-2xl p-4 border border-line flex gap-4 relative group"
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
                      <p className="text-[12px] font-bold text-[#22c55e] mb-0.5">{item.brand || ''}</p>
                      <h3 className="text-sm font-bold leading-tight line-clamp-2">{item.title || item.productRefId || ''}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-ink">{item.price || ''}</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => window.open(item.affiliateLink || item.productUrl || item.url || '#', '_blank')}
                          className="h-8 w-8 rounded-full bg-surface-2 flex items-center justify-center active:scale-90 transition-transform"
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
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-surface-0/90 backdrop-blur-xl border-t border-line">
          <button 
            disabled
            className="w-full py-4 bg-surface-2 text-ink-soft rounded-xl font-bold text-sm cursor-not-allowed flex items-center justify-center gap-2"
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
