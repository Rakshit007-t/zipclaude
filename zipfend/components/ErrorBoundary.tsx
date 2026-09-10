import React, { Component, ErrorInfo, ReactNode } from 'react';
import Wordmark from './ui/Wordmark';
import { agentDebugLog } from '../utils/agentDebugLog';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    // #region agent log
    agentDebugLog('ErrorBoundary.tsx:componentDidCatch', 'react crash', {error:error.message,stack:error.stack?.slice(0,400)||'',componentStack:(errorInfo.componentStack||'').slice(0,400)}, 'A');
    // #endregion
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen min-h-dvh bg-surface-0 text-ink p-8 text-center">
          <Wordmark size="sm" className="mb-10 opacity-60" />
          <p className="eyebrow mb-3">A loose thread</p>
          <h1 className="font-display text-[28px] font-medium mb-3">Something went wrong</h1>
          <p className="text-[14px] text-ink-soft leading-relaxed max-w-[280px] mb-8">
            We hit an unexpected error. A refresh should set things straight.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="h-12 px-8 bg-ink text-ink-invert font-semibold uppercase tracking-[0.1em] text-[12px] rounded-full active:scale-95 transition-transform"
          >
            Reload app
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
