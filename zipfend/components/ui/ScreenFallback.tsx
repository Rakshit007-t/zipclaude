import React from 'react';
import Spinner from './Spinner';

/**
 * Suspense fallback shown while a lazily-loaded screen's chunk downloads.
 * Matches the app shell background so chunk loads feel like a beat, not a
 * flash. (Kept intentionally minimal — screens own their skeletons.)
 */
const ScreenFallback: React.FC = () => (
  <div className="min-h-screen min-h-dvh flex flex-col items-center justify-center bg-[#111111]">
    <span className="text-[22px] font-black tracking-tighter italic text-[#C9A06C] select-none" aria-hidden="true">
      <span className="text-white">Zip</span>RIGHT
    </span>
    <div className="mt-6 text-[#C9A06C]">
      <Spinner size={22} aria-label="Loading screen" />
    </div>
  </div>
);

export default ScreenFallback;
