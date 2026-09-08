import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { fetchProductAvailability, fetchSizeChart } from '../services/BrandAPI';
import { demoProducts } from '../services/demoProducts';
import { closetCount, listCloset, onClosetChange, toggleCloset } from '../services/closet';
import { Chip, Skeleton, EmptyState, Button, Eyebrow, IconButton, StaggerList, StaggerItem } from '../components/ui';
import { safeOpenUrl } from '../utils/sanitize';


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
    const sync = () => {
      setCartCount(closetCount('cart'));
      const map: Record<string, boolean> = {};
      listCloset('likes').forEach(i => { map[i.id] = true; });
      setLikedMap(map);
    };
    sync();
    return onClosetChange(sync);
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
    if (!user) {
      navigate('/login');
      return;
    }

    const saved = toggleCloset('likes', {
      id: product.id, title: product.title, brand: product.brand, price: product.price,
      image: product.image, url: product.url, affiliateLink: product.affiliateLink, category: product.category,
    });
    showToast(saved ? 'Saved to wishlist ♥' : 'Removed from wishlist', 'success');
  };

  const handleProductClick = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) {
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
      safeOpenUrl(product.affiliateLink || product.url);
    }
  };

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink pb-32">
      {/* Masthead */}
      <div className="sticky top-0 z-50 bg-surface-0/90 backdrop-blur-xl border-b border-line">
        <div className="flex items-end justify-between px-6 pt-6 pb-4">
          <div>
            <Eyebrow className="mb-1.5">The edit</Eyebrow>
            <h1 className="font-display text-[28px] leading-none font-light">
              Market<em className="font-medium">place.</em>
            </h1>
          </div>
          <div className="flex gap-2">
            <IconButton icon="favorite" aria-label="Wishlist" variant="ghost" size="sm" onClick={() => navigate('/wishlist')} />
            <div className="relative">
              <IconButton
                icon="shopping_bag"
                aria-label={`Cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
                variant="ghost"
                size="sm"
                onClick={() => navigate('/cart')}
              />
              {cartCount > 0 && (
                <span className="absolute top-0 right-0 h-4 w-4 bg-brand rounded-full text-[10px] font-bold flex items-center justify-center text-on-brand pointer-events-none">
                  {cartCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 pb-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint text-[19px] pointer-events-none" aria-hidden="true">search</span>
            <input
              type="search"
              aria-label="Search products"
              placeholder="Search brands, styles, pieces…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-11 bg-surface-1 border border-line rounded-full pl-11 pr-10 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full active:scale-90"
              >
                <span className="material-symbols-outlined text-ink-faint text-[17px]" aria-hidden="true">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Categories */}
        <div className="flex overflow-x-auto gap-2 px-6 pb-3.5 no-scrollbar" role="group" aria-label="Filter by category">
          {CATEGORIES.map(category => (
            <Chip
              key={category}
              size="sm"
              selected={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </Chip>
          ))}
        </div>
      </div>

      {/* Affiliate & Nominative Fair Use Disclosure */}
      <div className="px-6 pt-3 pb-1">
        <div className="rounded-lg bg-surface-1/70 border border-line/60 px-3.5 py-2 text-[11px] text-ink-faint leading-relaxed flex items-start gap-2">
          <span className="material-symbols-outlined text-[14px] text-ink-soft shrink-0 mt-0.5" aria-hidden="true">info</span>
          <span>
            <strong className="text-ink-soft font-medium">Affiliate Disclosure:</strong> ZipRIGHT participates in merchant affiliate programs. When you click through and purchase garments, we may earn an affiliate commission at no additional cost to you. Brand names are used solely for descriptive sizing analysis under nominative fair use.
          </span>
        </div>
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 px-6 pt-5" aria-label="Loading products" role="status">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-[3/4] w-full rounded-xl" />
              <div className="px-0.5 flex flex-col gap-2">
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
              <Button variant="outline" onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}>
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        <StaggerList className="grid grid-cols-2 gap-x-4 gap-y-7 px-6 pt-5" delay={0.04}>
          {filteredProducts.map(product => (
            <StaggerItem key={product.id}>
              <div
                onClick={() => handleProductClick(product)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleProductClick(product); }}
                className="flex flex-col gap-3 cursor-pointer active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
              >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface-2 border border-line">
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
                    className="absolute top-2.5 right-2.5 p-2 bg-black/35 rounded-full backdrop-blur-md active:scale-90 transition-transform"
                  >
                    <span
                      className={`material-symbols-outlined text-[17px] ${likedMap[product.id] ? 'text-[#f2705c]' : 'text-white'}`}
                      style={{ fontVariationSettings: likedMap[product.id] ? "'FILL' 1" : "'FILL' 0" }}
                      aria-hidden="true"
                    >
                      favorite
                    </span>
                  </button>
                </div>
                <div className="px-0.5">
                  <p className="font-display text-[15px] font-medium text-ink leading-tight">{product.brand}</p>
                  <p className="text-ink-faint text-[11.5px] truncate mt-0.5">{product.title}</p>
                  <p className="text-[13px] font-semibold text-ink mt-1.5">{product.price}</p>
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
