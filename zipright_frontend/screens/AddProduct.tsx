import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { getUserRole, UserRole } from '../utils/subscription';
import { fetchSizeChart } from '../services/BrandAPI';
import { handleFirestoreError, OperationType } from '../utils/errorHandlers';
import { useToast } from '../contexts/ToastContext';

interface Member {
  id: string;
  name: string;
  isPrimary: boolean;
}

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:8000';

function getBackendBaseUrl() {
  const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  return (envBaseUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '');
}

async function extractProductFromBackend(url: string) {
  const apiUrl = `${getBackendBaseUrl()}/extract-product`;
  console.log('[AddProduct] POST', apiUrl, { url });

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch (networkErr) {
    console.error('[AddProduct] Network error reaching', apiUrl, networkErr);
    throw new Error(`Cannot reach backend at ${getBackendBaseUrl()}. Is the server running?`);
  }

  const payload = await response.json().catch(() => null);
  console.log('[AddProduct] /extract-product', response.status, payload);

  if (!response.ok || !payload?.data) {
    const errMsg =
      payload?.error?.message ||
      payload?.detail ||
      `Server returned ${response.status}`;
    console.error('[AddProduct] /extract-product FAILED:', { status: response.status, payload });
    throw new Error(errMsg);
  }

  console.log('[AddProduct] Extracted product:', payload.data);
  return payload.data;
}

function buildFallbackProductImage(category?: string, brand?: string) {
  const categoryToken = encodeURIComponent(category || 'clothing');
  const brandToken = encodeURIComponent(brand || 'fashion');
  return `https://source.unsplash.com/featured/600x800/?${categoryToken},${brandToken}`;
}

const AddProduct: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [link, setLink] = useState('');
  const [activeTab, setActiveTab] = useState<'link' | 'image'>('link');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [isListing, setIsListing] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
            const q = query(collection(db, 'users', user.uid, 'history'));
            const snapshot = await getDocs(q);
            const historyList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setHistory(historyList.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5));
        } catch (e) {
            console.error("Error fetching history", e);
        }
    };
    fetchHistory();
  }, []);
  
  // Image Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzedProduct, setAnalyzedProduct] = useState<any>(null);

  useEffect(() => {
    const fetchMembers = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
        const q = query(collection(db, 'members'), where('uid', '==', user.uid), where('isPrimary', '==', true));
        const querySnapshot = await getDocs(q);
        const membersList: Member[] = [];
        querySnapshot.forEach((doc) => {
          membersList.push({ id: doc.id, ...doc.data() } as Member);
        });

        if (membersList.length > 0) {
          setMembers(membersList);
        } else {
          // Fallback if no members in Firestore
          setMembers([{ id: '1', name: 'My Fits', isPrimary: true }]);
        }
      } catch (error) {
        console.error("Error fetching members:", error);
        setMembers([{ id: '1', name: 'My Fits', isPrimary: true }]);
      }
    };

    fetchMembers();
    setUserRole(getUserRole());
  }, []);

  useEffect(() => {
    if (activeTab === 'link') {
        const isValidUrl = link.length > 0 && link.includes('.');
        setIsValid(isValidUrl);
    } else {
        setIsValid(!!selectedImage);
    }
  }, [link, selectedImage, activeTab]);

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };

  const lastExtractedLinkRef = useRef('');

  useEffect(() => {
    if (activeTab === 'link' && isValid && link !== lastExtractedLinkRef.current && !isLoading) {
      const timer = setTimeout(() => {
        lastExtractedLinkRef.current = link;
        handleGetSize();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [link, isValid, activeTab, isLoading]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (e) => {
              if (e.target?.result) {
                  setSelectedImage(e.target.result as string);
              }
          };
          reader.readAsDataURL(event.target.files[0]);
      }
  };

  const handleGetSize = async () => {
    if (!isValid) return;
    const user = auth.currentUser;
    if (!user) {
      showToast("Please login to analyze products", "error");
      return;
    }

    setIsLoading(true);
    if (navigator.vibrate) navigator.vibrate(20);
    if (activeTab === 'image' && selectedImage) {
        try {
            const productData: any = {
                title: 'Uploaded Item',
                brand: 'Unknown',
                price: 'INR --',
                category: 'Clothing'
            };
            const sizeChart = await fetchSizeChart(productData.brand, productData.category);
            console.debug('[AddProduct] image size chart response', sizeChart);
            setAnalyzedProduct({
                ...productData,
                image: selectedImage,
                sizeChart
            });
            setIsModalOpen(true);
            showToast("Photo added. Using standard sizing data for this item.", "success");
        } catch (error) {
            console.error("Image analysis fallback failed", error);
            showToast("Could not process image. Please try again.", "error");
        } finally {
            setIsLoading(false);
        }
        return;
    }
    try {
        console.log('[AddProduct] Calling /extract-product with URL:', link);
        const extractedProduct = await extractProductFromBackend(link);
        
        const finalImage = extractedProduct.image || buildFallbackProductImage(extractedProduct.category, extractedProduct.brand);
        console.log("image:", finalImage);
        
        const productData: any = {
            title: extractedProduct.title || 'Product from Link',
            brand: extractedProduct.brand || 'Unknown',
            price: extractedProduct.price || 'INR --',
            category: extractedProduct.category || 'Clothing',
            image: finalImage,
            url: link
        };
        console.log('[AddProduct] Final productData:', productData);
        const sizeChart = await fetchSizeChart(productData.brand, productData.category);
        console.debug('[AddProduct] Size chart response:', sizeChart);
        setAnalyzedProduct({
            ...productData,
            sizeChart
        });
        setIsModalOpen(true);
        showToast("Product link analyzed successfully.", "success");
    } catch (error) {
        console.error('[AddProduct] Link analysis failed:', error);
        const msg = error instanceof Error ? error.message : 'Could not analyze link. Please try again.';
        showToast(msg, "error");
    } finally {
        setIsLoading(false);
    }
  };

  const handleProfileSelect = async (memberId: string) => {
    setIsModalOpen(false);
    
    // Save to history
    const historyItem = {
        title: analyzedProduct.title,
        brand: analyzedProduct.brand,
        price: analyzedProduct.price,
        image: analyzedProduct.image,
        date: new Date().toLocaleDateString()
    };
    
    if (auth.currentUser) {
        try {
            const historyRef = collection(db, 'users', auth.currentUser.uid, 'history');
            await addDoc(historyRef, historyItem);
        } catch (e) {
            console.error("Error saving history", e);
        }
    }

    navigate('/recommendation', { 
        state: { 
            memberId, 
            product: analyzedProduct,
            productUrl: link
        } 
    });
  };

  const handleListForSale = async () => {
    if (!analyzedProduct || !auth.currentUser) return;
    
    setIsListing(true);
    try {
        // Clean price string to number
        const priceStr = analyzedProduct.price || '0';
        const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

        await addDoc(collection(db, 'marketplace_products'), {
            sellerId: auth.currentUser.uid,
            title: analyzedProduct.title,
            brand: analyzedProduct.brand || 'Unknown',
            price: priceNum,
            category: analyzedProduct.category || 'Clothing',
            images: [analyzedProduct.image],
            sizes: ['S', 'M', 'L', 'XL'], // Default sizes from AI analysis or standard
            inStock: true,
            description: analyzedProduct.description || `High-quality ${analyzedProduct.title} from ${analyzedProduct.brand}`,
            stock: 10, // Default stock
            createdAt: serverTimestamp(),
            condition: 'New',
            fitScore: 85, // Default AI fit score
            returnRisk: 5
        });

        showToast("Product listed in marketplace!", "success");
        setIsModalOpen(false);
        navigate('/seller/products');
    } catch (error) {
        console.error("Error listing product:", error);
        showToast("Failed to list product.", "error");
    } finally {
        setIsListing(false);
    }
  };

  const quickLinks = [
    { name: 'Zara', url: 'https://www.zara.com/in/' },
    { name: 'H&M', url: 'https://www2.hm.com/en_in/' },
    { name: 'Myntra', url: 'https://www.myntra.com/' },
    { name: 'Ajio', url: 'https://www.ajio.com/' },
  ];

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col overflow-x-hidden bg-[#111111] text-white font-sans">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>

      {/* Top App Bar */}
      <div className="sticky top-0 z-50 flex items-center bg-[#111111]/80 backdrop-blur-xl p-6 justify-between border-b border-white/5">
        <button onClick={handleBack} className="text-[#C9A06C] flex size-12 shrink-0 items-center justify-start cursor-pointer active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <h2 className="text-[#C9A06C] text-xs font-bold uppercase tracking-[0.3em] flex-1 text-center pr-12">AI Sizing Engine</h2>
      </div>

      <div className="flex-1 flex flex-col px-6 pt-8 pb-32">
        
        {/* Toggle Tabs */}
        <div className="flex p-1 bg-white/5 rounded-2xl mb-10 border border-white/5">
            <button 
                onClick={() => setActiveTab('link')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'link' ? 'bg-[#C9A06C] text-[#111111] shadow-xl' : 'text-white/40'}`}
            >
                Paste Link
            </button>
            <button 
                onClick={() => setActiveTab('image')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'image' ? 'bg-[#C9A06C] text-[#111111] shadow-xl' : 'text-white/40'}`}
            >
                Upload Photo
            </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-col gap-8 mb-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            <h1 className="text-4xl font-serif italic font-medium tracking-tight text-white">
                {activeTab === 'link' ? 'Find Your Fit' : 'Scan Your Style'}
            </h1>
            <p className="text-white/40 text-sm font-light leading-relaxed max-w-[80%]">
                {activeTab === 'link' ? 'Paste the URL of the item you desire, and we\'ll reveal your perfect size.' : 'Capture a clear image of the garment to begin the analysis.'}
            </p>
          </motion.div>

          {activeTab === 'link' ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-8"
              >
                <div className="flex flex-col w-full relative group">
                    <input 
                        value={link}
                        onChange={(e) => {
                            setLink(e.target.value);
                            if (!e.target.value) { lastExtractedLinkRef.current = ''; }
                        }}
                        disabled={isLoading}
                        className={`w-full bg-transparent border-b-2 py-6 text-2xl font-serif italic text-white placeholder:text-white/20 focus:outline-none transition-all ${isLoading ? 'border-white/5 opacity-50' : 'border-white/10 focus:border-[#C9A06C]'}`} 
                        placeholder="Paste or share link..." 
                        type="url" 
                        autoFocus
                    />
                    <div className="absolute right-0 bottom-6 flex items-center gap-4">
                        {link && !isLoading && (
                            <button 
                                onClick={() => { setLink(''); lastExtractedLinkRef.current = ''; }}
                                className="text-white/20 hover:text-white transition-colors"
                            >
                                <span className="material-symbols-outlined text-xl">close</span>
                            </button>
                        )}
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-[#C9A06C] border-t-transparent rounded-full animate-spin mb-1"></div>
                        ) : (
                            <span className={`material-symbols-outlined mb-1 transition-colors ${isValid ? 'text-[#C9A06C]' : 'text-white/10'}`}>
                                {isValid ? 'check_circle' : 'link'}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <p className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em]">Quick Access</p>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                        {quickLinks.map((ql, idx) => (
                            <button 
                                key={idx}
                                onClick={() => setLink(ql.url)}
                                className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 active:scale-95 transition-all whitespace-nowrap"
                            >
                                <span className="text-xs font-bold text-white/60">{ql.name}</span>
                                <span className="material-symbols-outlined text-[14px] text-[#C9A06C]">arrow_outward</span>
                            </button>
                        ))}
                    </div>
                </div>
              </motion.div>
          ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative w-full aspect-[4/5] rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${selectedImage ? 'border-transparent' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                      {selectedImage ? (
                          <>
                            <img src={selectedImage} alt="Selected" className="w-full h-full object-cover rounded-[3rem]" />
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center rounded-[3rem] opacity-0 hover:opacity-100 transition-opacity">
                                <span className="text-white text-xs font-bold uppercase tracking-widest bg-black/50 px-6 py-3 rounded-full border border-white/20">Change Photo</span>
                            </div>
                          </>
                      ) : (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-20 h-20 rounded-full bg-[#C9A06C]/10 flex items-center justify-center border border-[#C9A06C]/20">
                                <span className="material-symbols-outlined text-4xl text-[#C9A06C]">add_a_photo</span>
                            </div>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Tap to capture</span>
                          </div>
                      )}
                  </div>
              </motion.div>
          )}
        </div>

        {/* Recent Scans Section */}
        {history.length > 0 && (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-6 mb-12"
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em]">Recent Scans</h3>
                    <button className="text-[10px] font-bold text-white/30 uppercase tracking-widest">View All</button>
                </div>
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                    {history.map((item, idx) => (
                        <button 
                            key={idx}
                            onClick={() => navigate('/recommendation', { state: { product: item } })}
                            className="flex flex-col gap-3 min-w-[120px] active:scale-95 transition-transform"
                        >
                            <div 
                                className="w-full aspect-[3/4] rounded-2xl bg-white/5 border border-white/10 bg-center bg-cover"
                                style={{ backgroundImage: `url("${item.image}")` }}
                            ></div>
                            <div className="flex flex-col items-start px-1">
                                <span className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-tighter truncate w-full text-left">{item.brand}</span>
                                <span className="text-xs font-medium text-white/60 truncate w-full text-left">{item.title}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </motion.div>
        )}

        {/* Info Box */}
        <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-[#1A1A1A] to-[#111111] border border-white/5 flex items-start gap-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#C9A06C]/5 blur-[40px] rounded-full -mr-12 -mt-12"></div>
          <div className="h-12 w-12 rounded-full bg-[#C9A06C]/10 flex items-center justify-center shrink-0 border border-[#C9A06C]/20">
             <span className="material-symbols-outlined text-[#C9A06C] text-2xl">auto_awesome</span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold text-[#C9A06C] uppercase tracking-[0.2em]">Neural Sizing</p>
            <p className="text-sm text-white/40 leading-relaxed font-light">
              Our AI analyzes fabric drape, brand-specific patterns, and your unique geometry to ensure a flawless fit.
            </p>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Button */}
      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#111111] via-[#111111]/90 to-transparent z-50">
        <div className="max-w-md mx-auto">
            <motion.button 
                whileTap={{ scale: 0.95 }}
                onClick={handleGetSize}
                disabled={!isValid || isLoading}
                className={`flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-[2rem] h-18 px-5 transition-all ${isValid ? 'bg-white text-[#111111] shadow-[0_10px_30px_rgba(255,255,255,0.1)]' : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'}`}
            >
                {isLoading ? (
                    <div className="flex items-center gap-4">
                        <div className="w-5 h-5 border-2 border-[#111111] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs font-bold uppercase tracking-[0.3em]">Analyzing...</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold uppercase tracking-[0.3em]">
                            {activeTab === 'image' ? 'Analyze Garment' : 'Reveal My Size'}
                        </span>
                        <span className="material-symbols-outlined text-[20px]">straighten</span>
                    </div>
                )}
            </motion.button>
        </div>
      </div>

      {/* Profile Selection Modal */}
      <AnimatePresence>
        {isModalOpen && (
            <>
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md" 
                onClick={() => setIsModalOpen(false)}
            ></motion.div>
            <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed bottom-0 left-0 right-0 z-[70] bg-[#1A1A1A] rounded-t-[3rem] p-10 pb-12 shadow-2xl max-w-md mx-auto border-t border-white/10"
            >
                <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-10"></div>
                
                <div className="flex items-center justify-between mb-4">
                <h3 className="text-3xl font-serif italic font-medium text-white">Select Profile</h3>
                <button 
                    onClick={() => setIsModalOpen(false)} 
                    className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center active:scale-90 transition-transform"
                >
                    <span className="material-symbols-outlined text-white text-lg">close</span>
                </button>
                </div>
                
                <p className="text-sm text-white/40 font-light mb-10">Who are we styling today? We'll match the garment to their unique profile.</p>

                {userRole === 'seller' && (
                    <div className="mb-10 p-6 rounded-[2.5rem] bg-emerald-500/5 border border-emerald-500/20">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="material-symbols-outlined text-emerald-500 text-xl">storefront</span>
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.3em]">Seller Dashboard</span>
                        </div>
                        <button 
                            onClick={handleListForSale}
                            disabled={isListing}
                            className="w-full h-14 rounded-2xl bg-emerald-500 text-white font-bold text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-emerald-500/10 active:scale-95 flex items-center justify-center gap-3 transition-all"
                        >
                            {isListing ? (
                                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-lg">publish</span>
                                    List for Sale
                                </>
                            )}
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-4 max-h-[40vh] overflow-y-auto no-scrollbar">
                {members.map(member => (
                    <button 
                        key={member.id}
                        onClick={() => handleProfileSelect(member.id)}
                        className="group flex items-center justify-between p-5 rounded-[2rem] bg-white/5 border border-white/5 active:scale-[0.98] transition-all hover:bg-white/10"
                    >
                    <div className="flex items-center gap-5">
                        <div className={`h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold shadow-2xl ${member.isPrimary ? 'bg-gradient-to-tr from-[#B5853F] to-[#C9A06C] text-white' : 'bg-white/10 text-white'}`}>
                            {member.isPrimary ? <span className="material-symbols-outlined">person</span> : member.name.charAt(0)}
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-lg font-bold text-white">{member.name}</span>
                            {member.isPrimary && <span className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-widest">Primary Fit</span>}
                        </div>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white/20 group-hover:text-[#C9A06C] transition-colors">chevron_right</span>
                    </div>
                    </button>
                ))}
                
                <button 
                    onClick={() => navigate('/settings')} 
                    className="flex items-center justify-center p-6 mt-4 rounded-[2rem] border-2 border-dashed border-white/10 text-white/30 font-bold text-xs uppercase tracking-widest gap-3 active:scale-[0.98] transition-all hover:bg-white/5"
                >
                    <span className="material-symbols-outlined">add_circle</span>
                    <span>Create New Profile</span>
                </button>
                </div>
            </motion.div>
            </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AddProduct;

