import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { getSellerDashboard, SellerDashboardResponse } from '../services/ziprightApi';
import { CountUp, Skeleton, StaggerList, StaggerItem, AppBar, Eyebrow } from '../components/ui';

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

  const metrics = [
    { icon: 'view_in_ar', tone: 'text-brand', label: 'Total try-ons', value: data?.total_tryons ?? 0 },
    { icon: 'check_circle', tone: 'text-ink', label: 'Size recs', value: data?.total_recs ?? 0 },
    { icon: 'inventory_2', tone: 'text-success', label: 'Active products', value: data?.active_products ?? 0, suffix: `/ ${data?.total_products ?? 0}` },
    { icon: 'rate_review', tone: 'text-info', label: 'Customer reviews', value: data?.feedback_count ?? 0 },
  ] as const;

  const quickActions = [
    { icon: 'cloud_upload', label: 'Import product', tone: 'text-brand', to: '/seller/add-product' },
    { icon: 'list_alt', label: 'View catalog', tone: 'text-success', to: '/seller/catalog' },
    { icon: 'sync', label: 'Integrate store', tone: 'text-info', to: '/seller/integration' },
    { icon: 'manage_accounts', label: 'Edit profile', tone: 'text-ink-soft', to: '/settings' },
  ] as const;

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col overflow-x-hidden bg-surface-0 text-ink">

      <AppBar
        title="Seller Hub"
        onBack={() => navigate('/settings')}
        trailing={
          <button
            onClick={fetchDashboard}
            aria-label="Refresh dashboard"
            aria-busy={loading}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:text-ink press-icon"
          >
            <span className={`material-symbols-outlined text-[22px] ${loading ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
          </button>
        }
      />

      {/* Scroll region */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-6 pb-28">
        {/* Editorial masthead */}
        <div className="mb-8">
          <Eyebrow className="mb-3">Your storefront</Eyebrow>
          <h1 className="display-1">
            The numbers<em className="font-medium">.</em>
          </h1>
        </div>

        {loading && !data ? (
          /* Skeleton dashboard — content-shaped, no blocking overlay */
          <div className="flex flex-col gap-6" role="status" aria-label="Loading dashboard">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[118px] rounded-card" />
              ))}
            </div>
            <Skeleton className="h-[180px] rounded-card" />
            <Skeleton className="h-[160px] rounded-card" />
          </div>
        ) : (
        <StaggerList className="flex flex-col gap-6" delay={0.06}>

          {/* SECTION 1: BUSINESS KPIs */}
          <StaggerItem>
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
                <span className={`material-symbols-outlined text-[22px] ${m.tone}`} aria-hidden="true">{m.icon}</span>
                <span className="eyebrow !text-[9px] mt-4">{m.label}</span>
                <h3 className="font-display text-[30px] font-light text-ink leading-none mt-2">
                  <CountUp value={m.value} />
                  {'suffix' in m && m.suffix && (
                    <span className="text-[14px] font-medium text-ink-faint ml-1">{m.suffix}</span>
                  )}
                </h3>
              </div>
            ))}
          </div>
          </StaggerItem>

          {/* SECTION 2: QUICK ACTIONS */}
          <StaggerItem>
          <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
            <Eyebrow>Quick actions</Eyebrow>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.to)}
                  className="flex h-16 flex-col items-start justify-center gap-1.5 rounded-2xl border border-line bg-surface-2 px-4 text-left press-soft transition-[transform,border-color] hover:border-line-strong"
                >
                  <span className={`material-symbols-outlined text-[19px] ${a.tone}`} aria-hidden="true">{a.icon}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
          </StaggerItem>

          {/* SECTION 3: POPULAR PRODUCTS */}
          <StaggerItem>
          <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
            <Eyebrow>Popular products &amp; sizing</Eyebrow>

            {data?.popular_products && data.popular_products.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {data.popular_products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/seller/edit-product/${p.id}`)}
                    aria-label={`Edit ${p.title}`}
                    className="w-full text-left flex items-center justify-between rounded-2xl border border-line bg-surface-2 p-4 hover:border-brand press-soft transition-[transform,border-color]"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <h4 className="text-[14px] font-semibold text-ink truncate leading-tight">{p.title}</h4>
                      <div className="mt-1.5 flex gap-4 text-[11px] font-medium text-ink-faint">
                        <span>Try-ons {p.tryon_count}</span>
                        <span>Recs {p.recommendation_count}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {p.accuracy !== null ? (
                        <span className="rounded-full bg-success-soft px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-success">
                          {Math.round(p.accuracy)}% kept
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-ink-faint">No outcomes</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-[12px] font-medium text-ink-faint">No product engagement recorded yet.</p>
            )}
          </div>
          </StaggerItem>

          {/* SECTION 4: ACTIVITY FEED */}
          <StaggerItem>
          <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
            <Eyebrow>Recent activity</Eyebrow>

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
                    if (ev.type === 'product_created') return 'text-success';
                    if (ev.type === 'product_edited') return 'text-info';
                    if (ev.type === 'product_archived') return 'text-ink-faint';
                    return 'text-brand';
                  };

                  return (
                    <div key={ev.id} className="flex items-start gap-3.5 border-b border-line pb-3 last:border-b-0 last:pb-0">
                      <span className={`material-symbols-outlined text-[20px] ${getColorClass()}`} aria-hidden="true">{getIcon()}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink-soft leading-snug">{ev.text}</p>
                        <span className="mt-1 block text-[11px] font-medium text-ink-faint">{formatTimestamp(ev.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-[12px] font-medium text-ink-faint">No events in log feed.</p>
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
