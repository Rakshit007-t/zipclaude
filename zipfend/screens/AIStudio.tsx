import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AppBar, Button, Eyebrow } from '../components/ui';

const AIStudio: React.FC = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Runway');

  const styles = [
    { name: 'Runway', icon: '👠' },
    { name: 'Street', icon: '🏙️' },
    { name: 'Studio', icon: '📸' },
    { name: 'Vintage', icon: '🎞️' },
    { name: 'Cyberpunk', icon: '🤖' }
  ];

  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setErrorNotice(null);
    // No text-to-image provider is configured. Do not simulate generation.
    setErrorNotice('Generative fashion visualizer is not configured for this deployment. Use Virtual Try-On with a garment photo instead.');
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
          {errorNotice ? (
            <motion.div
              key="notice"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="aspect-[3/4] rounded-card bg-surface-1 border border-line p-6 flex flex-col items-center justify-center text-center gap-4"
            >
              <div className="h-12 w-12 rounded-full bg-brand/10 text-brand flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px]">science</span>
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand mb-1">Private Beta Preview</p>
                <p className="text-[13px] text-ink-soft leading-relaxed max-w-xs">{errorNotice}</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-xs pt-2">
                <Button size="sm" variant="primary" icon="checkroom" onClick={() => navigate('/fashion-studio')}>
                  Go to Fashion Studio
                </Button>
                <Button size="sm" variant="outline" icon="photo_camera" onClick={() => navigate('/tryon-studio')}>
                  Go to Try-On Studio
                </Button>
              </div>
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
      <>
        <div className="fixed bottom-0 inset-x-0 w-full p-6 pb-8 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent phone-fixed-bottom">
          <Button size="lg" fullWidth trailingIcon="auto_awesome" disabled={!prompt} onClick={handleGenerate}>
            Generate look
          </Button>
        </div>
      </>
    </div>
  );
};

export default AIStudio;
