import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface WishlistItem {
  id: string;
  productId: string;
  brand: string;
  title: string;
  price: string;
  image: string;
  url: string;
}

const Wishlist: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }

    const likesRef = collection(db, 'users', user.uid, 'likes');
    const unsubscribe = onSnapshot(likesRef, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WishlistItem[];
      setItems(fetchedItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  const removeItem = async (id: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'likes', id));
    } catch (error) {
      console.error("Error removing item:", error);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate('/home')} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C]">My Wishlist</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#C9A06C]"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center opacity-60">
            <span className="material-symbols-outlined text-6xl mb-4 text-[#C9A06C]">favorite_border</span>
            <p className="text-lg font-medium">Your wishlist is empty</p>
            <p className="text-sm mt-2">Like items in the feed to see them here.</p>
            <button 
              onClick={() => navigate('/home')}
              className="mt-8 px-8 py-3 bg-[#C9A06C] text-black rounded-full font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
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
                    onClick={() => window.open(item.url, '_blank')}
                  >
                    <img 
                      src={item.image} 
                      alt={item.title} 
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <p className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-wider mb-0.5">{item.brand}</p>
                      <h3 className="text-sm font-bold leading-tight line-clamp-2">{item.title}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black text-white">{item.price}</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => window.open(item.url, '_blank')}
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
    </div>
  );
};

export default Wishlist;
