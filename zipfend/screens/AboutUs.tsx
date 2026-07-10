import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Wordmark, Divider } from '../components/ui';

const PRINCIPLES = [
  { icon: 'straighten', title: 'Fit, first', body: 'Every feature serves one promise — that what you buy actually fits, in any brand.' },
  { icon: 'visibility', title: 'See before you buy', body: 'Virtual try-on renders the garment on you, so nothing is a gamble.' },
  { icon: 'lock', title: 'Yours, privately', body: 'Your measurements and photos power your results and nothing else.' },
];

const AboutUs: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="About us" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-10 pb-24">
        {/* Manifesto */}
        <Eyebrow className="mb-4">The Fit Atelier</Eyebrow>
        <h2 className="font-display text-[40px] leading-[1.05] font-light mb-6">
          We exist so fit is never a <em className="font-medium text-brand">guess.</em>
        </h2>
        <p className="text-ink-soft text-[15px] leading-relaxed max-w-[340px]">
          ZipRIGHT is an AI fashion-tech house built around one idea: you should know your true size and see a garment on your own body before you ever check out. We work alongside the stores you already love — reading their real size charts, learning from your fit feedback, and rendering looks on you.
        </p>

        <Divider className="my-10" label="What we believe" />

        <div className="flex flex-col gap-8">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="flex gap-5">
              <span className="material-symbols-outlined text-brand text-[22px] mt-0.5 shrink-0" aria-hidden="true">{p.icon}</span>
              <div>
                <h3 className="font-display text-[19px] font-medium text-ink mb-1">{p.title}</h3>
                <p className="text-ink-soft text-[13.5px] leading-relaxed">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center text-center">
          <Wordmark size="md" className="mb-3" />
          <p className="text-ink-faint text-[11px] uppercase tracking-[0.16em]">AI fashion tech · Est. for fit</p>
        </div>
      </div>
    </div>
  );
};

export default AboutUs;
