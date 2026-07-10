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
    const sync = () => setItems(listCloset('likes'));
    sync();
    setLoading(false);
    return onClosetChange(sync);
  }, [navigate]);

  const removeItem = async (id: string) => {
    removeFromCloset('likes', id);
  };

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Wishlist" onBack={() => navigate('/home')} />

      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-faint">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="favorite"
            title="Nothing saved yet"
            description="Tap the heart on pieces in the Marketplace to keep them here."
            action={
              <Button onClick={() => navigate('/marketplace')} icon="storefront">
                Browse the marketplace
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-surface-1 rounded-card p-4 border border-line flex gap-4 relative"
                >
                  <div
                    className="h-28 w-24 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2 cursor-pointer"
                    onClick={() => window.open(item.productUrl || item.url || '#', '_blank')}
                  >
                    <img
                      src={item.image || ''}
                      alt={item.title || item.productRefId || ''}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1 min-w-0">
                    <div>
                      <p className="font-display text-[16px] font-medium text-ink leading-tight">{item.brand || ''}</p>
                      <h3 className="text-[12.5px] text-ink-soft leading-snug line-clamp-2 mt-1">{item.title || item.productRefId || ''}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] font-semibold text-ink">{item.price || ''}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => window.open(item.productUrl || item.url || '#', '_blank')}
                          aria-label={`Shop ${item.title || 'item'}`}
                          className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">shopping_bag</span>
                        </button>
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.title || 'item'} from wishlist`}
                          className="h-9 w-9 rounded-full border border-danger/25 bg-danger-soft flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[17px] text-danger" aria-hidden="true">delete</span>
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
