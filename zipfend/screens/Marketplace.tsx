import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { fetchProductAvailability, fetchSizeChart } from '../services/BrandAPI';
import { demoProducts } from '../services/demoProducts';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

export interface Product {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  category: string;
  type: string;
  url: string;
  affiliateLink?: string;
  description?: string;
}

const CATEGORIES = ['All', 'Women', 'Men', 'Kids', 'Shoes', 'Accessories'];

const Marketplace: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [cartCount, setCartCount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [catalogMessage, setCatalogMessage] = useState('Data unavailable');

  useEffect(() => {
    const fetchProducts = async () => {
      setProducts(demoProducts);
      setIsLoading(false);
    };
    fetchProducts();
    setCartCount(1);
    setLikedMap({});
  }, []);

  useEffect(() => {
    let result = products;
    if (selectedCategory !== 'All') {
      result = result.filter(p =>
        p.category?.toLowerCase() === selectedCategory.toLowerCase() ||
        p.type?.toLowerCase() === selectedCategory.toLowerCase() ||
        (selectedCategory === 'Accessories' && p.type === 'accessory')
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      );
    }
    setFilteredProducts(result);
  }, [searchQuery, selectedCategory, products]);

  const toggleLike = async (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    const user = auth.currentUser;
    if (!user && !hasDemoSession()) {
      navigate('/login');
      return;
    }

    void product;
    showToast('Wishlist syncing is unavailable right now.', 'error');
  };

  const handleProductClick = async (product: Product) => {
    const user = auth.currentUser;
    if (!user && !hasDemoSession()) {
      navigate('/login');
      return;
    }

    try {
      const [stockData, sizeChart] = await Promise.all([
        fetchProductAvailability(product.brand, product.title),
        fetchSizeChart(product.brand, product.category || 'Tops')
      ]);

      navigate('/recommendation', {
        state: {
          product: {
            ...product,
            stock: stockData,
            sizeChart: sizeChart
          },
          productUrl: product.affiliateLink || product.url,
          source: 'marketplace'
        }
      });
    } catch (error) {
      console.error("Error navigating to recommendation:", error);
      showToast("Something went wrong", "error");
      window.open(product.affiliateLink || product.url, '_blank');
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-display pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111] shrink-0">
        <div className="flex-1 flex justify-start">
          <button onClick={() => navigate('/home')} className="active:scale-90 p-2 -ml-2 rounded-full transition-transform">
            <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">arrow_back</span>
          </button>
        </div>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C] shrink-0">Marketplace</h1>
        <div className="flex-1 flex justify-end gap-2">
          <button onClick={() => navigate('/wishlist')} className="active:scale-90 p-2 rounded-full transition-transform">
            <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">favorite</span>
          </button>
          <button onClick={() => navigate('/cart')} className="relative active:scale-90 p-2 -mr-2 rounded-full transition-transform">
            <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">shopping_cart</span>
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 h-4 w-4 bg-[#22c55e] rounded-full text-[8px] font-bold flex items-center justify-center text-white ring-2 ring-black/20">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 pb-4 sticky top-[88px] z-40 bg-[#111111]">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-[20px]">search</span>
          <input
            type="text"
            placeholder="Search brands, styles, items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-12 pr-4 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#C9A06C]/50 transition-colors"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex overflow-x-auto gap-2 px-4 pb-4 no-scrollbar sticky top-[152px] z-40 bg-[#111111]">
        {CATEGORIES.map(category => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`px-5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors active:scale-95 ${selectedCategory === category
                ? 'bg-[#C9A06C] text-black'
                : 'bg-white/5 text-white/70 border border-white/10'
              }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#C9A06C]"></div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center opacity-50">
          <span className="material-symbols-outlined text-4xl mb-4">search_off</span>
          <p className="text-sm">{products.length === 0 ? catalogMessage : 'No products found for your search.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 px-4">
          {filteredProducts.map(product => (
            <div
              key={product.id}
              onClick={() => handleProductClick(product)}
              className="flex flex-col gap-3 cursor-pointer active:scale-[0.98] transition-transform"
            >
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-white/5 border border-white/5">
                <img
                  src={product.image}
                  alt={product.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={(e) => toggleLike(e, product)}
                  className="absolute top-3 right-3 p-2 bg-black/40 rounded-full backdrop-blur-md border border-white/10 active:scale-90 transition-transform"
                >
                  <span
                    className={`material-symbols-outlined text-[18px] ${likedMap[product.id] ? 'text-[#FF4D6D] filled' : 'text-white'}`}
                    style={{ fontVariationSettings: likedMap[product.id] ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    favorite
                  </span>
                </button>
              </div>
              <div className="px-1">
                <p className="font-bold text-sm text-white tracking-tight">{product.brand}</p>
                <p className="text-white/60 text-xs truncate mt-0.5">{product.title}</p>
                <p className="font-black text-sm text-[#C9A06C] mt-1.5">{product.price}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
