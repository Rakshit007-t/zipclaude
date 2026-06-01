import React from 'react';
import { useNavigate } from 'react-router-dom';

const PrivacyCenter: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-display">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-12 w-12 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[24px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C]">Privacy Center</h1>
        <div className="w-12"></div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-24 w-24 rounded-full bg-[#C9A06C]/10 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-4xl text-[#C9A06C]">security</span>
        </div>
        <h2 className="text-2xl font-black mb-4 uppercase tracking-tighter">Privacy Center</h2>
        <p className="text-[#A0A0A0] max-w-xs">Manage your privacy settings and data preferences. Control how your information is used.</p>
      </div>
    </div>
  );
};

export default PrivacyCenter;
