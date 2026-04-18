import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';

const FashionStudio: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  
  // State
  const [size, setSize] = useState('M');
  const [view, setView] = useState<'Front' | 'Side' | 'Back'>('Front');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [lighting, setLighting] = useState<'Studio' | 'Outdoor' | 'Night'>('Studio');
  const [isLiked, setIsLiked] = useState(false);
  const [wishlistCount, setWishlistCount] = useState(0);

  // Product Data from Location or Mock
  const incomingProduct = location.state?.product;
  const product = {
    id: incomingProduct?.id || 'wool-coat-1',
    name: incomingProduct?.title || 'Structured Wool Coat',
    brand: incomingProduct?.brand || 'The Row',
    price: incomingProduct?.price || '₹24,500',
    image: incomingProduct?.image || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop',
    url: incomingProduct?.url || 'https://www.therow.com/',
    recommendedSize: incomingProduct?.recommendedSize || 'M'
  };

  const sizes = ['XS', 'S', 'M', 'L', 'XL'];

  // Wishlist Logic
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const likesRef = collection(db, 'users', user.uid, 'likes');
    const unsubscribe = onSnapshot(likesRef, (snapshot) => {
      setWishlistCount(snapshot.size);
      const liked = snapshot.docs.some(doc => doc.id === product.id);
      setIsLiked(liked);
    });

    return () => unsubscribe();
  }, [product.id]);

  const toggleWishlist = async () => {
    const user = auth.currentUser;
    if (!user) {
      showToast("Please login to save items", "error");
      return;
    }

    const likeDocRef = doc(db, 'users', user.uid, 'likes', product.id);

    try {
      if (isLiked) {
        await deleteDoc(likeDocRef);
        showToast("Removed from Wishlist", "success");
      } else {
        await setDoc(likeDocRef, {
          productId: product.id,
          brand: product.brand,
          title: product.name,
          price: product.price,
          image: product.image,
          url: product.url,
          timestamp: new Date()
        });
        showToast("Added to Wishlist", "success");
      }
    } catch (error) {
      console.error("Error toggling wishlist:", error);
      showToast("Failed to update wishlist", "error");
    }
  };

  // Handle Size Change Animation
  const handleSizeChange = (newSize: string) => {
    setIsAnimating(true);
    setSize(newSize);
    setTimeout(() => setIsAnimating(false), 500); // 500ms morph duration
  };

  // Fit Logic
  const getFitStatus = () => {
    const indexDiff = sizes.indexOf(size) - sizes.indexOf(product.recommendedSize);
    if (indexDiff === 0) return { text: 'Perfect Fit', color: 'bg-green-500 text-white', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.4)]' };
    if (indexDiff < 0) return { text: 'Tight Fit', color: 'bg-red-500 text-white', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.4)]' };
    return { text: 'Relaxed Fit', color: 'bg-yellow-500 text-black', glow: 'shadow-[0_0_15px_rgba(234,179,8,0.4)]' };
  };

  const fit = getFitStatus();

  return (
    <div className="relative h-screen w-full bg-gradient-to-b from-[#0E0E0E] to-[#1A1A1A] text-white overflow-hidden font-display select-none">
      
      {/* Top Minimal Navbar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#111111]/40 backdrop-blur-md border-b border-white/5">
        <button 
          onClick={() => navigate(-1)} 
          className="h-10 w-10 flex items-center justify-center rounded-full bg-[#111111]/40 border border-white/5 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px] text-[#C9A06C]">arrow_back</span>
        </button>
        
        <div className="flex flex-col items-center bg-[#111111]/40 px-4 py-1 rounded-full border border-white/5">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{product.brand}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-white uppercase tracking-tight">
                <span className="text-white">Zip</span><span className="text-[#C9A06C]">RIGHT</span>
            </span>
            <span className="text-[10px] text-gray-500">/</span>
            <span className="text-[10px] font-bold text-white">Studio</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button 
             onClick={toggleWishlist}
             className="h-10 w-10 flex items-center justify-center rounded-full bg-[#111111]/40 border border-white/5 active:scale-95 transition-all relative"
           >
              <span className="material-symbols-outlined text-[18px] text-[#C9A06C]" style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0", color: isLiked ? "#FF4D6D" : "#C9A06C" }}>favorite</span>
              {wishlistCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-[#FF4D6D] rounded-full text-[8px] font-bold flex items-center justify-center text-white ring-2 ring-[#111111]">
                  {wishlistCount}
                </span>
              )}
           </button>
           <button className="h-10 w-10 flex items-center justify-center rounded-full bg-[#111111]/40 border border-white/5 active:scale-95 transition-all">
              <span className="material-symbols-outlined text-[18px] text-[#C9A06C]">ios_share</span>
           </button>
        </div>
      </div>

      {/* Fullscreen Try-On Canvas */}
      <div className={`relative w-full h-[85vh] mt-[8vh] transition-all duration-700 ease-in-out ${isZoomed ? 'scale-125 translate-y-10' : 'scale-100'}`}>
        
        {/* Background Environment / Lighting */}
        <div className={`absolute inset-0 transition-all duration-1000 ${
            lighting === 'Studio' ? 'bg-[radial-gradient(circle_at_center,#2a2a2a_0%,#000_100%)]' :
            lighting === 'Outdoor' ? 'bg-gradient-to-b from-blue-900/20 to-[#0D0D0D]' :
            'bg-[#050505]'
        }`}></div>

        {/* Avatar Layer */}
        <div className="absolute inset-0 flex items-center justify-center">
           {/* Simulate breathing animation */}
           <div className={`relative h-full w-full max-w-lg transition-transform duration-500 ${isAnimating ? 'scale-[1.01]' : 'scale-100'}`}>
              <div className="absolute inset-0 animate-[breathe_4s_ease-in-out_infinite]">
                  {/* Placeholder Avatar - Replace with actual 3D render output */}
                  <img 
                    src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop" 
                    className={`h-full w-full object-cover transition-all duration-500 ${showHeatmap ? 'opacity-70 grayscale' : 'opacity-90'}`}
                    alt="Virtual Try On" 
                    style={{ maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}
                    referrerPolicy="no-referrer"
                  />
                  
                  {/* Fit Heatmap Overlay */}
                  <div 
                    className={`absolute inset-0 transition-opacity duration-500 mix-blend-overlay ${showHeatmap ? 'opacity-70' : 'opacity-0'}`}
                    style={{
                        background: size === 'S' || size === 'XS' 
                            ? 'radial-gradient(circle at 50% 30%, rgba(255,0,0,0.6) 0%, transparent 40%)' // Tight chest
                            : size === 'XL' 
                            ? 'radial-gradient(circle at 50% 40%, rgba(0,0,255,0.4) 0%, transparent 50%)' // Loose waist
                            : 'none'
                    }}
                  ></div>
              </div>
           </div>
        </div>

        {/* Fit Status Micro Badge */}
        <div className="absolute top-[10%] right-[15%] z-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className={`px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10 flex items-center gap-2 ${fit.glow} transition-all duration-300`}>
                <div className={`h-2 w-2 rounded-full ${fit.color.split(' ')[0]}`}></div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-white">{fit.text}</span>
            </div>
        </div>

      </div>

      {/* Fit Heatmap Toggle (Left Float) */}
      <div className="absolute left-6 bottom-32 z-30 flex flex-col gap-4">
          <button 
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`h-12 w-12 rounded-full flex items-center justify-center border transition-all duration-300 backdrop-blur-md ${showHeatmap ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-black/30 border-white/10 text-white'}`}
          >
              <span className="material-symbols-outlined text-[20px]">layers</span>
          </button>
          <span className="text-[9px] font-bold text-center text-gray-400 uppercase tracking-widest -mt-2">Heatmap</span>
      </div>

      {/* View Controls (Right Float) */}
      <div className="absolute right-6 bottom-32 z-30 flex flex-col gap-3">
          {['Front', 'Side', 'Back'].map((v) => (
              <button 
                key={v}
                onClick={() => setView(v as any)}
                className={`h-10 w-10 rounded-full flex items-center justify-center border transition-all backdrop-blur-md ${view === v ? 'bg-white text-black border-white' : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'}`}
              >
                  <span className="text-[9px] font-black uppercase">{v[0]}</span>
              </button>
          ))}
          <div className="h-[1px] w-6 bg-white/10 mx-auto my-1"></div>
          <button 
            onClick={() => setIsZoomed(!isZoomed)}
            className={`h-10 w-10 rounded-full flex items-center justify-center border transition-all backdrop-blur-md ${isZoomed ? 'bg-white text-black border-white' : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'}`}
          >
              {isZoomed ? <span className="material-symbols-outlined text-[18px]">zoom_out</span> : <span className="material-symbols-outlined text-[18px]">zoom_in</span>}
          </button>
          <div className="h-[1px] w-6 bg-white/10 mx-auto my-1"></div>
          <button 
            onClick={() => setLighting(lighting === 'Studio' ? 'Outdoor' : lighting === 'Outdoor' ? 'Night' : 'Studio')}
            className="h-10 w-10 rounded-full flex items-center justify-center border border-white/10 bg-black/30 text-gray-400 hover:text-white backdrop-blur-md"
          >
              {lighting === 'Studio' ? <span className="material-symbols-outlined text-[18px]">light_mode</span> : lighting === 'Outdoor' ? <span className="material-symbols-outlined text-[18px]">cloud</span> : <span className="material-symbols-outlined text-[18px]">dark_mode</span>}
          </button>
      </div>

      {/* Size Switcher (Bottom Float Dock) */}
      <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-3 z-40">
          
          {/* Fabric Drape Indicator */}
          <div className="flex items-center gap-2 opacity-80 mb-1">
              <span className="material-symbols-outlined text-[14px] text-[#C9A06C] animate-bounce">accessibility</span>
              <span className="text-[10px] font-bold text-gray-300 tracking-wider uppercase">
                  {size === 'XS' || size === 'S' ? 'Structured Fit' : size === 'XL' ? 'Flowy Drape' : 'Natural Fall'}
              </span>
          </div>

          <div className="flex items-center gap-2 p-1.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
              {sizes.map((s) => {
                  const isSelected = size === s;
                  const isRecommended = s === product.recommendedSize;
                  
                  return (
                    <button
                        key={s}
                        onClick={() => handleSizeChange(s)}
                        className={`relative h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                            isSelected 
                            ? 'bg-white text-black scale-110 shadow-[0_0_15px_rgba(255,255,255,0.3)]' 
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        } ${isRecommended && !isSelected ? 'border border-[#C9A06C]/50 text-[#C9A06C]' : ''}`}
                    >
                        {s}
                        {isRecommended && !isSelected && (
                            <div className="absolute -top-1 -right-1 h-2 w-2 bg-[#C9A06C] rounded-full shadow-[0_0_5px_rgba(201,160,108,0.8)]"></div>
                        )}
                    </button>
                  );
              })}
          </div>
      </div>

      {/* Bottom Actions */}
      <div className="absolute bottom-0 left-0 right-0 z-50 p-6 bg-gradient-to-t from-[#0E0E0E] via-[#0E0E0E]/80 to-transparent">
        <div className="flex flex-col gap-3 max-w-md mx-auto">
          <button 
            onClick={toggleWishlist}
            className="w-full h-14 rounded-2xl bg-[#C9A06C] text-black font-bold text-xs uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            {isLiked ? 'Saved to Wishlist' : 'Add to Wishlist'}
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0", color: isLiked ? "black" : "inherit" }}>favorite</span>
          </button>
          <button 
            onClick={() => navigate('/home')}
            className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 text-white/60 font-bold text-[10px] uppercase tracking-[0.2em] active:scale-95 transition-all"
          >
            Explore More Outfits
          </button>
        </div>
      </div>

      {/* Global Styles for Animations */}
      <style>{`
        @keyframes breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }
      `}</style>

    </div>
  );
};

export default FashionStudio;
