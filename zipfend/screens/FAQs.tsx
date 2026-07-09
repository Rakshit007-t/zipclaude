import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

const FAQ_ITEMS = [
  {
    q: 'How does the size recommendation work?',
    a: "Your Fit Profile (height, weight, key measurements, and fit preference) is compared against each product's real size chart. The engine also learns from fit feedback — every time you tell us how something fit, recommendations for that brand get sharper.",
  },
  {
    q: 'What is Virtual Try-On and how long does it take?',
    a: 'Try-On renders a garment onto your photo using AI. Fast quality takes about a minute; HD and Max take two to three. The render keeps going on our side even if you minimize or close the app — come back and your look is waiting.',
  },
  {
    q: 'Do I need to upload a photo every time?',
    a: 'No. You can save an avatar photo once and the studio will use it automatically. Uploading a fresh photo for a specific try-on always takes priority.',
  },
  {
    q: 'How do I get more accurate results?',
    a: 'Two things matter most: complete your Fit Profile (the completion meter shows what is missing), and give fit feedback after you buy — "kept", "too small", or "too big" each make your next recommendation better.',
  },
  {
    q: 'Does ZipRIGHT sell clothes directly?',
    a: 'No — ZipRIGHT works alongside the stores you already shop at. We analyze products, tell you your true size, and let you try looks on virtually; purchases happen on the brand’s own site.',
  },
  {
    q: 'Is my data private?',
    a: 'Your measurements and photos are used only to power your recommendations and try-on renders. See the Privacy Policy for full details on storage and your controls.',
  },
];

const FAQs: React.FC = () => {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-sans">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="h-12 w-12 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-[24px] text-[#6157FF]" aria-hidden="true">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">FAQs</h1>
        <div className="w-12"></div>
      </div>

      <div className="flex-1 px-5 py-8 pb-24 max-w-md mx-auto w-full">
        <h2 className="font-sans text-[34px] leading-tight mb-2">
          Questions,
          <br />
          <em className="text-[#6157FF]">answered.</em>
        </h2>
        <p className="text-ink-soft text-sm mb-8">Everything about sizing, try-on, and your data.</p>

        <div className="flex flex-col gap-3">
          {FAQ_ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={i} className="rounded-2xl border border-line bg-surface-2 overflow-hidden">
                <button
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left active:bg-surface-2 transition-colors"
                >
                  <span className="text-[14px] font-bold leading-snug">{item.q}</span>
                  <motion.span
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="material-symbols-outlined text-[#6157FF] text-[20px] shrink-0"
                    aria-hidden="true"
                  >
                    add
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-[13px] leading-relaxed text-ink-soft">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border border-[#6157FF]/20 bg-[#6157FF]/5 p-5 text-center">
          <p className="text-[13px] text-ink-soft mb-3">Still curious? The AI Stylist can answer styling questions any time.</p>
          <button
            onClick={() => navigate('/stylist')}
            className="text-[#6157FF] text-xs font-bold active:scale-95 transition-transform"
          >
            Ask the Stylist →
          </button>
        </div>
      </div>
    </div>
  );
};

export default FAQs;
