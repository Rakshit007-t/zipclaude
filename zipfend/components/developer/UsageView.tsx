import React, { useState, useEffect } from 'react';
import { getDeveloperAnalytics, UsageAnalyticsResponse } from '../../services/ziprightApi';
import { Eyebrow, Skeleton, CountUp } from '../ui';

export const UsageView: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [data, setData] = useState<UsageAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const res = await getDeveloperAnalytics(timeRange);
      setData(res);
    } catch (err) {
      console.error('Failed to load usage analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const calculateSuccessRate = () => {
    if (!data || data.total_requests === 0) return '100.0%';
    const rate = (data.successful_requests / data.total_requests) * 100;
    return `${rate.toFixed(1)}%`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Time Range Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-line bg-surface-1 p-6">
        <div>
          <Eyebrow className="mb-1">Telemetry &amp; Usage Metrics</Eyebrow>
          <h2 className="text-[20px] font-bold text-ink">API Usage Analytics</h2>
          <p className="text-[13px] text-ink-soft mt-1">
            Real-time request volume, latency distributions, GPU compute time, and credit consumption.
          </p>
        </div>

        {/* Time Selector */}
        <div className="flex gap-1.5 p-1 rounded-xl bg-surface-2 border border-line shrink-0">
          {(
            [
              { id: '24h', label: 'Last 24h' },
              { id: '7d', label: 'Last 7d' },
              { id: '30d', label: 'Last 30d' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTimeRange(t.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                timeRange === t.id
                  ? 'bg-brand text-on-brand shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Skeleton className="h-[120px] rounded-card" />
          <Skeleton className="h-[120px] rounded-card" />
          <Skeleton className="h-[120px] rounded-card" />
          <Skeleton className="h-[120px] rounded-card" />
        </div>
      ) : (
        <>
          {/* Main KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-brand mb-2">api</span>
              <span className="eyebrow !text-[9px]">Total Requests</span>
              <h3 className="font-display text-[30px] font-light text-ink mt-1">
                <CountUp value={data?.total_requests ?? 0} />
              </h3>
            </div>

            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-success mb-2">check_circle</span>
              <span className="eyebrow !text-[9px]">Success Rate</span>
              <h3 className="font-display text-[30px] font-light text-success mt-1">
                {calculateSuccessRate()}
              </h3>
            </div>

            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-info mb-2">speed</span>
              <span className="eyebrow !text-[9px]">Avg Latency</span>
              <h3 className="font-display text-[30px] font-light text-ink mt-1">
                <CountUp value={data?.avg_latency_ms ?? 0} /> <span className="text-[14px] font-medium text-ink-faint">ms</span>
              </h3>
            </div>

            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-brass mb-2">bolt</span>
              <span className="eyebrow !text-[9px]">P95 Latency</span>
              <h3 className="font-display text-[30px] font-light text-ink mt-1">
                <CountUp value={data?.p95_latency_ms ?? 0} /> <span className="text-[14px] font-medium text-ink-faint">ms</span>
              </h3>
            </div>
          </div>

          {/* Secondary Compute & Credits Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-brand mb-2">memory</span>
              <span className="eyebrow !text-[9px]">GPU Compute Time</span>
              <h3 className="font-display text-[26px] font-light text-ink mt-1">
                {data?.gpu_time_seconds ?? 0} <span className="text-[14px] font-medium text-ink-faint">sec</span>
              </h3>
            </div>

            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-brass mb-2">stars</span>
              <span className="eyebrow !text-[9px]">Credits Consumed</span>
              <h3 className="font-display text-[26px] font-light text-ink mt-1">
                <CountUp value={data?.credits_used ?? 0} />
              </h3>
            </div>

            <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
              <span className="material-symbols-outlined text-[24px] text-danger mb-2">error</span>
              <span className="eyebrow !text-[9px]">Failed Requests</span>
              <h3 className="font-display text-[26px] font-light text-ink mt-1">
                <CountUp value={data?.failed_requests ?? 0} />
              </h3>
            </div>
          </div>

          {/* Top Endpoints Breakdown */}
          <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
            <Eyebrow>Top Endpoints Usage</Eyebrow>
            {data?.top_endpoints && data.top_endpoints.length > 0 ? (
              <div className="flex flex-col gap-3">
                {data.top_endpoints.map((ep) => {
                  const percentage = data.total_requests > 0 ? Math.round((ep.count / data.total_requests) * 100) : 0;
                  return (
                    <div key={ep.endpoint} className="flex flex-col gap-1.5 p-3 rounded-xl border border-line bg-surface-2">
                      <div className="flex items-center justify-between text-[13px]">
                        <code className="font-bold text-ink font-mono">{ep.endpoint}</code>
                        <span className="text-ink-soft font-medium">{ep.count} requests ({percentage}%)</span>
                      </div>
                      <div className="h-2 w-full bg-surface-0 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(5, percentage)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-ink-faint text-center py-6">No API traffic recorded in this time window.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
