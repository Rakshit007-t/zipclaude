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

interface PlaygroundViewProps {
  apiKeys: ApiKeyMetadata[];
  onAddHistory: (item: RequestHistoryItem) => void;
}

const SAMPLE_PERSONS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&auto=format&fit=crop',
];

const SAMPLE_GARMENTS = [
  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=500&auto=format&fit=crop',
];

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  apiKeys,
  onAddHistory,
}) => {
  const [selectedApiKey, setSelectedApiKey] = useState<string>(
    apiKeys.length > 0 ? apiKeys[0].prefix : ''
  );
  const [customApiKey, setCustomApiKey] = useState<string>('');

  const [personImage, setPersonImage] = useState<string>(SAMPLE_PERSONS[0]);
  const [garmentImage, setGarmentImage] = useState<string>(SAMPLE_GARMENTS[0]);
  const [clothType, setClothType] = useState<'auto' | 'upper_body' | 'lower_body' | 'dress'>('auto');
  const [quality, setQuality] = useState<'fast' | 'hd' | '2k'>('hd');
  const [asyncJob, setAsyncJob] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [processingTimeMs, setProcessingTimeMs] = useState<number | null>(null);
  const [responseJson, setResponseJson] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<'preview' | 'json_req' | 'json_res' | 'code'>('preview');

  const activeKeyHeader = customApiKey.trim() || selectedApiKey;

  const handleFileUpload = (
    file: File,
    setter: (val: string) => void
  ) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setter(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const getPayload = () => ({
    person_image: personImage,
    garment_image: garmentImage,
    cloth_type: clothType,
    quality: quality,
    async_job: asyncJob,
  });

  const handleRunTryOn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setResultImage(null);
    setResponseStatus(null);

    const startTime = performance.now();
    const endpointUrl = `${getBackendBaseUrl()}/v1/try-on`;
    const payload = getPayload();

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': activeKeyHeader || 'zr_test_demo',
        },
        body: JSON.stringify(payload),
      });

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      setProcessingTimeMs(duration);

      const status = response.status;
      setResponseStatus(status);

      const reqId = response.headers.get('X-Request-Id') || `req_${Math.random().toString(36).substring(2, 9)}`;
      setRequestId(reqId);

      const data = await response.json();
      setResponseJson(data);

      if (response.ok && data?.data?.tryon_image) {
        setResultImage(data.data.tryon_image);
      } else if (!response.ok) {
        setErrorMsg(data?.message || 'API Request Failed');
      }

      onAddHistory({
        id: `hist_${Date.now()}`,
        timestamp: new Date().toISOString(),
        endpoint: '/v1/try-on',
        status: status,
        durationMs: duration,
        requestId: reqId,
        payload: payload,
        response: data,
      });

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Network or connection failure.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header & Description */}
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <div>
          <Eyebrow className="mb-1">Interactive API Sandbox</Eyebrow>
          <h2 className="text-[20px] font-bold text-ink">Virtual Try-On Playground</h2>
          <p className="text-[13px] text-ink-soft mt-1">
            Test the live <code className="bg-surface-2 px-1.5 py-0.5 rounded text-brand">POST /v1/try-on</code> REST endpoint in real-time.
          </p>
        </div>

        {/* API Key selector */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <div className="flex-1 min-w-0">
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Authentication Key
            </label>
            {apiKeys.length > 0 ? (
              <select
                value={selectedApiKey}
                onChange={(e) => {
                  setSelectedApiKey(e.target.value);
                  setCustomApiKey('');
                }}
                className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              >
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.prefix}>
                    {k.name} ({k.prefix}) - {k.environment}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="Enter API Key (e.g. zr_test_...)"
                className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>

      {/* Input controls + Upload grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Person Image Upload */}
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5 gap-3">
          <div className="flex items-center justify-between">
            <Eyebrow>1. Person Photo</Eyebrow>
            <label className="text-[12px] font-semibold text-brand hover:underline cursor-pointer">
              Upload File
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], setPersonImage)}
              />
            </label>
          </div>

          <div className="relative aspect-[3/4] rounded-2xl border-2 border-dashed border-line overflow-hidden bg-surface-2 flex items-center justify-center group">
            {personImage ? (
              <img src={personImage} alt="Person" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[13px] text-ink-faint">Drag &amp; drop or upload photo</span>
            )}
          </div>

          {/* Preset Buttons */}
          <div className="flex gap-2">
            <span className="text-[11px] font-medium text-ink-faint flex items-center">Presets:</span>
            {SAMPLE_PERSONS.map((url, idx) => (
              <button
                key={idx}
                onClick={() => setPersonImage(url)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  personImage === url ? 'border-brand bg-brand/10 font-bold text-brand' : 'border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                Sample {idx + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Garment Image Upload */}
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5 gap-3">
          <div className="flex items-center justify-between">
            <Eyebrow>2. Garment Photo</Eyebrow>
            <label className="text-[12px] font-semibold text-brand hover:underline cursor-pointer">
              Upload File
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], setGarmentImage)}
              />
            </label>
          </div>

          <div className="relative aspect-[3/4] rounded-2xl border-2 border-dashed border-line overflow-hidden bg-surface-2 flex items-center justify-center group">
            {garmentImage ? (
              <img src={garmentImage} alt="Garment" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[13px] text-ink-faint">Drag &amp; drop or upload photo</span>
            )}
          </div>

          {/* Preset Buttons */}
          <div className="flex gap-2">
            <span className="text-[11px] font-medium text-ink-faint flex items-center">Presets:</span>
            {SAMPLE_GARMENTS.map((url, idx) => (
              <button
                key={idx}
                onClick={() => setGarmentImage(url)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  garmentImage === url ? 'border-brand bg-brand/10 font-bold text-brand' : 'border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                Garment {idx + 1}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Parameter Settings */}
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <Eyebrow>Request Parameters</Eyebrow>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Cloth Type
            </label>
            <select
              value={clothType}
              onChange={(e: any) => setClothType(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
            >
              <option value="auto">Auto-detect</option>
              <option value="upper_body">Upper Body (Tops/Jackets)</option>
              <option value="lower_body">Lower Body (Pants/Skirts)</option>
              <option value="dress">Full Dress / Jumpsuit</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Quality Mode
            </label>
            <select
              value={quality}
              onChange={(e: any) => setQuality(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
            >
              <option value="fast">Fast (Standard)</option>
              <option value="hd">HD (High Quality)</option>
              <option value="2k">2K Ultra HD</option>
            </select>
          </div>

          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-line bg-surface-2">
              <input
                type="checkbox"
                checked={asyncJob}
                onChange={(e) => setAsyncJob(e.target.checked)}
                className="w-4 h-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-[13px] font-medium text-ink">Async Queue Job</span>
            </label>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleRunTryOn}
          disabled={isLoading || !personImage || !garmentImage}
          className="w-full h-14 rounded-full bg-brand text-on-brand font-semibold text-[16px] hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2 shadow-lg shadow-brand/20"
        >
          {isLoading ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
              <span>Processing Try-On AI Pipeline...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[20px]">play_arrow</span>
              <span>Run /v1/try-on Request</span>
            </>
          )}
        </button>
      </div>

      {/* Results & Inspection Section */}
      {(resultImage || errorMsg || responseStatus !== null || isLoading) && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              {responseStatus !== null && (
                <span
                  className={`px-3 py-1 rounded-full text-[12px] font-bold ${
                    responseStatus >= 200 && responseStatus < 300
                      ? 'bg-success-soft text-success border border-success/30'
                      : 'bg-danger-soft text-danger border border-danger/30'
                  }`}
                >
                  HTTP {responseStatus}
                </span>
              )}
              {processingTimeMs !== null && (
                <span className="text-[12px] font-medium text-ink-soft">
                  <span className="material-symbols-outlined text-[14px] align-middle mr-1">timer</span>
                  {processingTimeMs} ms
                </span>
              )}
            </div>

            {requestId && (
              <span className="text-[11px] font-mono text-ink-faint bg-surface-2 px-2.5 py-1 rounded-lg">
                ID: {requestId}
              </span>
            )}
          </div>

          {/* Sub-view switcher */}
          <div className="flex gap-2 border-b border-line pb-2">
            {(
              [
                { id: 'preview', label: 'Result Preview' },
                { id: 'json_req', label: 'Request JSON' },
                { id: 'json_res', label: 'Response JSON' },
                { id: 'code', label: 'Code Snippets' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setViewTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
                  viewTab === t.id
                    ? 'bg-brand/10 text-brand border border-brand/30'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab 1: Preview */}
          {viewTab === 'preview' && (
            <div className="flex flex-col gap-6">
              {errorMsg && (
                <div className="p-4 rounded-xl border border-danger/30 bg-danger-soft text-danger text-[13px] font-medium">
                  {errorMsg}
                </div>
              )}

              {resultImage ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative max-w-[400px] w-full aspect-[3/4] rounded-2xl border border-line overflow-hidden bg-surface-2 shadow-md">
                    <img src={resultImage} alt="Try-On Result" className="w-full h-full object-cover" />
                  </div>

                  <a
                    href={resultImage}
                    download="zipright_tryon_result.jpg"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-surface-2 border border-line hover:border-brand text-[13px] font-semibold text-ink transition-all press-soft"
                  >
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Download High-Res Output
                  </a>
                </div>
              ) : isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <span className="material-symbols-outlined text-[48px] text-brand animate-spin">
                    motion_photos_on
                  </span>
                  <p className="text-[14px] font-medium text-ink-soft">
                    Generating try-on with neural pipeline...
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {/* Tab 2: JSON Request */}
          {viewTab === 'json_req' && (
            <pre className="p-4 rounded-2xl bg-ink/90 text-white font-mono text-[12px] overflow-x-auto">
              {JSON.stringify(getPayload(), null, 2)}
            </pre>
          )}

          {/* Tab 3: JSON Response */}
          {viewTab === 'json_res' && (
            <pre className="p-4 rounded-2xl bg-ink/90 text-white font-mono text-[12px] overflow-x-auto">
              {JSON.stringify(responseJson || {}, null, 2)}
            </pre>
          )}

          {/* Tab 4: Code Snippets */}
          {viewTab === 'code' && (
            <CodeGenerator
              apiKey={activeKeyHeader}
              endpointUrl={`${getBackendBaseUrl()}/v1/try-on`}
              payload={getPayload()}
            />
          )}
        </div>
      )}
    </div>
  );
};
