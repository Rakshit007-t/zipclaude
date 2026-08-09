import React, { useState } from 'react';
import { getBackendBaseUrl, ApiKeyMetadata } from '../../services/ziprightApi';
import { Eyebrow } from '../ui';
import { CodeGenerator } from './CodeGenerator';

interface DocumentationViewProps {
  apiKeys: ApiKeyMetadata[];
}

type DocSection = 'quickstart' | 'auth' | 'endpoints' | 'errors' | 'ratelimits' | 'sdks';

const ENDPOINTS_DOCS = [
  {
    id: 'try-on',
    method: 'POST',
    path: '/v1/try-on',
    title: 'Virtual Try-On',
    description: 'Generates a photorealistic virtual try-on image or queues an asynchronous worker job.',
    headers: [
      { name: 'Content-Type', value: 'application/json', required: true },
      { name: 'X-API-Key', value: 'zr_test_xxxxxxxxxxxxxxxx', required: true },
    ],
    requestFields: [
      { field: 'person_image', type: 'string', required: false, desc: 'Base64 data URL or HTTP URL of person photo.' },
      { field: 'garment_image', type: 'string', required: false, desc: 'Base64 data URL or HTTP URL of garment photo.' },
      { field: 'product_image_url', type: 'string', required: false, desc: 'URL of garment product image from catalog.' },
      { field: 'cloth_type', type: 'enum', required: false, desc: '"auto" | "upper_body" | "lower_body" | "dress"' },
      { field: 'quality', type: 'enum', required: false, desc: '"fast" | "hd" | "2k" (Default: "hd")' },
      { field: 'async_job', type: 'boolean', required: false, desc: 'Set true to return a job_id for background processing.' },
    ],
    sampleRequest: {
      person_image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500',
      garment_image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
      cloth_type: 'auto',
      quality: 'hd',
      async_job: false,
    },
    sampleResponseSuccess: {
      isValid: true,
      message: 'Try-on completed successfully.',
      data: {
        tryon_image: 'https://api.zipright.ai/uploads/tryon_res_9872.jpg',
        engine: 'catvton_cloud',
        status: 'completed',
      },
    },
    sampleResponseError: {
      isValid: false,
      message: 'Must provide either garment_image or product_image_url.',
      data: null,
    },
    statusCodes: [
      { code: 200, status: 'OK', desc: 'Try-on generated successfully.' },
      { code: 401, status: 'Unauthorized', desc: 'Missing or invalid X-API-Key header.' },
      { code: 422, status: 'Unprocessable Entity', desc: 'Validation failed or missing input images.' },
      { code: 500, status: 'Internal Error', desc: 'AI processing failure.' },
    ],
  },
  {
    id: 'fit-profile',
    method: 'POST',
    path: '/v1/fit-profile',
    title: 'Precision Fit Profile',
    description: 'Estimates 3D body measurements (chest, waist, shoulders, etc.) from front and side photos.',
    headers: [
      { name: 'Content-Type', value: 'application/json', required: true },
      { name: 'X-API-Key', value: 'zr_test_xxxxxxxxxxxxxxxx', required: true },
    ],
    requestFields: [
      { field: 'height', type: 'number', required: true, desc: 'Person height in centimeters (e.g. 175.5).' },
      { field: 'front_image', type: 'string (base64)', required: true, desc: 'Base64 data URL of front full-body photo.' },
      { field: 'side_image', type: 'string (base64)', required: true, desc: 'Base64 data URL of side full-body photo.' },
    ],
    sampleRequest: {
      height: 175.0,
      front_image: 'data:image/jpeg;base64,...',
      side_image: 'data:image/jpeg;base64,...',
    },
    sampleResponseSuccess: {
      isValid: true,
      message: 'Fit profile computed successfully.',
      data: {
        is_valid: true,
        measurements: {
          chest: 96.5,
          waist: 81.2,
          shoulders: 45.0,
          arms: 62.0,
          legs: 98.0,
          hips: 99.0,
          confidence: 0.94,
        },
      },
    },
    sampleResponseError: {
      isValid: false,
      message: 'Stand straight, full body visible, good lighting',
      data: null,
    },
    statusCodes: [
      { code: 200, status: 'OK', desc: 'Measurements estimated successfully.' },
      { code: 401, status: 'Unauthorized', desc: 'Invalid API key.' },
      { code: 422, status: 'Unprocessable Entity', desc: 'Photo quality too low or pose not detected.' },
    ],
  },
  {
    id: 'size-recommendation',
    method: 'POST',
    path: '/v1/size-recommendation',
    title: 'AI Size Recommendation',
    description: 'Calculates the optimal clothing size (S/M/L) and fit risk rating for a given product.',
    headers: [
      { name: 'Content-Type', value: 'application/json', required: true },
      { name: 'X-API-Key', value: 'zr_test_xxxxxxxxxxxxxxxx', required: true },
    ],
    requestFields: [
      { field: 'height', type: 'number', required: true, desc: 'Person height in cm.' },
      { field: 'base_size', type: 'enum', required: false, desc: '"XS" | "S" | "M" | "L" | "XL" | "XXL"' },
      { field: 'fit_preference', type: 'enum', required: false, desc: '"slim" | "regular" | "relaxed" | "loose" | "baggy"' },
      { field: 'product', type: 'object', required: true, desc: 'Normalized product details (title, category, url).' },
    ],
    sampleRequest: {
      height: 178.0,
      base_size: 'M',
      fit_preference: 'regular',
      product: {
        id: 'prod_99',
        title: 'Slim Fit Denim Jacket',
        brand: 'ZipRIGHT Studio',
        category: 'jackets',
        url: 'https://example.com/jacket',
      },
    },
    sampleResponseSuccess: {
      isValid: true,
      message: 'Size recommendation computed successfully.',
      data: {
        size: 'L',
        confidence: 0.92,
        risk: 'low',
        reason: 'Fits true to size across shoulders; recommend L for regular chest fit.',
      },
    },
    sampleResponseError: {
      isValid: false,
      message: 'Insufficient sizing data for product.',
      data: null,
    },
    statusCodes: [
      { code: 200, status: 'OK', desc: 'Recommendation calculated.' },
      { code: 422, status: 'Unprocessable Entity', desc: 'Missing garment sizing information.' },
    ],
  },
  {
    id: 'jobs',
    method: 'GET',
    path: '/v1/jobs/{job_id}',
    title: 'Async Job Status',
    description: 'Queries status, progress percentage, and output image URL of background try-on jobs.',
    headers: [
      { name: 'X-API-Key', value: 'zr_test_xxxxxxxxxxxxxxxx', required: true },
    ],
    requestFields: [],
    sampleRequest: null,
    sampleResponseSuccess: {
      isValid: true,
      message: 'Job status retrieved successfully.',
      data: {
        job_id: 'job_487291a',
        status: 'done',
        progress: 100,
        stage: 'completed',
        engine: 'catvton_cloud',
        tryon_image: 'https://api.zipright.ai/uploads/tryon_res_9872.jpg',
        error: null,
      },
    },
    sampleResponseError: {
      isValid: false,
      message: 'Job ID not found or expired.',
      data: null,
    },
    statusCodes: [
      { code: 200, status: 'OK', desc: 'Job details fetched.' },
      { code: 404, status: 'Not Found', desc: 'Invalid job_id or expired job.' },
    ],
  },
  {
    id: 'health',
    method: 'GET',
    path: '/v1/health',
    title: 'Public API Health Probe',
    description: 'Uptime check endpoint for monitoring system availability.',
    headers: [],
    requestFields: [],
    sampleRequest: null,
    sampleResponseSuccess: {
      isValid: true,
      message: 'ZipRIGHT Public API v1 operational.',
      data: {
        status: 'online',
        version: '1.0.0',
        api_version: 'v1',
        timestamp: '2026-07-28T07:30:00Z',
      },
    },
    sampleResponseError: null,
    statusCodes: [
      { code: 200, status: 'OK', desc: 'Service operational.' },
      { code: 503, status: 'Service Unavailable', desc: 'Service degraded.' },
    ],
  },
];

const ERROR_CATALOG = [
  { code: 400, title: 'Bad Request', cause: 'Malformed JSON payload or invalid parameter syntax.', fix: 'Ensure payload is valid JSON and adheres to property types.' },
  { code: 401, title: 'Unauthorized', cause: 'Missing X-API-Key header or key format is invalid.', fix: 'Pass X-API-Key header starting with zr_test_ or zr_live_.' },
  { code: 403, title: 'Forbidden', cause: 'The API key has been revoked or lacks permissions.', fix: 'Generate a new API key in the Developer Console.' },
  { code: 404, title: 'Not Found', cause: 'Target resource or job_id does not exist.', fix: 'Verify the job_id or resource path.' },
  { code: 409, title: 'Conflict', cause: 'Resource already exists or concurrent edit conflict.', fix: 'Retry with a updated unique identifier.' },
  { code: 422, title: 'Unprocessable Entity', cause: 'Image unreadable or required parameters missing.', fix: 'Provide valid image data URLs and check required fields.' },
  { code: 429, title: 'Rate Limit Exceeded', cause: 'Exceeded 100 requests per minute quota.', fix: 'Implement exponential backoff and inspect Retry-After header.' },
  { code: 500, title: 'Internal Server Error', cause: 'Unexpected processing failure in AI engine.', fix: 'Contact developer support if issue persists.' },
];

export const DocumentationView: React.FC<DocumentationViewProps> = ({ apiKeys }) => {
  const [activeSection, setActiveSection] = useState<DocSection>('quickstart');
  const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS_DOCS[0]);

  const activeApiKey = apiKeys.length > 0 ? apiKeys[0].prefix : 'zr_test_YOUR_API_KEY';

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <div>
          <Eyebrow className="mb-1">Developer Documentation</Eyebrow>
          <h2 className="text-[22px] font-bold text-ink">ZipRIGHT API Reference</h2>
          <p className="text-[13px] text-ink-soft mt-1">
            Complete guide for integrating ZipRIGHT's Virtual Try-On &amp; Sizing REST APIs.
          </p>
        </div>

        {/* Section Navigation Pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pt-2 border-t border-line">
          {(
            [
              { id: 'quickstart', label: 'Quick Start' },
              { id: 'auth', label: 'Authentication' },
              { id: 'endpoints', label: 'API Reference' },
              { id: 'errors', label: 'Error Reference' },
              { id: 'ratelimits', label: 'Rate Limits' },
              { id: 'sdks', label: 'SDKs & Libraries' },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-[12px] font-bold border transition-colors ${
                activeSection === s.id
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line bg-surface-2 text-ink-soft hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 1: QUICK START */}
      {activeSection === 'quickstart' && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
          <Eyebrow>4-Step Integration</Eyebrow>
          <h3 className="text-[18px] font-bold text-ink">Quick Start Guide</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-line bg-surface-2 flex flex-col gap-2">
              <span className="w-7 h-7 rounded-full bg-brand text-on-brand font-bold text-[13px] flex items-center justify-center">1</span>
              <h4 className="text-[15px] font-bold text-ink mt-1">Generate API Key</h4>
              <p className="text-[13px] text-ink-soft">
                Navigate to the <strong>API Keys</strong> tab in the Developer Console and create a new secret key (<code className="text-brand">zr_test_...</code>).
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-line bg-surface-2 flex flex-col gap-2">
              <span className="w-7 h-7 rounded-full bg-brand text-on-brand font-bold text-[13px] flex items-center justify-center">2</span>
              <h4 className="text-[15px] font-bold text-ink mt-1">Configure Request Header</h4>
              <p className="text-[13px] text-ink-soft">
                Attach your API key to the HTTP header as <code className="text-brand">X-API-Key: zr_test_...</code> on every request.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-line bg-surface-2 flex flex-col gap-2">
              <span className="w-7 h-7 rounded-full bg-brand text-on-brand font-bold text-[13px] flex items-center justify-center">3</span>
              <h4 className="text-[15px] font-bold text-ink mt-1">Call /v1/try-on</h4>
              <p className="text-[13px] text-ink-soft">
                Send a POST request containing person and garment image URLs or base64 data URLs.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-line bg-surface-2 flex flex-col gap-2">
              <span className="w-7 h-7 rounded-full bg-brand text-on-brand font-bold text-[13px] flex items-center justify-center">4</span>
              <h4 className="text-[15px] font-bold text-ink mt-1">Receive Output</h4>
              <p className="text-[13px] text-ink-soft">
                Retrieve the photorealistic try-on result URL directly in the JSON response envelope.
              </p>
            </div>
          </div>

          <div className="mt-2">
            <h4 className="text-[14px] font-bold text-ink mb-2">First Request Example (cURL)</h4>
            <CodeGenerator
              apiKey={activeApiKey}
              endpointUrl={`${getBackendBaseUrl()}/v1/try-on`}
              payload={ENDPOINTS_DOCS[0].sampleRequest}
            />
          </div>
        </div>
      )}

      {/* SECTION 2: AUTHENTICATION */}
      {activeSection === 'auth' && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
          <Eyebrow>Security Specs</Eyebrow>
          <h3 className="text-[18px] font-bold text-ink">Authentication Guide</h3>
          <p className="text-[13px] text-ink-soft">
            ZipRIGHT uses API keys to authenticate requests. Secret keys are created in the Developer Console and must be kept secure.
          </p>

          <div className="p-4 rounded-xl border border-brass/30 bg-brass/10 text-brass text-[13px]">
            <strong>Security Warning:</strong> Never expose production <code className="font-mono font-bold">zr_live_</code> keys in client-side code or GitHub repositories.
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-[14px] font-bold text-ink">Key Formats</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl border border-line bg-surface-2">
                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-info/20 text-info">Development</span>
                <code className="block mt-2 font-mono text-[13px] text-ink font-bold">zr_test_xxxxxxxxxxxxxxxx</code>
                <p className="text-[11px] text-ink-faint mt-1">Use for testing in sandbox environments.</p>
              </div>

              <div className="p-4 rounded-xl border border-line bg-surface-2">
                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-brand/20 text-brand">Production</span>
                <code className="block mt-2 font-mono text-[13px] text-ink font-bold">zr_live_xxxxxxxxxxxxxxxx</code>
                <p className="text-[11px] text-ink-faint mt-1">Use for live commercial traffic.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: ENDPOINTS REFERENCE */}
      {activeSection === 'endpoints' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Endpoint selector sidebar */}
          <div className="flex flex-col rounded-card border border-line bg-surface-1 p-4 gap-2">
            <Eyebrow className="px-2 py-1">Endpoints</Eyebrow>
            {ENDPOINTS_DOCS.map((ep) => (
              <button
                key={ep.id}
                onClick={() => setSelectedEndpoint(ep)}
                className={`flex flex-col items-start p-3 rounded-xl border transition-all text-left ${
                  selectedEndpoint.id === ep.id
                    ? 'border-brand bg-brand/10'
                    : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold bg-brand text-on-brand">
                    {ep.method}
                  </span>
                  <span className="text-[13px] font-bold text-ink">{ep.title}</span>
                </div>
                <code className="text-[11px] font-mono text-ink-faint mt-1">{ep.path}</code>
              </button>
            ))}
          </div>

          {/* Endpoint detail view */}
          <div className="lg:col-span-2 flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
            <div className="border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-md text-[12px] uppercase font-bold bg-brand text-on-brand">
                  {selectedEndpoint.method}
                </span>
                <code className="text-[16px] font-bold text-brand font-mono">{selectedEndpoint.path}</code>
              </div>
              <h3 className="text-[18px] font-bold text-ink mt-2">{selectedEndpoint.title}</h3>
              <p className="text-[13px] text-ink-soft mt-1">{selectedEndpoint.description}</p>
            </div>

            {/* Headers */}
            {selectedEndpoint.headers.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-faint mb-2">Request Headers</h4>
                <div className="flex flex-col gap-2">
                  {selectedEndpoint.headers.map((h) => (
                    <div key={h.name} className="flex items-center justify-between p-2.5 rounded-lg border border-line bg-surface-2 text-[12px]">
                      <code className="font-bold text-ink">{h.name}</code>
                      <span className="text-ink-faint font-mono">{h.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request Body Fields */}
            {selectedEndpoint.requestFields.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-faint mb-2">Request Body Fields</h4>
                <div className="flex flex-col gap-2">
                  {selectedEndpoint.requestFields.map((rf) => (
                    <div key={rf.field} className="flex flex-col p-3 rounded-xl border border-line bg-surface-2 text-[12px] gap-1">
                      <div className="flex items-center justify-between">
                        <code className="font-bold text-brand">{rf.field}</code>
                        <div className="flex items-center gap-2">
                          <span className="text-ink-faint italic">{rf.type}</span>
                          {rf.required && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-danger/20 text-danger uppercase">Required</span>
                          )}
                        </div>
                      </div>
                      <p className="text-ink-soft text-[11.5px] mt-0.5">{rf.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Code Generator for selected endpoint */}
            {selectedEndpoint.sampleRequest && (
              <div>
                <h4 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-faint mb-2">Code Examples</h4>
                <CodeGenerator
                  apiKey={activeApiKey}
                  endpointUrl={`${getBackendBaseUrl()}${selectedEndpoint.path}`}
                  payload={selectedEndpoint.sampleRequest}
                />
              </div>
            )}

            {/* Sample Success Response */}
            <div>
              <h4 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-faint mb-2">Success Response (200 OK)</h4>
              <pre className="p-4 rounded-2xl bg-ink/90 text-white font-mono text-[12px] overflow-x-auto">
                {JSON.stringify(selectedEndpoint.sampleResponseSuccess, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: ERROR REFERENCE */}
      {activeSection === 'errors' && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
          <Eyebrow>HTTP Error Catalog</Eyebrow>
          <h3 className="text-[18px] font-bold text-ink">Error Reference</h3>
          <p className="text-[13px] text-ink-soft">
            Standard HTTP response codes emitted by ZipRIGHT REST APIs.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ERROR_CATALOG.map((err) => (
              <div key={err.code} className="flex flex-col p-4 rounded-2xl border border-line bg-surface-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    err.code >= 500 ? 'bg-danger-soft text-danger' : 'bg-brass/20 text-brass'
                  }`}>
                    HTTP {err.code}
                  </span>
                  <h4 className="text-[14px] font-bold text-ink">{err.title}</h4>
                </div>
                <p className="text-[12px] text-ink-soft mt-1"><strong>Cause:</strong> {err.cause}</p>
                <p className="text-[12px] text-brand"><strong>Resolution:</strong> {err.fix}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 5: RATE LIMITS */}
      {activeSection === 'ratelimits' && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
          <Eyebrow>Quota Specs</Eyebrow>
          <h3 className="text-[18px] font-bold text-ink">Rate Limiting Policy</h3>
          <p className="text-[13px] text-ink-soft">
            API requests are rate limited to <strong>100 requests per minute</strong> per API key.
          </p>
          <div className="p-4 rounded-xl border border-line bg-surface-2 text-[12px] text-ink-soft flex flex-col gap-2">
            <p>• Exceeding quota returns HTTP status <code className="text-danger font-bold">429 Too Many Requests</code>.</p>
            <p>• Check the <code className="text-brand font-bold">Retry-After</code> response header for reset timing (seconds).</p>
          </div>
        </div>
      )}

      {/* SECTION 6: SDKS */}
      {activeSection === 'sdks' && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
          <Eyebrow>Client Libraries</Eyebrow>
          <h3 className="text-[18px] font-bold text-ink">Official SDKs</h3>
          <p className="text-[13px] text-ink-soft">
            Official client SDKs for Python, Node.js, React Native, and Flutter are currently in beta testing. Use the fetch/cURL code snippets in the meantime.
          </p>
        </div>
      )}
    </div>
  );
};
