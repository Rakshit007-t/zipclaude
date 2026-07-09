import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { getSellerDashboard, SellerDashboardResponse } from '../services/ziprightApi';
import { CountUp, Skeleton, StaggerList, StaggerItem } from '../components/ui';

const SellerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SellerDashboardResponse | null>(null);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const res = await getSellerDashboard();
      setData(res);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to retrieve dashboard analytics.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Header Banner */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button
          onClick={() => navigate('/settings')}
          aria-label="Back to settings"
          className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">Seller Hub Dashboard</h2>
        <button
          onClick={fetchDashboard}
          aria-label="Refresh dashboard"
          aria-busy={loading}
          className="flex items-center justify-center h-10 w-10 -mr-2 bg-[#6157FF]/10 dark:bg-[#6157FF]/10 text-[#6157FF] dark:text-[#6157FF] rounded-full active:scale-95 transition-transform"
        >
          <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
        </button>
      </div>

      {/* Main Grid Scroll */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-24">
        {loading && !data ? (
          /* Skeleton dashboard — content-shaped, no blocking overlay */
          <div className="max-w-md mx-auto flex flex-col gap-6" role="status" aria-label="Loading dashboard">
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[118px] rounded-[2rem]" />
              ))}
            </div>
            <Skeleton className="h-[180px] rounded-[2rem]" />
            <Skeleton className="h-[160px] rounded-[2rem]" />
          </div>
        ) : (
        <StaggerList className="max-w-md mx-auto flex flex-col gap-6" delay={0.06}>

          {/* SECTION 1: BUSINESS KPIs */}
          <StaggerItem>
          <div className="grid grid-cols-2 gap-4">

            {/* Tryons Count */}
            <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-5 flex flex-col gap-1 shadow-sm">
              <span className="material-symbols-outlined text-2xl text-[#6157FF]" aria-hidden="true">view_in_ar</span>
              <span className="text-[12px] font-bold text-gray-400 mt-1">Total Try-Ons</span>
              <h3 className="text-2xl font-bold mt-1"><CountUp value={data?.total_tryons ?? 0} /></h3>
            </div>

            {/* Recommendations Count */}
            <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-5 flex flex-col gap-1 shadow-sm">
              <span className="material-symbols-outlined text-2xl text-[#6157FF]" aria-hidden="true">check_circle</span>
              <span className="text-[12px] font-bold text-gray-400 mt-1">Size Recs</span>
              <h3 className="text-2xl font-bold mt-1"><CountUp value={data?.total_recs ?? 0} /></h3>
            </div>

            {/* Products Counter */}
            <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-5 flex flex-col gap-1 shadow-sm">
              <span className="material-symbols-outlined text-2xl text-green-500" aria-hidden="true">inventory_2</span>
              <span className="text-[12px] font-bold text-gray-400 mt-1">Active Products</span>
              <h3 className="text-2xl font-bold mt-1"><CountUp value={data?.active_products ?? 0} /> <span className="text-xs font-bold text-gray-400">/ {data?.total_products ?? 0}</span></h3>
            </div>

            {/* Customer Feedback Counter */}
            <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-5 flex flex-col gap-1 shadow-sm">
              <span className="material-symbols-outlined text-2xl text-blue-500" aria-hidden="true">rate_review</span>
              <span className="text-[12px] font-bold text-gray-400 mt-1">Customer Reviews</span>
              <h3 className="text-2xl font-bold mt-1"><CountUp value={data?.feedback_count ?? 0} /></h3>
            </div>

          </div>
          </StaggerItem>

          {/* SECTION 2: QUICK ACTIONS */}
          <StaggerItem>
          <div className="flex flex-col bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm gap-4">
            <h3 className="text-xs font-bold text-gray-400">Quick Actions</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate('/seller/add-product')}
                className="h-14 bg-black/5 dark:bg-surface-2 rounded-2xl flex items-center justify-center gap-2 font-bold text-xs active:scale-95 transition-all text-[#6157FF]"
              >
                <span className="material-symbols-outlined text-sm">cloud_upload</span>
                Import Product
              </button>
              
              <button
                onClick={() => navigate('/seller/catalog')}
                className="h-14 bg-black/5 dark:bg-surface-2 rounded-2xl flex items-center justify-center gap-2 font-bold text-xs active:scale-95 transition-all text-green-500"
              >
                <span className="material-symbols-outlined text-sm">list_alt</span>
                View Catalog
              </button>
              
              <button
                onClick={() => navigate('/seller/integration')}
                className="h-14 bg-black/5 dark:bg-surface-2 rounded-2xl flex items-center justify-center gap-2 font-bold text-xs active:scale-95 transition-all text-purple-500"
              >
                <span className="material-symbols-outlined text-sm">sync</span>
                Integrate Store
              </button>
              
              <button
                onClick={() => navigate('/settings')}
                className="h-14 bg-black/5 dark:bg-surface-2 rounded-2xl flex items-center justify-center gap-2 font-bold text-xs active:scale-95 transition-all text-blue-500"
              >
                <span className="material-symbols-outlined text-sm">manage_accounts</span>
                Edit Profile
              </button>
            </div>
          </div>
          </StaggerItem>

          {/* SECTION 3: MVP ANALYTICS (POPULAR PRODUCTS) */}
          <StaggerItem>
          <div className="flex flex-col bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm gap-4">
            <h3 className="text-xs font-bold text-gray-400">Popular Products & Sizing</h3>
            
            {data?.popular_products && data.popular_products.length > 0 ? (
              <div className="flex flex-col gap-4">
                {data.popular_products.map((p) => (
                  <div 
                    key={p.id}
                    onClick={() => navigate(`/seller/edit-product/${p.id}`)}
                    className="flex justify-between items-center bg-[#FAF9F6] dark:bg-surface-0 p-4 rounded-2xl border border-black/5 dark:border-line cursor-pointer hover:border-[#6157FF] transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <h4 className="text-sm font-bold truncate leading-tight">{p.title}</h4>
                      <div className="flex gap-3 text-[12px] text-gray-400 font-bold mt-1">
                        <span>Try-ons: {p.tryon_count}</span>
                        <span>Recs: {p.recommendation_count}</span>
                      </div>
                    </div>
                    
                    <div className="text-right shrink-0">
                      {p.accuracy !== null ? (
                        <span className="text-[12px] font-bold bg-green-500/10 text-green-600 px-2 py-1 rounded-full">
                          {Math.round(p.accuracy)}% kept
                        </span>
                      ) : (
                        <span className="text-[12px] font-bold text-gray-400">No outcomes</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 font-medium text-center py-4">No product engagement recorded yet.</p>
            )}
          </div>
          </StaggerItem>

          {/* SECTION 4: ACTIVITY FEED */}
          <StaggerItem>
          <div className="flex flex-col bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm gap-4">
            <h3 className="text-xs font-bold text-gray-400">Recent Activity Feed</h3>
            
            {data?.recent_activity && data.recent_activity.length > 0 ? (
              <div className="flex flex-col gap-3">
                {data.recent_activity.map((ev) => {
                  const getIcon = () => {
                    if (ev.type === 'product_created') return 'add_circle';
                    if (ev.type === 'product_edited') return 'edit';
                    if (ev.type === 'product_archived') return 'archive';
                    return 'rate_review';
                  };
                  const getColorClass = () => {
                    if (ev.type === 'product_created') return 'text-green-500';
                    if (ev.type === 'product_edited') return 'text-blue-500';
                    if (ev.type === 'product_archived') return 'text-gray-400';
                    return 'text-[#6157FF]';
                  };

                  return (
                    <div key={ev.id} className="flex gap-3 items-start border-b border-black/5 dark:border-line pb-3 last:border-b-0 last:pb-0">
                      <span className={`material-symbols-outlined text-[20px] ${getColorClass()}`}>{getIcon()}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 dark:text-gray-300 font-bold leading-tight">{ev.text}</p>
                        <span className="text-[11px] text-gray-400 font-medium mt-1 block">{formatTimestamp(ev.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 font-medium text-center py-4">No events in log feed.</p>
            )}
          </div>
          </StaggerItem>

        </StaggerList>
        )}
      </div>

    </div>
  );
};

export default SellerDashboard;
