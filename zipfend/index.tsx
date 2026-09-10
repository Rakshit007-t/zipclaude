import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { agentDebugLog } from './utils/agentDebugLog';

// #region agent log
window.addEventListener('error', (event) => {
  agentDebugLog('index.tsx:error', 'window.error', { message: String(event.message || ''), filename: event.filename || '', lineno: event.lineno || 0 }, 'C');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  agentDebugLog('index.tsx:rejection', 'unhandledrejection', { message: reason instanceof Error ? reason.message : String(reason) }, 'C');
});
agentDebugLog('index.tsx:boot', 'boot', { hasRoot: Boolean(document.getElementById('root')), href: window.location.href }, 'B');
// #endregion

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
