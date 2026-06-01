import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

const AIStudio: React.FC = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Runway');
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const styles = [
    { name: 'Runway', icon: '👠' },
    { name: 'Street', icon: '🏙️' },
    { name: 'Studio', icon: '📸' },
    { name: 'Vintage', icon: '🎞️' },
    { name: 'Cyberpunk', icon: '🤖' }
  ];

  const handleGenerate = () => {
    if (!prompt) return;
    setIsGenerating(true);
    // Simulate generation
    setTimeout(() => {
      setResultImage('https://images.unsplash.com/photo-1539109132314-34a77ae68c44?w=800&auto=format&fit=crop');
      setIsGenerating(false);
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-[#111111] text-white font-display flex flex-col">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 flex items-center justify-between bg-[#111111]/80 backdrop-blur-xl sticky top-0 z-50 border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#C9A06C]">AI Studio</span>
          <h1 className="text-xs font-bold text-white/60 mt-0.5">Fashion Visualizer</h1>
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-6 pb-32">
        {/* Prompt Input */}
        <div className="mb-8">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Describe your vision</label>
          <div className="relative">
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A futuristic wool coat in a neon-lit Tokyo street..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-[2rem] p-5 text-sm focus:outline-none focus:border-[#C9A06C]/50 transition-all resize-none"
            />
            <div className="absolute bottom-4 right-4 text-[#C9A06C]/40">
              <span className="material-symbols-outlined text-[20px]">magic_button</span>
            </div>
          </div>
        </div>

        {/* Style Selection */}
        <div className="mb-8">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block">Select Style</label>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {styles.map((s) => (
              <button 
                key={s.name}
                onClick={() => setStyle(s.name)}
                className={`flex flex-col items-center gap-2 px-5 py-4 rounded-[1.5rem] border transition-all shrink-0 ${style === s.name ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-white/10'}`}
              >
                <span className="text-2xl">{s.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider">{s.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Result Area */}
        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div 
              key="generating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="aspect-[3/4] rounded-[2.5rem] bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-4"
            >
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-2 border-[#C9A06C]/20 border-t-[#C9A06C] animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[24px] text-[#C9A06C] animate-pulse">auto_awesome</span>
                </div>
              </div>
              <p className="text-sm font-bold text-[#C9A06C] animate-pulse">Designing Your Look...</p>
            </motion.div>
          ) : resultImage ? (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="relative aspect-[3/4] rounded-[2.5rem] overflow-hidden border border-white/10 group">
                <img src={resultImage} alt="Generated Fashion" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  <button className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center active:scale-90 transition-transform">
                    <span className="material-symbols-outlined text-[20px]">download</span>
                  </button>
                  <button className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center active:scale-90 transition-transform">
                    <span className="material-symbols-outlined text-[20px]">ios_share</span>
                  </button>
                </div>
              </div>
              <button 
                onClick={() => setResultImage(null)}
                className="flex items-center justify-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-widest py-2"
              >
                <span className="material-symbols-outlined text-[14px]">refresh</span> Start Over
              </button>
            </motion.div>
          ) : (
            <div className="aspect-[3/4] rounded-[2.5rem] bg-white/5 border border-dashed border-white/10 flex flex-col items-center justify-center text-gray-600">
              <span className="material-symbols-outlined text-[48px] mb-4 opacity-20" style={{ fontVariationSettings: "'wght' 100" }}>image</span>
              <p className="text-xs font-bold uppercase tracking-widest opacity-40">Your creation will appear here</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Generate Button */}
      {!resultImage && !isGenerating && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#111111] via-[#111111] to-transparent">
          <button 
            onClick={handleGenerate}
            disabled={!prompt}
            className={`w-full h-14 rounded-2xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2 ${prompt ? 'bg-[#C9A06C] text-black active:scale-95' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}
          >
            Generate Look <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default AIStudio;
