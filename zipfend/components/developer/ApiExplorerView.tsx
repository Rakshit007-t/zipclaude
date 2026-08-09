import React, { useState } from 'react';
import { getBackendBaseUrl, ApiKeyMetadata } from '../../services/ziprightApi';
import { Eyebrow } from '../ui';
import { CodeGenerator } from './CodeGenerator';

interface RequestHistoryItem {
  id: string;
  timestamp: string;
  endpoint: string;
  status: number;
  durationMs: number;
  requestId: string;
  payload: any;
  response: any;
}

interface ApiExplorerViewProps {
  apiKeys: ApiKeyMetadata[];
  onAddHistory: (item: RequestHistoryItem) => void;
}

const ENDPOINTS = [
  {
    id: 'try-on',
    method: 'POST',
    path: '/v1/try-on',
    title: 'Virtual Try-On',
    defaultPayload: {
      garment_image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
      person_image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500',
      cloth_type: 'auto',
      quality: 'hd',
      async_job: false,
    },
  },
  {
    id: 'fit-profile',
    method: 'POST',
    path: '/v1/fit-profile',
    title: 'Precision Fit Profile',
    defaultPayload: {
      height: 175.0,
      front_image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
      side_image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    },
  },
  {
    id: 'size-recommendation',
    method: 'POST',
    path: '/v1/size-recommendation',
    title: 'AI Size Recommendation',
    defaultPayload: {
      height: 178.0,
      fit_preference: 'regular',
      base_size: 'M',
      product: {
        id: 'prod_123',
        title: 'Classic Cotton Shirt',
        brand: 'ZipRIGHT Studio',
        category: 'shirts',
        url: 'https://example.com/shirt',
      },
    },
  },
  {
    id: 'jobs',
    method: 'GET',
    path: '/v1/jobs/job_demo_123',
    title: 'Get Async Job Status',
    defaultPayload: null,
  },
  {
    id: 'health',
    method: 'GET',
    path: '/v1/health',
    title: 'Public API Health',
    defaultPayload: null,
  },
] as const;

export const ApiExplorerView: React.FC<ApiExplorerViewProps> = ({
  apiKeys,
  onAddHistory,
}) => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<typeof ENDPOINTS[number]>(ENDPOINTS[0]);
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(ENDPOINTS[0].defaultPayload, null, 2)
  );

  const [selectedApiKey, setSelectedApiKey] = useState<string>(
    apiKeys.length > 0 ? apiKeys[0].prefix : ''
  );

  const [isLoading, setIsLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [responseJson, setResponseJson] = useState<any | null>(null);

  const handleSelectEndpoint = (endpoint: typeof ENDPOINTS[number]) => {
    setSelectedEndpoint(endpoint);
    setPayloadText(endpoint.defaultPayload ? JSON.stringify(endpoint.defaultPayload, null, 2) : '');
    setResponseJson(null);
    setResponseStatus(null);
  };

  const handleSendRequest = async () => {
    setIsLoading(true);
    setResponseJson(null);
    setResponseStatus(null);

    const startTime = performance.now();
    const endpointUrl = `${getBackendBaseUrl()}${selectedEndpoint.path}`;

    let parsedPayload: any = null;
    if (selectedEndpoint.method === 'POST') {
      try {
        parsedPayload = JSON.parse(payloadText);
      } catch (err) {
        alert('Invalid JSON in request payload');
        setIsLoading(false);
        return;
      }
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (selectedEndpoint.path !== '/v1/health') {
        headers['X-API-Key'] = selectedApiKey || 'zr_test_demo';
      }

      const options: RequestInit = {
        method: selectedEndpoint.method,
        headers,
      };

      if (selectedEndpoint.method === 'POST' && parsedPayload) {
        options.body = JSON.stringify(parsedPayload);
      }

      const response = await fetch(endpointUrl, options);
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

      setLatencyMs(duration);
      setResponseStatus(response.status);

      const reqId = response.headers.get('X-Request-Id') || `req_${Math.random().toString(36).substring(2, 9)}`;
      setRequestId(reqId);

      const data = await response.json();
      setResponseJson(data);

      onAddHistory({
        id: `hist_${Date.now()}`,
        timestamp: new Date().toISOString(),
        endpoint: selectedEndpoint.path,
        status: response.status,
        durationMs: duration,
        requestId: reqId,
        payload: parsedPayload,
        response: data,
      });

    } catch (err: any) {
      console.error(err);
      setResponseJson({ error: err.message || 'Network error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <div>
          <Eyebrow className="mb-1">API Testing Suite</Eyebrow>
          <h2 className="text-[20px] font-bold text-ink">API Explorer</h2>
          <p className="text-[13px] text-ink-soft mt-1">
            Test and inspect all ZipRIGHT REST endpoints directly from your browser.
          </p>
        </div>

        {/* Endpoint selection pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pt-2">
          {ENDPOINTS.map((ep) => (
            <button
              key={ep.id}
              onClick={() => handleSelectEndpoint(ep)}
              className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-bold border transition-colors ${
                selectedEndpoint.id === ep.id
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line bg-surface-2 text-ink-soft hover:text-ink'
              }`}
            >
              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                ep.method === 'POST' ? 'bg-brand/20 text-brand' : 'bg-info/20 text-info'
              }`}>
                {ep.method}
              </span>
              <span>{ep.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor & Execution Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Request Configuration */}
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-bold text-ink flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] bg-brand text-on-brand uppercase font-bold">
                {selectedEndpoint.method}
              </span>
              <code className="text-[13px] text-brand">{selectedEndpoint.path}</code>
            </span>
          </div>

          {selectedEndpoint.method === 'POST' && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1.5 block">
                JSON Request Body
              </label>
              <textarea
                rows={10}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="w-full rounded-2xl border border-line bg-ink/90 text-white font-mono text-[12px] p-4 focus:border-brand focus:outline-none"
              />
            </div>
          )}

          <button
            onClick={handleSendRequest}
            disabled={isLoading}
            className="w-full h-12 rounded-full bg-brand text-on-brand font-semibold text-[14px] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                <span>Executing API Request...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">send</span>
                <span>Send Request</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Response Inspection */}
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <span className="text-[14px] font-bold text-ink">Response</span>
            {responseStatus !== null && (
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  responseStatus >= 200 && responseStatus < 300
                    ? 'bg-success-soft text-success'
                    : 'bg-danger-soft text-danger'
                }`}>
                  HTTP {responseStatus}
                </span>
                {latencyMs !== null && (
                  <span className="text-[11px] text-ink-faint">{latencyMs} ms</span>
                )}
              </div>
            )}
          </div>

          {responseJson ? (
            <pre className="p-4 rounded-2xl bg-ink/90 text-white font-mono text-[12px] overflow-x-auto max-h-[350px]">
              {JSON.stringify(responseJson, null, 2)}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-ink-faint">
              <span className="material-symbols-outlined text-[36px] mb-2 opacity-50">output</span>
              <p className="text-[13px]">Send a request to view the response payload.</p>
            </div>
          )}
        </div>
      </div>

      {/* Code Snippets for current endpoint */}
      {selectedEndpoint.method === 'POST' && (
        <CodeGenerator
          apiKey={selectedApiKey || 'zr_test_YOUR_API_KEY'}
          endpointUrl={`${getBackendBaseUrl()}${selectedEndpoint.path}`}
          payload={(() => {
            try {
              return JSON.parse(payloadText);
            } catch {
              return selectedEndpoint.defaultPayload;
            }
          })()}
        />
      )}
    </div>
  );
};
