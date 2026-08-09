import React, { useState } from 'react';
import { Eyebrow } from '../ui';

export interface RequestHistoryItem {
  id: string;
  timestamp: string;
  endpoint: string;
  status: number;
  durationMs: number;
  requestId: string;
  payload: any;
  response: any;
}

interface RequestHistoryViewProps {
  history: RequestHistoryItem[];
  onClearHistory: () => void;
}

export const RequestHistoryView: React.FC<RequestHistoryViewProps> = ({
  history,
  onClearHistory,
}) => {
  const [selectedItem, setSelectedItem] = useState<RequestHistoryItem | null>(null);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow className="mb-1">Telemetry &amp; Audit Logs</Eyebrow>
            <h2 className="text-[20px] font-bold text-ink">Request History</h2>
            <p className="text-[13px] text-ink-soft mt-1">
              Recent API executions recorded in your developer session.
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={onClearHistory}
              className="px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-[12px] font-medium text-ink-soft hover:text-danger hover:border-danger/30 transition-colors"
            >
              Clear Logs
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-ink-faint">
            <span className="material-symbols-outlined text-[40px] mb-2 opacity-40">history</span>
            <p className="text-[13px]">No API calls recorded yet in this session.</p>
            <p className="text-[11px] mt-1">Run requests in the Playground or API Explorer to track logs here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
                className={`flex flex-col p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedItem?.id === item.id
                    ? 'border-brand bg-brand/5 shadow-sm'
                    : 'border-line bg-surface-2 hover:border-line-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        item.status >= 200 && item.status < 300
                          ? 'bg-success-soft text-success'
                          : 'bg-danger-soft text-danger'
                      }`}
                    >
                      HTTP {item.status}
                    </span>

                    <code className="text-[13px] font-bold text-ink">{item.endpoint}</code>
                  </div>

                  <div className="flex items-center gap-3 text-[12px] text-ink-faint">
                    <span>{item.durationMs} ms</span>
                    <span>•</span>
                    <span>{formatTime(item.timestamp)}</span>
                    <span className="material-symbols-outlined text-[18px]">
                      {selectedItem?.id === item.id ? 'expand_less' : 'expand_more'}
                    </span>
                  </div>
                </div>

                {/* Expanded Details */}
                {selectedItem?.id === item.id && (
                  <div className="mt-4 pt-4 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200">
                    <div>
                      <span className="text-[11px] font-semibold text-ink-faint uppercase block mb-1">
                        Payload
                      </span>
                      <pre className="p-3 rounded-xl bg-ink/90 text-white font-mono text-[11px] overflow-x-auto max-h-[200px]">
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-ink-faint uppercase block mb-1">
                        Response
                      </span>
                      <pre className="p-3 rounded-xl bg-ink/90 text-white font-mono text-[11px] overflow-x-auto max-h-[200px]">
                        {JSON.stringify(item.response, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
