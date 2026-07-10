import React from 'react';
import Spinner from './Spinner';
import Wordmark from './Wordmark';

/**
 * Suspense fallback shown while a lazily-loaded screen's chunk downloads.
 * Matches the app shell background so chunk loads feel like a beat, not a
 * flash. (Kept intentionally minimal — screens own their skeletons.)
 */
const ScreenFallback: React.FC = () => (
  <div className="min-h-screen min-h-dvh flex flex-col items-center justify-center bg-surface-0">
    <Wordmark size="md" />
    <div className="mt-6 text-ink-faint">
      <Spinner size={22} aria-label="Loading screen" />
    </div>
  </div>
);

export default ScreenFallback;
