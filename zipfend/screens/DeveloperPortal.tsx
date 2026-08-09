import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import {
  listDeveloperKeys,
  createDeveloperKey,
  revokeDeveloperKey,
  ApiKeyMetadata,
  ApiKeyCreateResponse
} from '../services/ziprightApi';
import { AppBar, Eyebrow, Skeleton } from '../components/ui';
import { PlaygroundView } from '../components/developer/PlaygroundView';
import { ApiExplorerView } from '../components/developer/ApiExplorerView';
import { RequestHistoryView, RequestHistoryItem } from '../components/developer/RequestHistoryView';
import { DocumentationView } from '../components/developer/DocumentationView';
import { UsageView } from '../components/developer/UsageView';

type ConsoleTab =
  | 'overview'
  | 'keys'
  | 'playground'
  | 'explorer'
  | 'history'
  | 'usage'
  | 'docs'
  | 'webhooks'
  | 'sdks'
  | 'settings';

const DeveloperPortal: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<ConsoleTab>('playground');

  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyEnv, setNewKeyEnv] = useState<'test' | 'live'>('test');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<ApiKeyCreateResponse | null>(null);

  const [requestHistory, setRequestHistory] = useState<RequestHistoryItem[]>([]);

  const fetchKeys = async () => {
    try {
      setLoadingKeys(true);
      const res = await listDeveloperKeys();
      setKeys(res);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to retrieve API keys.', 'error');
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      setIsGenerating(true);
      const res = await createDeveloperKey(newKeyName);
      setNewlyCreatedKey(res);
      setNewKeyName('');
      fetchKeys();
      showToast('API key created.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create API key.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!window.confirm('Are you sure you want to revoke this key? Any application using it will break.')) {
      return;
    }
    try {
      await revokeDeveloperKey(keyId);
      showToast('Key revoked.', 'success');
      fetchKeys();
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke API key.', 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  };

  const handleAddHistory = (item: RequestHistoryItem) => {
    setRequestHistory((prev) => [item, ...prev].slice(0, 50));
  };

  const renderTabs = () => {
    const tabs: { id: ConsoleTab; label: string; badge?: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'keys', label: 'API Keys' },
      { id: 'playground', label: 'Playground' },
      { id: 'explorer', label: 'API Explorer' },
      { id: 'history', label: 'Request History', badge: requestHistory.length ? `${requestHistory.length}` : undefined },
      { id: 'usage', label: 'Usage' },
      { id: 'docs', label: 'Documentation' },
      { id: 'webhooks', label: 'Webhooks', badge: 'Soon' },
      { id: 'sdks', label: 'SDKs' },
      { id: 'settings', label: 'Settings' },
    ];

    return (
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-6 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold uppercase tracking-[0.05em] rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'text-brand border-b-2 border-brand bg-brand/5'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                  tab.badge === 'Soon'
                    ? 'bg-brass/20 text-brass'
                    : 'bg-brand/20 text-brand'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  const renderOverviewTab = () => (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-brand mb-2">key</span>
          <span className="eyebrow !text-[9px]">Active Keys</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">
            {keys.filter((k) => k.status === 'active').length}
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-success mb-2">api</span>
          <span className="eyebrow !text-[9px]">Total Requests</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">
            {requestHistory.length}
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-info mb-2">speed</span>
          <span className="eyebrow !text-[9px]">Avg Latency</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">
            {requestHistory.length > 0
              ? Math.round(
                  requestHistory.reduce((acc, curr) => acc + curr.durationMs, 0) / requestHistory.length
                )
              : 0}{' '}
            <span className="text-[14px]">ms</span>
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-brass mb-2">check_circle</span>
          <span className="eyebrow !text-[9px]">Success Rate</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">100%</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onClick={() => setActiveTab('playground')}
          className="flex flex-col p-6 rounded-card border border-line bg-surface-1 hover:border-brand transition-all cursor-pointer press-soft"
        >
          <span className="material-symbols-outlined text-[32px] text-brand mb-3">sports_esports</span>
          <h4 className="text-[16px] font-bold text-ink">Try-On Playground</h4>
          <p className="text-[13px] text-ink-soft mt-1">
            Test full body virtual try-on with drag &amp; drop photos and live cURL generator.
          </p>
        </div>

        <div
          onClick={() => setActiveTab('explorer')}
          className="flex flex-col p-6 rounded-card border border-line bg-surface-1 hover:border-brand transition-all cursor-pointer press-soft"
        >
          <span className="material-symbols-outlined text-[32px] text-info mb-3">explore</span>
          <h4 className="text-[16px] font-bold text-ink">API Explorer</h4>
          <p className="text-[13px] text-ink-soft mt-1">
            Execute and inspect response payloads for fit profiles, size recommendations, and jobs.
          </p>
        </div>
      </div>
    </div>
  );

  const renderApiKeysTab = () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6">
        <Eyebrow>Generate API Key</Eyebrow>
        <form onSubmit={handleCreateKey} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g., Production Server)"
              className="flex-1 rounded-xl border border-line bg-surface-2 p-3.5 text-[14px] font-medium text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
              maxLength={100}
              required
            />
            <select
              value={newKeyEnv}
              onChange={(e: any) => setNewKeyEnv(e.target.value)}
              className="rounded-xl border border-line bg-surface-2 p-3.5 text-[14px] font-medium text-ink focus:border-brand focus:outline-none"
            >
              <option value="test">zr_test_ (Development)</option>
              <option value="live">zr_live_ (Production)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isGenerating || !newKeyName.trim()}
            className="w-full h-12 rounded-full bg-brand text-on-brand font-semibold text-[15px] hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Create API Key'}
          </button>
        </form>

        {newlyCreatedKey && (
          <div className="mt-6 p-4 rounded-xl border border-success/30 bg-success-soft">
            <h4 className="text-[13px] font-bold text-success uppercase tracking-[0.05em] mb-2">Save this secret key</h4>
            <p className="text-[12px] text-ink-soft mb-3">You will not be able to view the full key again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto no-scrollbar bg-surface-0 border border-line rounded p-2 text-[13px] text-ink font-mono">
                {newlyCreatedKey.raw_key}
              </code>
              <button
                onClick={() => copyToClipboard(newlyCreatedKey.raw_key)}
                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full border border-line bg-surface-0 hover:bg-surface-2 transition-colors"
                aria-label="Copy key"
              >
                <span className="material-symbols-outlined text-[18px]">content_copy</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6">
        <Eyebrow className="mb-4">Active API Keys</Eyebrow>
        {loadingKeys ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[60px] rounded-xl" />
            <Skeleton className="h-[60px] rounded-xl" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-[13px] text-ink-faint text-center py-6">No active API keys found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 p-4">
                <div className="flex flex-col min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-ink truncate">{key.name}</span>
                    <span className={`px-2 py-0.2 rounded text-[9px] font-bold uppercase ${
                      key.environment === 'live' ? 'bg-brand/20 text-brand' : 'bg-info/20 text-info'
                    }`}>
                      {key.environment}
                    </span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-ink-faint mt-1">
                    <code className="font-mono">{key.prefix}</code>
                    <span>•</span>
                    <span>Calls: {key.usage_count}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeKey(key.id)}
                  className="shrink-0 p-2 text-danger hover:bg-danger-soft rounded-full transition-colors"
                  aria-label={`Revoke ${key.name}`}
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderDocumentationTab = () => (
    <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
      <div>
        <Eyebrow className="mb-1">Integration Guide</Eyebrow>
        <h2 className="text-[20px] font-bold text-ink">API Documentation</h2>
        <p className="text-[13px] text-ink-soft mt-1">
          ZipRIGHT REST API v1 documentation and authentication specifications.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-bold text-ink">Authentication</h3>
        <p className="text-[13px] text-ink-soft">
          Authenticate your API requests by including your secret API key in the <code className="bg-surface-2 px-1.5 py-0.5 rounded text-brand">X-API-Key</code> request header, or as a Bearer token in the <code className="bg-surface-2 px-1.5 py-0.5 rounded text-brand">Authorization</code> header.
        </p>
        <div className="p-4 rounded-xl bg-ink/90 text-white font-mono text-[12px]">
          X-API-Key: zr_test_7f8a9b0c...
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-bold text-ink">V1 Endpoints</h3>
        <div className="flex flex-col gap-2">
          {[
            { method: 'POST', path: '/v1/try-on', desc: 'Virtual try-on execution & async job creation' },
            { method: 'POST', path: '/v1/fit-profile', desc: 'Body measurement estimation from front/side photos' },
            { method: 'POST', path: '/v1/size-recommendation', desc: 'Calculate AI size recommendation for garments' },
            { method: 'GET', path: '/v1/jobs/{job_id}', desc: 'Retrieve status and output of async try-on jobs' },
            { method: 'GET', path: '/v1/health', desc: 'Public service uptime probe' },
          ].map((ep) => (
            <div key={ep.path} className="flex items-center justify-between p-3 rounded-xl border border-line bg-surface-2">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-brand text-on-brand">
                  {ep.method}
                </span>
                <code className="text-[13px] font-bold text-ink">{ep.path}</code>
              </div>
              <span className="text-[12px] text-ink-faint hidden sm:inline">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderComingSoonTab = (title: string) => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="material-symbols-outlined text-[48px] text-brand/30 mb-4 font-light">construction</span>
      <h3 className="font-display text-[24px] font-medium text-ink mb-2">{title}</h3>
      <p className="text-[14px] text-ink-soft max-w-[280px]">Feature in active preparation for upcoming release.</p>
    </div>
  );

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col overflow-x-hidden bg-surface-0 text-ink">
      <AppBar title="Developer Console" onBack={() => navigate('/settings')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-4 pb-28">
        <div className="mb-6">
          <h1 className="display-1">
            Developer Console<em className="font-medium text-brand">.</em>
          </h1>
        </div>

        {renderTabs()}

        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'keys' && renderApiKeysTab()}
          {activeTab === 'playground' && (
            <PlaygroundView apiKeys={keys} onAddHistory={handleAddHistory} />
          )}
          {activeTab === 'explorer' && (
            <ApiExplorerView apiKeys={keys} onAddHistory={handleAddHistory} />
          )}
          {activeTab === 'history' && (
            <RequestHistoryView
              history={requestHistory}
              onClearHistory={() => setRequestHistory([])}
            />
          )}
          {activeTab === 'usage' && <UsageView />}
          {activeTab === 'docs' && <DocumentationView apiKeys={keys} />}
          {activeTab === 'webhooks' && renderComingSoonTab('Webhooks')}
          {activeTab === 'sdks' && renderComingSoonTab('Official SDKs')}
          {activeTab === 'settings' && renderApiKeysTab()}
        </div>
      </div>
    </div>
  );
};

export default DeveloperPortal;
