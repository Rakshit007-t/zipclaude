import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';

const AvatarView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const avatarData = location.state?.avatarData;

  if (!avatarData) {
    return (
      <div className="min-h-screen bg-surface-0 text-ink font-sans flex flex-col overflow-hidden items-center justify-center relative">
        <button aria-label="Go back" onClick={() => navigate('/home')} className="absolute top-8 left-6 h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 backdrop-blur-md z-50">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]">arrow_back</span>
        </button>
        <div className="flex flex-col items-center text-center gap-5 opacity-60">
          <span className="material-symbols-outlined text-4xl text-[#6157FF]">info</span>
          <p className="text-sm font-bold text-[#6157FF]">No data yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-50 px-6 pt-8 pb-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
        <button aria-label="Go back" onClick={() => navigate('/home')} className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 backdrop-blur-md">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">Your Digital Twin</h1>
        <button className="h-10 w-10 flex items-center justify-center rounded-full bg-surface-2 backdrop-blur-md">
          <span className="material-symbols-outlined text-[20px]">ios_share</span>
        </button>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Background Glow */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-[500px] w-[500px] bg-[#6157FF]/10 blur-[100px] rounded-full animate-pulse" />
        </div>

        {/* Avatar Display (Simulated) */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="relative z-10 h-[70vh] aspect-[1/2.2] flex flex-col items-center"
        >
          <div className="relative h-full w-full rounded-[3rem] overflow-hidden border border-line shadow-2xl">
            <img 
              src={avatarData.gender === 'Male' 
                ? "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&auto=format&fit=crop" 
                : "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800&auto=format&fit=crop"} 
              className="h-full w-full object-cover"
              alt="Digital Twin"
              referrerPolicy="no-referrer"
            />
            {/* Overlay for skin tone simulation */}
            <div 
              className="absolute inset-0 opacity-20 mix-blend-multiply pointer-events-none"
              style={{ backgroundColor: avatarData.skinTone }}
            />
          </div>

          {/* Success Badge */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="absolute -bottom-6 bg-white text-black px-6 py-3 rounded-2xl flex items-center gap-2 shadow-xl"
          >
            <span className="material-symbols-outlined text-[20px] text-green-500" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span className="font-bold text-sm">Avatar Ready</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Actions */}
      <div className="px-6 pb-12 pt-8 flex flex-col gap-4 z-20">
        <div className="grid grid-cols-2 gap-3">
          <button className="h-14 rounded-2xl bg-surface-2 border border-line flex items-center justify-center gap-2 font-bold active:scale-95 transition-all">
            <span className="material-symbols-outlined text-[20px]">download</span> Save
          </button>
          <button 
            onClick={() => navigate('/tryon-studio')}
            className="h-14 rounded-2xl bg-[#6157FF] text-ink flex items-center justify-center gap-2 font-bold active:scale-95 transition-all shadow-lg shadow-[#6157FF]/20"
          >
            <span className="material-symbols-outlined text-[20px]">auto_awesome</span> Try Outfits
          </button>
        </div>
        <button 
          onClick={() => navigate('/home')}
          className="text-gray-500 text-xs font-bold text-center mt-2"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
};

export default AvatarView;
