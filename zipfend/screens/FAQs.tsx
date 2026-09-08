import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AppBar, Eyebrow, Button, Breadcrumbs } from '../components/ui';

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
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="FAQs" headingTag="span" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-8 pb-24 w-full max-w-2xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Settings', href: '/settings' },
            { label: 'FAQs' },
          ]}
          className="mb-4"
        />
        <Eyebrow className="mb-3">Help</Eyebrow>
        <h1 className="font-display text-[34px] leading-[1.06] font-light mb-2">
          Questions,
          <br />
          <em className="font-medium text-brand">answered.</em>
        </h1>
        <p className="text-ink-soft text-[14px] mb-8">Everything about sizing, try-on, and your data.</p>

        <div className="flex flex-col">
          {FAQ_ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={i} className="border-b border-line">
                <button
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left"
                >
                  <span className="text-[15px] font-medium leading-snug text-ink">{item.q}</span>
                  <motion.span
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="material-symbols-outlined text-ink-faint text-[20px] shrink-0"
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
                      <p className="pb-5 pr-8 text-[13.5px] leading-relaxed text-ink-soft">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-card border border-line bg-surface-1 p-6 text-center">
          <p className="text-[13.5px] text-ink-soft mb-4 leading-relaxed">Still curious? The AI Stylist can answer styling questions any time.</p>
          <Button variant="outline" trailingIcon="arrow_forward" onClick={() => navigate('/stylist')}>
            Ask the stylist
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FAQs;
