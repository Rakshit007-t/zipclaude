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

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-[1000] flex flex-col items-center justify-center p-6">
          <div className="bg-white dark:bg-surface-1 p-8 rounded-[2.5rem] border border-black/5 dark:border-line flex flex-col items-center max-w-sm text-center shadow-2xl">
            <div className="h-16 w-16 border-4 border-[#6157FF] dark:border-[#6157FF] border-t-transparent rounded-full animate-spin mb-6"></div>
            <h3 className="text-lg font-bold mb-2">Processing</h3>
            <p className="text-xs text-[#555555] dark:text-ink-soft font-medium leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button 
          onClick={() => navigate('/seller/dashboard')} 
          aria-label="Go back" className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">Store Integration</h2>
        <div className="w-8"></div>
      </div>

      {/* Form Content Scroll */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-24">
        <div className="max-w-md mx-auto flex flex-col gap-6">

          {/* SANDBOX ENTRY WIDGET */}
          <div className="bg-[#6157FF]/5 border border-[#6157FF]/20 rounded-3xl p-5 flex justify-between items-center shadow-sm">
            <div className="flex flex-col gap-0.5">
              <h4 className="text-xs font-bold text-[#6157FF]">Storefront Sandbox</h4>
              <p className="text-[12px] text-gray-400 font-medium">Test sizing & try-on widgets on mock storefronts.</p>
            </div>
            <button
              onClick={() => navigate('/seller/integration/sandbox')}
              className="h-9 px-4 bg-[#6157FF] dark:bg-[#6157FF] text-ink font-bold text-[12px] rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-xs">launch</span>
              Open Sandbox
            </button>
          </div>

          {/* IF ALREADY CONNECTED */}
          {status ? (
            <div className="flex flex-col gap-6">
              
              {/* STATUS WIDGET */}
              <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[12px] font-bold bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full">Connected</span>
                    <h3 className="text-xl font-bold mt-2 capitalize">{status.platform} Integration</h3>
                    <p className="text-xs text-gray-400 font-bold truncate mt-1">{status.store_url}</p>
                  </div>
                  
                  <span className="material-symbols-outlined text-4xl text-[#6157FF]">
                    {status.platform === 'rest' ? 'api' : 'storefront'}
                  </span>
                </div>

                <div className="h-[1px] bg-black/5 dark:bg-surface-2 my-2"></div>

                <div className="grid grid-cols-2 gap-4 text-xs font-bold">
                  <div>
                    <span className="text-[12px] text-gray-400 block mb-1">Established</span>
                    <span>{formatTimestamp(status.connected_at)}</span>
                  </div>
                  <div>
                    <span className="text-[12px] text-gray-400 block mb-1">Last Sync</span>
                    <span>{formatTimestamp(status.last_sync_at)}</span>
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleSyncNow}
                    className="flex-1 h-12 bg-[#6157FF] dark:bg-[#6157FF] text-ink rounded-xl font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">sync</span>
                    Sync Catalog
                  </button>
                  
                  <button
                    onClick={handleDisconnect}
                    className="h-12 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl px-4 font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">link_off</span>
                    Disconnect
                  </button>
                </div>

              </div>

            </div>
          ) : (
            
            // CONNECT FORM
            <div className="bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm flex flex-col gap-6">
              <div>
                <h3 className="text-base font-bold">Link Store Catalog</h3>
                <p className="text-xs text-gray-400 font-medium mt-1">Select your e-commerce platform and input API keys below.</p>
              </div>

              {/* PLATFORM BUTTONS */}
              <div className="grid grid-cols-3 gap-2">
                {(['shopify', 'woocommerce', 'rest'] as const).map((plat) => (
                  <button
                    key={plat}
                    onClick={() => { setSelectedPlatform(plat); setStoreUrl(''); }}
                    className={`h-16 rounded-xl flex flex-col items-center justify-center gap-1 border transition-all ${selectedPlatform === plat ? 'border-[#6157FF] bg-[#6157FF]/5 font-bold text-[#6157FF]' : 'border-black/5 dark:border-line font-bold text-gray-400'}`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {plat === 'shopify' ? 'shopping_bag' : plat === 'woocommerce' ? 'storefront' : 'api'}
                    </span>
                    <span className="text-[11px] capitalize">{plat}</span>
                  </button>
                ))}
              </div>

              <form onSubmit={handleConnect} className="flex flex-col gap-4">
                
                {/* Store URL / Endpoint */}
                <div>
                  <label className="text-xs font-bold text-gray-400 tracking-wide block mb-2">
                    {selectedPlatform === 'rest' ? 'API Endpoint URL' : 'Store Domain URL'} *
                  </label>
                  <input
                    type="url"
                    value={storeUrl}
                    onChange={(e) => setStoreUrl(e.target.value)}
                    placeholder={selectedPlatform === 'shopify' ? 'https://my-store.myshopify.com' : selectedPlatform === 'woocommerce' ? 'https://my-woo-site.com' : 'https://api.my-brand.com/products'}
                    className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-4 font-bold text-xs text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF]"
                    required
                  />
                </div>

                {/* Shopify Access Token */}
                {selectedPlatform === 'shopify' && (
                  <div>
                    <label className="text-xs font-bold text-gray-400 tracking-wide block mb-2">Admin API Access Token *</label>
                    <input
                      type="password"
                      value={shopifyToken}
                      onChange={(e) => setShopifyToken(e.target.value)}
                      placeholder="shpat_xxxxxxxxxxxxxxxx"
                      className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-4 font-bold text-xs text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF]"
                      required
                    />
                  </div>
                )}

                {/* WooCommerce Keys */}
                {selectedPlatform === 'woocommerce' && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="text-xs font-bold text-gray-400 tracking-wide block mb-2">Consumer Key *</label>
                      <input
                        type="password"
                        value={wooKey}
                        onChange={(e) => setWooKey(e.target.value)}
                        placeholder="ck_xxxxxxxxxxxxxxxx"
                        className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-4 font-bold text-xs text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF]"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-400 tracking-wide block mb-2">Consumer Secret *</label>
                      <input
                        type="password"
                        value={wooSecret}
                        onChange={(e) => setWooSecret(e.target.value)}
                        placeholder="cs_xxxxxxxxxxxxxxxx"
                        className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-4 font-bold text-xs text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF]"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* Custom REST Key */}
                {selectedPlatform === 'rest' && (
                  <div>
                    <label className="text-xs font-bold text-gray-400 tracking-wide block mb-2">Authorization Bearer Token (Optional)</label>
                    <input
                      type="password"
                      value={restApiKey}
                      onChange={(e) => setRestApiKey(e.target.value)}
                      placeholder="API Access Token/Secret"
                      className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-4 font-bold text-xs text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF]"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="h-12 bg-[#6157FF] dark:bg-[#6157FF] text-ink rounded-xl font-bold text-xs active:scale-95 transition-all mt-2"
                >
                  Verify & Connect Store
                </button>

              </form>

            </div>
          )}

          {/* SECTION: HISTORY AUDIT LOGS */}
          <div className="flex flex-col bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2rem] p-6 shadow-sm gap-4">
            <h3 className="text-xs font-bold text-gray-400">Synchronization Log History</h3>
            
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 font-medium text-center py-4">No sync logs recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {history.map((log) => (
                  <div key={log.event_id} className="border-b border-black/5 dark:border-line pb-3 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="capitalize">{log.platform} Manual Sync</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${log.status === 'success' ? 'bg-green-500/10 text-green-600' : log.status === 'failed' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-600'}`}>
                        {log.status}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[12px] text-gray-400 font-bold mt-1.5">
                      <span>Synced: {log.products_synced_count} items</span>
                      <span>{formatTimestamp(log.started_at)}</span>
                    </div>

                    {log.error_message && (
                      <p className="text-[12px] text-red-400 font-medium bg-red-500/5 p-2 rounded-xl mt-2 select-all leading-tight">
                        {log.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

export default SellerIntegration;
