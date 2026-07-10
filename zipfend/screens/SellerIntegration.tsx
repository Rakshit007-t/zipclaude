import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import {
  connectSellerIntegration,
  disconnectSellerIntegration,
  getSellerIntegrationStatus,
  triggerSellerIntegrationSync,
  getSellerIntegrationHistory,
  SellerIntegrationResponse,
  SyncHistoryEvent,
} from '../services/ziprightApi';
import {
  AppBar,
  Button,
  Input,
  Eyebrow,
  SegmentedControl,
  Spinner,
  motion,
} from '../components/ui';

const SellerIntegration: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Fetching integration configurations...');
  const [status, setStatus] = useState<SellerIntegrationResponse | null>(null);
  const [history, setHistory] = useState<SyncHistoryEvent[]>([]);

  // Platform selection state
  const [selectedPlatform, setSelectedPlatform] = useState<'shopify' | 'woocommerce' | 'rest'>('shopify');

  // Input fields state
  const [storeUrl, setStoreUrl] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [wooKey, setWooKey] = useState('');
  const [wooSecret, setWooSecret] = useState('');
  const [restApiKey, setRestApiKey] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadingText('Fetching configurations...');
      const statusRes = await getSellerIntegrationStatus();
      setStatus(statusRes);

      const historyRes = await getSellerIntegrationHistory();
      setHistory(historyRes);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to retrieve integration state.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeUrl.trim()) {
      showToast('Store URL is required.', 'error');
      return;
    }

    let credentials: Record<string, string> = {};
    if (selectedPlatform === 'shopify') {
      if (!shopifyToken.trim()) {
        showToast('Admin API Access Token is required.', 'error');
        return;
      }
      credentials = { access_token: shopifyToken.trim() };
    } else if (selectedPlatform === 'woocommerce') {
      if (!wooKey.trim() || !wooSecret.trim()) {
        showToast('Consumer Key and Secret are required.', 'error');
        return;
      }
      credentials = {
        consumer_key: wooKey.trim(),
        consumer_secret: wooSecret.trim(),
      };
    } else if (selectedPlatform === 'rest') {
      credentials = restApiKey.trim() ? { api_key: restApiKey.trim() } : {};
    }

    try {
      setLoading(true);
      setLoadingText('Establishing secure handshake...');
      const res = await connectSellerIntegration({
        platform: selectedPlatform,
        store_url: storeUrl.trim(),
        credentials,
      });
      setStatus(res);
      showToast(`Successfully connected to ${selectedPlatform} store!`, 'success');

      // Reload logs
      const historyRes = await getSellerIntegrationHistory();
      setHistory(historyRes);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Connection handshake failed. Verify credentials.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect store? E-commerce catalog synchronization will be paused.')) return;
    try {
      setLoading(true);
      setLoadingText('Removing store credentials...');
      await disconnectSellerIntegration();
      setStatus(null);
      setStoreUrl('');
      setShopifyToken('');
      setWooKey('');
      setWooSecret('');
      setRestApiKey('');
      showToast('E-commerce store disconnected.', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Disconnect failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      setLoading(true);
      setLoadingText('Fetching catalog & normalizing size structures...');
      const res = await triggerSellerIntegrationSync();
      showToast(`Sync completed successfully! Processed ${res.synced_count} products.`, 'success');

      // Reload logs and status
      const statusRes = await getSellerIntegrationStatus();
      setStatus(statusRes);
      const historyRes = await getSellerIntegrationHistory();
      setHistory(historyRes);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Catalog sync failed. Check configuration.', 'error');

      // Reload logs
      const historyRes = await getSellerIntegrationHistory();
      setHistory(historyRes);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      return new Date(isoString).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const logTone = (s: string) =>
    s === 'success'
      ? 'bg-success-soft text-success'
      : s === 'failed'
        ? 'bg-danger-soft text-danger'
        : 'bg-warning-soft text-warning';

  return (
    <div className="relative flex h-screen min-h-dvh w-full flex-col overflow-hidden bg-surface-0 text-ink">

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-scrim backdrop-blur-md p-6">
          <div className="flex max-w-sm flex-col items-center rounded-card border border-line bg-surface-1 p-9 text-center shadow-float">
            <Spinner size={40} className="text-brand mb-6" />
            <Eyebrow className="mb-2">Processing</Eyebrow>
            <p className="text-[13px] text-ink-soft leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      <AppBar title="Store Integration" onBack={() => navigate('/seller/dashboard')} />

      {/* Content Scroll */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-8 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex max-w-md flex-col gap-8"
        >

          {/* Editorial opener */}
          <div>
            <Eyebrow className="mb-3">Commerce</Eyebrow>
            <h1 className="font-display text-[34px] font-light leading-[1.05] text-ink">
              Link your <em className="font-medium">catalog.</em>
            </h1>
            <p className="mt-4 max-w-[90%] text-[14px] leading-relaxed text-ink-soft">
              Connect a storefront to sync products and serve sizing on every listing.
            </p>
          </div>

          {/* SANDBOX ENTRY */}
          <div className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface-1 p-5">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-brand">Storefront Sandbox</span>
              <p className="text-[12.5px] leading-snug text-ink-soft">Test sizing & try-on widgets on mock storefronts.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              trailingIcon="launch"
              onClick={() => navigate('/seller/integration/sandbox')}
              className="shrink-0"
            >
              Sandbox
            </Button>
          </div>

          {/* IF ALREADY CONNECTED */}
          {status ? (
            <div className="flex flex-col gap-6">

              {/* STATUS WIDGET */}
              <div className="flex flex-col gap-5 rounded-card border border-line bg-surface-1 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-success-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
                      Connected
                    </span>
                    <h3 className="mt-3 font-display text-[22px] font-medium capitalize leading-tight text-ink">{status.platform} Integration</h3>
                    <p className="mt-1 truncate text-[12.5px] text-ink-faint">{status.store_url}</p>
                  </div>
                  <span className="material-symbols-outlined text-[36px] text-brand" aria-hidden="true">
                    {status.platform === 'rest' ? 'api' : 'storefront'}
                  </span>
                </div>

                <div className="h-px bg-line" aria-hidden="true"></div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Established</span>
                    <span className="text-[13px] font-medium text-ink">{formatTimestamp(status.connected_at)}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Last Sync</span>
                    <span className="text-[13px] font-medium text-ink">{formatTimestamp(status.last_sync_at)}</span>
                  </div>
                </div>

                <div className="mt-1 flex gap-3">
                  <Button variant="primary" icon="sync" onClick={handleSyncNow} className="flex-1">
                    Sync Catalog
                  </Button>
                  <Button variant="secondary" icon="link_off" onClick={handleDisconnect} className="text-danger">
                    Disconnect
                  </Button>
                </div>
              </div>

            </div>
          ) : (

            // CONNECT FORM
            <div className="flex flex-col gap-6 rounded-card border border-line bg-surface-1 p-6">
              <div>
                <h3 className="font-display text-[19px] font-medium text-ink">Link Store Catalog</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">Select your e-commerce platform and input API keys below.</p>
              </div>

              {/* PLATFORM SELECT */}
              <SegmentedControl
                aria-label="E-commerce platform"
                value={selectedPlatform}
                onChange={(v) => { setSelectedPlatform(v); setStoreUrl(''); }}
                options={[
                  { value: 'shopify', label: 'Shopify', icon: 'shopping_bag' },
                  { value: 'woocommerce', label: 'Woo', icon: 'storefront' },
                  { value: 'rest', label: 'REST', icon: 'api' },
                ]}
              />

              <form onSubmit={handleConnect} className="flex flex-col gap-5">

                {/* Store URL / Endpoint */}
                <Input
                  type="url"
                  required
                  label={selectedPlatform === 'rest' ? 'API Endpoint URL' : 'Store Domain URL'}
                  value={storeUrl}
                  onChange={(e) => setStoreUrl(e.target.value)}
                  placeholder={selectedPlatform === 'shopify' ? 'https://my-store.myshopify.com' : selectedPlatform === 'woocommerce' ? 'https://my-woo-site.com' : 'https://api.my-brand.com/products'}
                />

                {/* Shopify Access Token */}
                {selectedPlatform === 'shopify' && (
                  <Input
                    type="password"
                    required
                    label="Admin API Access Token"
                    value={shopifyToken}
                    onChange={(e) => setShopifyToken(e.target.value)}
                    placeholder="shpat_xxxxxxxxxxxxxxxx"
                  />
                )}

                {/* WooCommerce Keys */}
                {selectedPlatform === 'woocommerce' && (
                  <div className="flex flex-col gap-5">
                    <Input
                      type="password"
                      required
                      label="Consumer Key"
                      value={wooKey}
                      onChange={(e) => setWooKey(e.target.value)}
                      placeholder="ck_xxxxxxxxxxxxxxxx"
                    />
                    <Input
                      type="password"
                      required
                      label="Consumer Secret"
                      value={wooSecret}
                      onChange={(e) => setWooSecret(e.target.value)}
                      placeholder="cs_xxxxxxxxxxxxxxxx"
                    />
                  </div>
                )}

                {/* Custom REST Key */}
                {selectedPlatform === 'rest' && (
                  <Input
                    type="password"
                    label="Authorization Bearer Token"
                    hint="Optional"
                    value={restApiKey}
                    onChange={(e) => setRestApiKey(e.target.value)}
                    placeholder="API Access Token/Secret"
                  />
                )}

                <Button type="submit" variant="accent" fullWidth trailingIcon="bolt" className="mt-1">
                  Verify & Connect Store
                </Button>

              </form>

            </div>
          )}

          {/* SYNC HISTORY */}
          <div className="flex flex-col gap-4">
            <Eyebrow>Synchronization Log</Eyebrow>

            {history.length === 0 ? (
              <div className="rounded-card border border-dashed border-line-strong bg-surface-1 py-8 text-center">
                <p className="text-[12.5px] text-ink-faint">No sync logs recorded yet.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface-1 px-6">
                {history.map((log) => (
                  <div key={log.event_id} className="py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium capitalize text-ink">{log.platform} Manual Sync</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${logTone(log.status)}`}>
                        {log.status}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-faint">
                      <span>Synced {log.products_synced_count} items</span>
                      <span>{formatTimestamp(log.started_at)}</span>
                    </div>

                    {log.error_message && (
                      <p className="mt-3 select-all rounded-ctl bg-danger-soft p-3 text-[11.5px] leading-snug text-danger">
                        {log.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </motion.div>
      </div>

    </div>
  );
};

export default SellerIntegration;
