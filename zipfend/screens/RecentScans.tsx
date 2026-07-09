import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState, Button } from '../components/ui';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

interface WardrobeItem {
  id: string;
  productRefId?: string;
  brand?: string;
  title?: string;
  price?: string;
  image?: string;
  productUrl?: string;
  category?: string;
  type?: string;
}

const RecentScans: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WardrobeItem[]>([]);
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
        <h1 className="text-xs font-bold text-[#6157FF]">My Wardrobe</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#6157FF]"></div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="checkroom"
            title="Your wardrobe is empty"
            description="Swipe left on items in the feed to save them to your style profile."
            action={
              <Button onClick={() => navigate('/home')} icon="explore">
                Explore Feed
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-surface-2 rounded-2xl overflow-hidden border border-line flex flex-col relative group"
                >
                  <div className="aspect-[3/4] w-full bg-black/20 relative">
                    <img 
                      src={item.image || ''} 
                      alt={item.title || item.productRefId || ''} 
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform border border-line"
                    >
                      <span className="material-symbols-outlined text-[16px] text-ink">close</span>
                    </button>
                  </div>
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-[11px] font-bold text-[#6157FF] mb-0.5">{item.brand || ''}</p>
                      <h3 className="text-xs font-bold leading-tight line-clamp-1">{item.title || item.productRefId || ''}</h3>
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

export default RecentScans;
