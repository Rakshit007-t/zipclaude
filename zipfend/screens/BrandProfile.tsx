import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { authorizedFetch, getBackendBaseUrl } from '../services/ziprightApi';
import { Button, Wordmark, ScreenFallback } from '../components/ui';

interface BrandProfileData {
  id: string;
  seller_uid: string;
  brand_name: string;
  slug: string;
  logo_url: string | null;
  banner_url: string | null;
  bio: string | null;
  website_url: string | null;
  is_verified: boolean;
  followers_count: number;
  products_count: number;
}

interface CollectionData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  product_count: number;
}

export const BrandProfile: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<BrandProfileData | null>(null);
  const [collections, setCollections] = useState<CollectionData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);

  useEffect(() => {
    async function loadBrandData() {
      if (!slug) return;
      setIsLoading(true);
      try {
        const baseUrl = getBackendBaseUrl();
        const res = await authorizedFetch(`${baseUrl}/brands/${slug}`);
        if (res.ok) {
          const json = await res.json();
          if (json.isValid && json.data) {
            setBrand(json.data);
          }
        }
        const colRes = await authorizedFetch(`${baseUrl}/brands/${slug}/collections`);
        if (colRes.ok) {
          const colJson = await colRes.json();
          if (colJson.isValid && Array.isArray(colJson.data)) {
            setCollections(colJson.data);
          }
        }
      } catch (err) {
        console.error('Error fetching brand profile:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadBrandData();
  }, [slug]);

  if (isLoading) {
    return <ScreenFallback />;
  }

  if (!brand) {
    return (
      <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center text-center">
        <Wordmark className="mb-4" />
        <h2 className="text-xl font-bold mb-2">Brand Not Found</h2>
        <p className="text-neutral-400 mb-6">We couldn't find the requested brand showcase.</p>
        <Button onClick={() => navigate('/marketplace')}>Browse Marketplace</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      {/* Banner */}
      <div className="h-48 bg-gradient-to-r from-amber-900/40 via-neutral-900 to-black relative">
        {brand.banner_url && (
          <img src={brand.banner_url} alt={brand.brand_name} className="w-full h-full object-cover opacity-60" />
        )}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 rounded-full bg-black/60 backdrop-blur text-white hover:bg-black/80 transition"
        >
          ← Back
        </button>
      </div>

      {/* Brand Header */}
      <div className="max-w-4xl mx-auto px-6 relative -mt-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-6">
          <div className="flex items-end gap-4">
            <div className="w-24 h-24 rounded-2xl bg-neutral-800 border-4 border-black overflow-hidden flex items-center justify-center text-2xl font-bold text-amber-500 shadow-xl">
              {brand.logo_url ? (
                <img src={brand.logo_url} alt={brand.brand_name} className="w-full h-full object-cover" />
              ) : (
                brand.brand_name.charAt(0)
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{brand.brand_name}</h1>
                {brand.is_verified && (
                  <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30">
                    Verified Brand
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-400">@{brand.slug}</p>
            </div>
          </div>

          <Button
            onClick={() => setIsFollowing(!isFollowing)}
            className={isFollowing ? 'bg-neutral-800 text-white' : 'bg-amber-500 text-black font-semibold'}
          >
            {isFollowing ? 'Following' : 'Follow Brand'}
          </Button>
        </div>

        {/* Bio */}
        {brand.bio && <p className="text-sm text-neutral-300 mb-6 leading-relaxed">{brand.bio}</p>}

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 mb-8 text-center">
          <div>
            <div className="text-xl font-bold text-white">{brand.followers_count}</div>
            <div className="text-xs text-neutral-400">Followers</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">{brand.products_count}</div>
            <div className="text-xs text-neutral-400">Products</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">{collections.length}</div>
            <div className="text-xs text-neutral-400">Collections</div>
          </div>
        </div>

        {/* Collections Section */}
        <h2 className="text-lg font-bold text-white mb-4">Featured Collections</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {collections.map((col) => (
            <motion.div
              key={col.id}
              whileHover={{ scale: 1.02 }}
              className="p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/40 transition cursor-pointer"
            >
              <h3 className="font-semibold text-white mb-1">{col.name}</h3>
              {col.description && <p className="text-xs text-neutral-400 mb-3">{col.description}</p>}
              <div className="text-xs text-amber-400">{col.product_count} Fits Included</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BrandProfile;
