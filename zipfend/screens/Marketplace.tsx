import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { fetchProductAvailability, fetchSizeChart } from '../services/BrandAPI';
import { demoProducts } from '../services/demoProducts';
import { Chip, Skeleton, EmptyState, Button, StaggerList, StaggerItem } from '../components/ui';

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
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-sans pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-surface-0/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div className="flex-1 flex justify-start">
            <button
              onClick={() => navigate('/home')}
              aria-label="Back to home"
              className="active:scale-90 p-2 -ml-2 rounded-full transition-transform"
            >
              <span className="material-symbols-outlined text-[24px] text-brand" aria-hidden="true">arrow_back</span>
            </button>
          </div>
          <h1 className="text-xs font-bold text-brand shrink-0">Marketplace</h1>
          <div className="flex-1 flex justify-end gap-2">
            <button onClick={() => navigate('/wishlist')} aria-label="Wishlist" className="active:scale-90 p-2 rounded-full transition-transform">
              <span className="material-symbols-outlined text-[24px] text-brand" aria-hidden="true">favorite</span>
            </button>
            <button
              onClick={() => navigate('/cart')}
              aria-label={`Cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
              className="relative active:scale-90 p-2 -mr-2 rounded-full transition-transform"
            >
              <span className="material-symbols-outlined text-[24px] text-brand" aria-hidden="true">shopping_cart</span>
              {cartCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 bg-success rounded-full text-[12px] font-bold flex items-center justify-center text-ink ring-2 ring-surface-0">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 pb-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint text-[20px] pointer-events-none" aria-hidden="true">search</span>
            <input
              type="search"
              aria-label="Search products"
              placeholder="Search brands, styles, items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-12 bg-surface-2 border border-transparent rounded-full pl-12 pr-10 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition-[border-color,box-shadow]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full active:scale-90"
              >
                <span className="material-symbols-outlined text-ink-faint text-[18px]" aria-hidden="true">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Categories */}
        <div className="flex overflow-x-auto gap-2 px-4 pb-3 no-scrollbar" role="group" aria-label="Filter by category">
          {CATEGORIES.map(category => (
            <Chip
              key={category}
              selected={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </Chip>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 px-4 pt-2" aria-label="Loading products" role="status">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
              <div className="px-1 flex flex-col gap-2">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        products.length === 0 ? (
          <EmptyState
            icon="inventory_2"
            title="Catalogue unavailable"
            description={catalogMessage}
          />
        ) : (
          <EmptyState
            icon="search_off"
            title="Nothing matches"
            description={`No products found for "${searchQuery || selectedCategory}". Try a different search or category.`}
            action={
              <Button variant="secondary" onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}>
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        <StaggerList className="grid grid-cols-2 gap-4 px-4 pt-2" delay={0.04}>
          {filteredProducts.map(product => (
            <StaggerItem key={product.id}>
              <div
                onClick={() => handleProductClick(product)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleProductClick(product); }}
                className="flex flex-col gap-3 cursor-pointer active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-2xl"
              >
                <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-surface-2 border border-line">
                  <img
                    src={product.image}
                    alt={product.title}
                    loading="lazy"
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-500"
                    onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                    referrerPolicy="no-referrer"
                  />
                  <button
                    onClick={(e) => toggleLike(e, product)}
                    aria-label={likedMap[product.id] ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`}
                    className="absolute top-3 right-3 p-2 bg-black/40 rounded-full backdrop-blur-md border border-line active:scale-90 transition-transform"
                  >
                    <span
                      className={`material-symbols-outlined text-[18px] ${likedMap[product.id] ? 'text-[#FF4D6D] filled' : 'text-ink'}`}
                      style={{ fontVariationSettings: likedMap[product.id] ? "'FILL' 1" : "'FILL' 0" }}
                      aria-hidden="true"
                    >
                      favorite
                    </span>
                  </button>
                </div>
                <div className="px-1">
                  <p className="font-bold text-sm text-ink tracking-tight">{product.brand}</p>
                  <p className="text-ink-soft text-xs truncate mt-0.5">{product.title}</p>
                  <p className="font-bold text-sm text-brand mt-1.5">{product.price}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
};

export default Marketplace;
