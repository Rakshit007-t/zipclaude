import React from 'react';
import { useNavigate } from 'react-router-dom';

interface ComingSoonProps {
  featureName: string;
}

const ComingSoon: React.FC<ComingSoonProps> = ({ featureName }) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-sans">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back" onClick={() => navigate('/home')} className="h-12 w-12 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[24px] text-[#6157FF]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">Coming Soon</h1>
        <div className="w-12"></div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-24 w-24 rounded-full bg-[#6157FF]/10 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-4xl text-[#6157FF]">construction</span>
        </div>
        <h2 className="text-2xl font-bold mb-4 tracking-tighter">{featureName}</h2>
        <p className="text-ink-soft max-w-xs">We're working hard to bring this feature to you. Stay tuned!</p>
      </div>
    </div>
  );
};

export default ComingSoon;
