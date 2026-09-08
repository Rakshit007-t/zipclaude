import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Wordmark, Divider, Breadcrumbs } from '../components/ui';

const PRINCIPLES = [
  { icon: 'straighten', title: 'Fit, first', body: 'Every feature serves our core mission — helping you discover your best fit across brands with intelligent, measurement-driven insights.' },
  { icon: 'visibility', title: 'See before you buy', body: 'AI-assisted try-on visualizes garments on your digital profile to provide an informed preview before you shop.' },
  { icon: 'lock', title: 'Yours, privately', body: 'Your body measurements and photos power your sizing results and are never sold or shared with advertisers.' },
];

const AboutUs: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="About us" headingTag="span" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-8 pb-24 max-w-xl mx-auto w-full">
        {/* Breadcrumb path */}
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'About Us' },
          ]}
          className="mb-4"
        />

        {/* Manifesto */}
        <Eyebrow className="mb-4">The Fit Atelier</Eyebrow>
        <h1 className="font-display text-[40px] leading-[1.05] font-light mb-6">
          We exist so fit is never a <em className="font-medium text-brand">guess.</em>
        </h1>
        <p className="text-ink-soft text-[15px] leading-relaxed max-w-[360px]">
          ZipRIGHT is an AI fashion-tech house built to elevate personal styling. We map brand size charts, learn from fit feedback, and synthesize realistic try-on previews to help you shop with confidence.
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

        <Divider className="my-10" label="Business & Legal Details" />

        <div className="rounded-xl border border-surface-3 bg-surface-1/60 p-5 space-y-3 text-[12.5px] text-ink-soft leading-relaxed">
          <p>
            <strong className="text-ink">Entity:</strong> ZipRIGHT Technologies Private Limited
          </p>
          <p>
            <strong className="text-ink">Corporate Office:</strong> Koramangala Industrial Layout, 5th Block, Bengaluru, Karnataka 560095, India.
          </p>
          <p>
            <strong className="text-ink">Contact:</strong> legal@zipright.com · support@zipright.com
          </p>
          <p className="pt-2 border-t border-surface-3 text-[11.5px] text-ink-faint">
            <strong className="text-ink-soft">Trademark & Brand Disclaimer:</strong> All third-party trademarks, brand names, product names, and logos displayed or mentioned are the registered or unregistered trademarks of their respective owners. Mention of them is made strictly under nominative fair use for descriptive, comparative sizing reference and does not imply sponsorship, partnership, or endorsement. Sizing guidance and virtual try-ons are advisory tools provided &ldquo;as is&rdquo;.
          </p>
        </div>

        <div className="mt-14 flex flex-col items-center text-center">
          <Wordmark size="md" className="mb-3" />
          <p className="text-ink-faint text-[11px] uppercase tracking-[0.16em]">ZipRIGHT Technologies Pvt. Ltd. · All Rights Reserved</p>
        </div>
      </div>
    </div>
  );
};

export default AboutUs;
