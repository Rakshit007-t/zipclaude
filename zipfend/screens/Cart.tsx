import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { listCloset, onClosetChange, removeFromCloset, updateQuantity, type ClosetItem } from '../services/closet';
import { useAppNavigation } from '../utils/useAppNavigation';
import { AppBar, Button, EmptyState, Spinner } from '../components/ui';
import { safeOpenUrl } from '../utils/sanitize';


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
  quantity?: number;
}

const Cart: React.FC = () => {
  const { navigate, goBack } = useAppNavigation();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }
    const sync = () => setItems(listCloset('cart'));
    sync();
    setLoading(false);
    return onClosetChange(sync);
  }, [navigate]);

  const removeItem = async (id: string) => {
    removeFromCloset('cart', id);
  };

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Cart" onBack={() => goBack('/marketplace')} />

      <div className="flex-1 p-6 pb-32">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-faint">
            <Spinner size={26} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="shopping_bag"
            title="Your bag is empty"
            description="Swipe right on pieces in The Reel to drop them in here."
            action={
              <Button onClick={() => navigate('/reel')} icon="swipe">
                Open the reel
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
                    onClick={() => safeOpenUrl(item.affiliateLink || item.productUrl || item.url)}
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
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[14px] font-semibold text-ink">{item.price || ''}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-surface-2 border border-line rounded-full px-2 py-0.5">
                          <button
                            onClick={() => updateQuantity('cart', item.id, -1)}
                            aria-label="Decrease quantity"
                            className="h-6 w-6 flex items-center justify-center text-ink-soft hover:text-ink"
                          >
                            <span className="material-symbols-outlined text-[15px]">remove</span>
                          </button>
                          <span className="text-[12px] font-semibold text-ink px-1 min-w-[16px] text-center">{item.quantity || 1}</span>
                          <button
                            onClick={() => updateQuantity('cart', item.id, 1)}
                            aria-label="Increase quantity"
                            className="h-6 w-6 flex items-center justify-center text-ink-soft hover:text-ink"
                          >
                            <span className="material-symbols-outlined text-[15px]">add</span>
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.title || 'item'} from cart`}
                          className="h-8 w-8 rounded-full border border-danger/25 bg-danger-soft flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[15px] text-danger" aria-hidden="true">delete</span>
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
        <div className="fixed bottom-0 inset-x-0 w-full p-6 bg-surface-0/92 backdrop-blur-xl border-t border-line phone-fixed-bottom">
          <div className="flex items-center justify-between text-[11px] text-ink-soft mb-3">
            <span>Platform service fee:</span>
            <span className="font-semibold text-brand">₹0.00 (Free)</span>
          </div>
          <p className="text-[10.5px] text-ink-faint text-center mb-3">
            ZipRIGHT is an advisory sizing atelier and charges no hidden markup. Orders, shipping, and taxes are settled directly on the partner merchant website.
          </p>
          <Button
            fullWidth
            size="lg"
            variant="primary"
            onClick={() => {
              const first = items[0];
              const target = first?.affiliateLink || first?.productUrl || first?.url;
              if (target) safeOpenUrl(target);
            }}
            icon="open_in_new"
          >
            Visit Merchant Store ({items.length} {items.length === 1 ? 'item' : 'items'})
          </Button>
        </div>
      )}
    </div>
  );
};

export default Cart;
