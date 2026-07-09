import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState, Button } from '../components/ui';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

interface WishlistItem {
  id: string;
  productRefId?: string;
  brand?: string;
  title?: string;
  price?: string;
  image?: string;
  url?: string;
  productUrl?: string;
}

const Wishlist: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user && !hasDemoSession()) {
      navigate('/login');
      return;
    }
    setItems([]);
    setLoading(false);
  }, [navigate]);

  const removeItem = async (id: string) => {
    void id;
  };

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button onClick={() => navigate('/home')} aria-label="Back to home" className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]" aria-hidden="true">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">My Wishlist</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#6157FF]"></div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="favorite"
            title="Your wishlist is empty"
            description="Double-tap looks you love in the feed to keep them here."
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
                    onClick={() => window.open(item.productUrl || item.url || '#', '_blank')}
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
                      <p className="text-[12px] font-bold text-[#6157FF] mb-0.5">{item.brand || ''}</p>
                      <h3 className="text-sm font-bold leading-tight line-clamp-2">{item.title || item.productRefId || ''}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-ink">{item.price || ''}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => window.open(item.productUrl || item.url || '#', '_blank')}
                          aria-label={`Shop ${item.title || 'item'}`}
                          className="h-9 w-9 rounded-full bg-surface-2 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">shopping_bag</span>
                        </button>
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.title || 'item'} from wishlist`}
                          className="h-9 w-9 rounded-full bg-[#FF4D6D]/10 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[#FF4D6D]" aria-hidden="true">delete</span>
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
    </div>
  );
};

export default Wishlist;
