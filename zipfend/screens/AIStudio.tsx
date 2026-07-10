import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AppBar, Button, Eyebrow, Spinner } from '../components/ui';

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
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
      <AppBar title="AI Studio" subtitle="Fashion visualizer" />

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-6 pb-36">
        {/* Prompt Input */}
        <div className="mb-8">
          <Eyebrow className="mb-3">Describe your vision</Eyebrow>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A futuristic wool coat in a neon-lit Tokyo street…"
              className="w-full h-32 bg-surface-1 border border-line rounded-card p-5 text-[14px] focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow] resize-none placeholder:text-ink-faint"
            />
            <div className="absolute bottom-4 right-4 text-brand/50">
              <span className="material-symbols-outlined text-[19px]" aria-hidden="true">magic_button</span>
            </div>
          </div>
        </div>

        {/* Style Selection */}
        <div className="mb-8">
          <Eyebrow className="mb-3">Select style</Eyebrow>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {styles.map((s) => (
              <button
                key={s.name}
                onClick={() => setStyle(s.name)}
                aria-pressed={style === s.name}
                className={`flex flex-col items-center gap-2 px-5 py-4 rounded-card border transition-[transform,border-color,background-color,color] shrink-0 active:scale-95 ${
                  style === s.name ? 'bg-ink text-ink-invert border-ink' : 'bg-surface-1 text-ink-soft border-line hover:border-line-strong'
                }`}
              >
                <span className="text-2xl" aria-hidden="true">{s.icon}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{s.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Result Area */}
        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.03 }}
              className="aspect-[3/4] rounded-card bg-surface-1 border border-line flex flex-col items-center justify-center gap-5"
            >
              <div className="relative">
                <Spinner size={54} className="text-brand" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px] text-brand animate-pulse" aria-hidden="true">auto_awesome</span>
                </div>
              </div>
              <p className="eyebrow animate-pulse">Designing your look…</p>
            </motion.div>
          ) : resultImage ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="relative aspect-[3/4] rounded-card overflow-hidden border border-line group">
                <img src={resultImage} alt="Generated Fashion" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  <button aria-label="Download" onClick={() => window.open(resultImage, '_blank')} className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center active:scale-90 transition-transform">
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">download</span>
                  </button>
                  <button
                    aria-label="Share"
                    onClick={async () => {
                      try {
                        if (navigator.share) await navigator.share({ title: 'My ZipRIGHT look', url: resultImage });
                        else await navigator.clipboard.writeText(resultImage);
                      } catch { /* user dismissed share */ }
                    }}
                    className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">ios_share</span>
                  </button>
                </div>
              </div>
              <button
                onClick={() => setResultImage(null)}
                className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint py-2 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span> Start over
              </button>
            </motion.div>
          ) : (
            <div className="aspect-[3/4] rounded-card bg-surface-1 border border-dashed border-line-strong flex flex-col items-center justify-center text-ink-faint">
              <span className="material-symbols-outlined text-[44px] mb-4 opacity-30" style={{ fontVariationSettings: "'wght' 100" }} aria-hidden="true">image</span>
              <p className="eyebrow opacity-60">Your creation will appear here</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Generate Button */}
      {!resultImage && !isGenerating && (
        <div className="fixed bottom-0 inset-x-0 w-full p-6 pb-8 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent phone-fixed-bottom">
          <Button size="lg" fullWidth trailingIcon="auto_awesome" disabled={!prompt} onClick={handleGenerate}>
            Generate look
          </Button>
        </div>
      )}
    </div>
  );
};

export default AIStudio;
