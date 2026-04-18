import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

const AvatarIntro: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [avatarData, setAvatarData] = useState({
    gender: 'Male',
    height: 175,
    weight: 70,
    bodyType: 'Average',
    skinTone: '#E0AC69',
    hairStyle: 'Short',
    hairColor: '#4B2C20'
  });

  const nextStep = () => setStep(prev => prev + 1);
  const prevStep = () => setStep(prev => prev - 1);

  const skinTones = ['#FAD7B0', '#E0AC69', '#8D5524', '#C68642', '#3C2E28'];
  const hairColors = ['#000000', '#4B2C20', '#A52A2A', '#D2B48C', '#FFFFFF'];

  const renderStep = () => {
    switch(step) {
      case 1:
        return (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col gap-8"
          >
            <div className="text-center">
              <div className="h-20 w-20 rounded-3xl bg-[#C9A06C]/10 flex items-center justify-center mx-auto mb-6">
                <span className="material-symbols-outlined text-[40px] text-[#C9A06C]">verified_user</span>
              </div>
              <h2 className="text-3xl font-black mb-4">Privacy First</h2>
              <p className="text-gray-400 leading-relaxed">
                We don't use your camera or collect face data. Create your digital twin manually for a secure and private experience.
              </p>
            </div>
            <button 
              onClick={nextStep}
              className="w-full h-14 rounded-2xl bg-[#C9A06C] text-black font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              Get Started <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
            </button>
          </motion.div>
        );
      case 2:
        return (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-6"
          >
            <h2 className="text-2xl font-black mb-2">Basic Attributes</h2>
            
            <div className="space-y-6">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Gender / Body Frame</label>
                <div className="grid grid-cols-2 gap-3">
                  {['Male', 'Female'].map(g => (
                    <button 
                      key={g}
                      onClick={() => setAvatarData({...avatarData, gender: g})}
                      className={`h-14 rounded-2xl border font-bold transition-all ${avatarData.gender === g ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-white/10'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Height ({avatarData.height} cm)</label>
                <input 
                  type="range" min="140" max="210" 
                  value={avatarData.height}
                  onChange={(e) => setAvatarData({...avatarData, height: parseInt(e.target.value)})}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#C9A06C]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Weight ({avatarData.weight} kg)</label>
                <input 
                  type="range" min="40" max="150" 
                  value={avatarData.weight}
                  onChange={(e) => setAvatarData({...avatarData, weight: parseInt(e.target.value)})}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#C9A06C]"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={prevStep} className="h-14 w-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10"><span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span></button>
              <button onClick={nextStep} className="flex-1 h-14 rounded-2xl bg-white text-black font-bold">Continue</button>
            </div>
          </motion.div>
        );
      case 3:
        return (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-6"
          >
            <h2 className="text-2xl font-black mb-2">Appearance</h2>
            
            <div className="space-y-6">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Skin Tone</label>
                <div className="flex gap-3">
                  {skinTones.map(tone => (
                    <button 
                      key={tone}
                      onClick={() => setAvatarData({...avatarData, skinTone: tone})}
                      className={`h-10 w-10 rounded-full border-2 transition-all ${avatarData.skinTone === tone ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: tone }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Hair Style</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Short', 'Medium', 'Long'].map(s => (
                    <button 
                      key={s}
                      onClick={() => setAvatarData({...avatarData, hairStyle: s})}
                      className={`h-12 rounded-xl border text-xs font-bold transition-all ${avatarData.hairStyle === s ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-white/10'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Hair Color</label>
                <div className="flex gap-3">
                  {hairColors.map(color => (
                    <button 
                      key={color}
                      onClick={() => setAvatarData({...avatarData, hairColor: color})}
                      className={`h-10 w-10 rounded-full border-2 transition-all ${avatarData.hairColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={prevStep} className="h-14 w-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10"><span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span></button>
              <button 
                onClick={() => navigate('/avatar-view', { state: { avatarData } })}
                className="flex-1 h-14 rounded-2xl bg-[#C9A06C] text-black font-bold shadow-lg shadow-[#C9A06C]/20"
              >
                Generate Avatar
              </button>
            </div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#111111] text-white font-display flex flex-col">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#C9A06C]">Digital Twin</span>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3].map(i => (
              <div key={i} className={`h-1 w-4 rounded-full transition-all ${step >= i ? 'bg-[#C9A06C]' : 'bg-white/10'}`} />
            ))}
          </div>
        </div>
        <div className="w-10" />
      </div>

      {/* Content */}
      <div className="flex-1 px-6 flex flex-col justify-center pb-12">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>

      {/* Background Decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-24 -right-24 h-96 w-96 bg-[#C9A06C]/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 h-96 w-96 bg-blue-500/5 blur-[120px] rounded-full" />
      </div>
    </div>
  );
};

export default AvatarIntro;
