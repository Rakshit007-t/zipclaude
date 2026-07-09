import React, { Component, ErrorInfo, ReactNode } from 'react';

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
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-surface-0 text-ink p-6 text-center">
          <span className="material-symbols-outlined text-6xl mb-4 text-red-500">error</span>
          <h1 className="text-2xl font-bold mb-2 tracking-tighter">Something went wrong</h1>
          <p className="text-ink-soft font-medium mb-6">We encountered an unexpected error. Please try refreshing the page.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-white text-[#111111] font-bold rounded-xl active:scale-95 transition-all"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
