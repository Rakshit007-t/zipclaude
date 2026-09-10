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
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

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

  const handleCheckout = async () => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }
    if (items.length === 0) return;

    setCheckingOut(true);
    setCheckoutMessage(null);
    try {
      const token = await user.getIdToken();
      const payload = {
        items: items.map((i) => ({
          product_id: i.productRefId || i.id,
          quantity: i.quantity || 1,
        })),
      };

      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${backendUrl}/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': `cart_${user.uid}_${Date.now()}`,
        },
        body: JSON.stringify(payload),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData?.message || resData?.detail?.message || 'Checkout failed.');
      }

      const orderData = resData.data;
      setCheckoutMessage(`Order ${orderData.order_id} created for ₹${orderData.amount_rupees}. Awaiting payment confirmation.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Checkout encountered an error.';
      setCheckoutMessage(msg);
    } finally {
      setCheckingOut(false);
    }
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
          {checkoutMessage && (
            <div className="mb-3 p-3 rounded-lg bg-surface-2 border border-line text-[12px] text-ink text-center">
              {checkoutMessage}
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-ink-soft mb-3">
            <span>Platform service fee:</span>
            <span className="font-semibold text-brand">₹0.00 (Free)</span>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              fullWidth
              size="lg"
              variant="primary"
              onClick={handleCheckout}
              disabled={checkingOut}
              icon={checkingOut ? undefined : "shopping_cart_checkout"}
            >
              {checkingOut ? <Spinner size={18} /> : `Place Order & Pay (${items.length} ${items.length === 1 ? 'item' : 'items'})`}
            </Button>
            <Button
              fullWidth
              size="md"
              variant="secondary"
              onClick={() => {
                const first = items[0];
                const target = first?.affiliateLink || first?.productUrl || first?.url;
                if (target) safeOpenUrl(target);
              }}
              icon="open_in_new"
            >
              Visit Merchant Store
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cart;
