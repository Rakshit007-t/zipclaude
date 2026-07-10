import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { listCloset, onClosetChange, removeFromCloset } from '../services/closet';
import { AppBar, EmptyState, Button, Spinner } from '../components/ui';

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
    const sync = () => setItems(listCloset('wardrobe'));
    sync();
    setLoading(false);
    return onClosetChange(sync);
  }, [navigate]);

  const removeItem = async (id: string) => {
    removeFromCloset('wardrobe', id);
  };

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="My Wardrobe" onBack={() => navigate('/home')} />

      <div className="flex-1 p-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-faint">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="checkroom"
            title="An empty rail"
            description="Keep gifted pieces or saved looks and they'll hang here."
            action={
              <Button onClick={() => navigate('/reel')} icon="swipe">
                Open the reel
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
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-surface-1 rounded-card overflow-hidden border border-line flex flex-col relative group"
                >
                  <div className="aspect-[3/4] w-full bg-surface-2 relative">
                    <img
                      src={item.image || ''}
                      alt={item.title || item.productRefId || ''}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove from wardrobe"
                      className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[15px] text-white" aria-hidden="true">close</span>
                    </button>
                  </div>
                  <div className="p-3.5">
                    <p className="font-display text-[14px] font-medium text-ink truncate">{item.brand || ''}</p>
                    <h3 className="text-[11.5px] text-ink-faint leading-tight line-clamp-1 mt-0.5">{item.title || item.productRefId || ''}</h3>
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
