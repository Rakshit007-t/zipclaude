import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface WardrobeItem {
  id: string;
  productId: string;
  brand: string;
  title: string;
  price: string;
  image: string;
  category?: string;
  type?: string;
}

const RecentScans: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }

    const wardrobeRef = collection(db, 'users', user.uid, 'wardrobe');
    const unsubscribe = onSnapshot(wardrobeRef, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WardrobeItem[];
      setItems(fetchedItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  const removeItem = async (id: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'wardrobe', id));
    } catch (error) {
      console.error("Error removing item:", error);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-body">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate('/home')} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#8B5CF6]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#8B5CF6]">My Wardrobe</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 p-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#8B5CF6]"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center opacity-60">
            <span className="material-symbols-outlined text-6xl mb-4 text-[#8B5CF6]">checkroom</span>
            <p className="text-lg font-medium">Your wardrobe is empty</p>
            <p className="text-sm mt-2">Swipe left on items in the feed to save them to your style profile.</p>
            <button 
              onClick={() => navigate('/home')}
              className="mt-8 px-8 py-3 bg-[#8B5CF6] text-white rounded-full font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
            >
              Explore Feed
            </button>
          </div>
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
                  className="bg-white/5 rounded-2xl overflow-hidden border border-white/5 flex flex-col relative group"
                >
                  <div className="aspect-[3/4] w-full bg-black/20 relative">
                    <img 
                      src={item.image} 
                      alt={item.title} 
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform border border-white/10"
                    >
                      <span className="material-symbols-outlined text-[16px] text-white">close</span>
                    </button>
                  </div>
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-[9px] font-bold text-[#8B5CF6] uppercase tracking-wider mb-0.5">{item.brand}</p>
                      <h3 className="text-xs font-bold leading-tight line-clamp-1">{item.title}</h3>
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
