import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Section {
  title: string;
  content: string[];
}

const sections: Section[] = [
  {
    title: '1. Acceptance of Terms',
    content: [
      'By accessing or using the ZipRIGHT mobile application, website, or any related services (collectively, "Platform"), you ("User") agree to be legally bound by these Terms of Use ("Terms"). If you do not agree with any part of these Terms, you must immediately cease using the Platform.',
      'These Terms constitute a binding legal agreement between you and ZipRIGHT (registered under Indian law, with principal office in Patna, Bihar, India). Use of the Platform constitutes your electronic acceptance equivalent to a physical signature under the Information Technology Act, 2000.',
    ],
  },
  {
    title: '2. Eligibility',
    content: [
      'You must be at least 18 years of age to use this Platform. By registering, you represent and warrant that you are 18 or older and have the legal capacity to enter into binding agreements under applicable law.',
      'Users below 18 may only use the Platform under the supervision of a parent or legal guardian who accepts full responsibility for their use.',
    ],
  },
  {
    title: '3. User Account & Responsibilities',
    content: [
      'You are solely responsible for maintaining the confidentiality of your account credentials. You agree to notify ZipRIGHT immediately at support@zipright.in upon any unauthorized use of your account.',
      'You agree not to use the Platform to: (a) upload false, misleading, or fraudulent information; (b) impersonate any person or entity; (c) engage in unauthorized data scraping, reverse engineering, or hacking; (d) violate any applicable Indian or international law.',
      'ZipRIGHT reserves the right to suspend or permanently terminate any account found to be in violation of these Terms, without prior notice and without liability.',
    ],
  },
  {
    title: '4. AI-Powered Services & Disclaimer',
    content: [
      'ZipRIGHT provides AI-driven size recommendations, virtual try-ons, and style suggestions. These recommendations are provided "as is" and are not guarantees of fit, quality, or suitability.',
      'ZipRIGHT disclaims all liability for inaccuracies in AI-generated outputs. You acknowledge that recommendations are based on the data you provide and may not reflect actual product sizing from third-party sellers.',
    ],
  },
  {
    title: '5. Intellectual Property',
    content: [
      'All content on the Platform, including but not limited to text, graphics, logos, AI models, software, and code, is the exclusive intellectual property of ZipRIGHT and is protected under the Copyright Act, 1957, and the Trade Marks Act, 1999.',
      'You are granted a limited, non-exclusive, non-transferable, revocable licence to access and use the Platform solely for personal, non-commercial purposes. Any reproduction, redistribution, or commercial use without prior written consent from ZipRIGHT is strictly prohibited and may result in legal action.',
    ],
  },
  {
    title: '6. User-Generated Content',
    content: [
      'By submitting content (photos, reviews, "Looks", or any other material) to the Platform, you grant ZipRIGHT a worldwide, royalty-free, perpetual, irrevocable licence to use, reproduce, adapt, and display such content for any purpose related to operating the Platform.',
      'You represent and warrant that you own or have all necessary rights to any content you submit, and that such content does not infringe any third-party intellectual property, privacy, or other rights.',
      'ZipRIGHT may remove any user-generated content at its sole discretion without liability.',
    ],
  },
  {
    title: '7. Marketplace & Transactions',
    content: [
      'ZipRIGHT operates as a platform connecting buyers and sellers. ZipRIGHT is not a party to any transaction between users and third-party sellers. ZipRIGHT does not guarantee the quality, safety, or legality of products listed by sellers.',
      'All payment disputes, refund claims, and delivery issues must be resolved between the buyer and the seller. ZipRIGHT disclaims all liability for failed transactions, counterfeit products, or losses arising from marketplace interactions.',
    ],
  },
  {
    title: '8. ZipCoins & Rewards',
    content: [
      'ZipCoins earned through the Platform have no monetary value, are non-transferable, non-refundable, and may be modified, limited, or discontinued by ZipRIGHT at any time without notice.',
      'ZipRIGHT reserves the right to revoke ZipCoins if earned through fraudulent activity.',
    ],
  },
  {
    title: '9. Limitation of Liability',
    content: [
      'To the maximum extent permitted under applicable law, ZipRIGHT, its directors, employees, and affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising from your use of the Platform.',
      'ZipRIGHT\'s total aggregate liability for any claim arising from these Terms shall not exceed ₹5,000 (Indian Rupees Five Thousand) or the amount paid by you for the service giving rise to the claim in the three months preceding the event, whichever is lower.',
    ],
  },
  {
    title: '10. Indemnification',
    content: [
      'You agree to indemnify, defend, and hold harmless ZipRIGHT, its officers, directors, employees, agents, and partners from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable legal fees) arising out of: (a) your use of the Platform; (b) your violation of these Terms; (c) your infringement of any third-party rights; or (d) any content you submit to the Platform.',
    ],
  },
  {
    title: '11. Governing Law & Dispute Resolution',
    content: [
      'These Terms are governed by and construed in accordance with the laws of India. Any dispute arising out of or related to these Terms or the Platform shall be subject to the exclusive jurisdiction of the courts in Patna, Bihar, India.',
      'Prior to initiating legal proceedings, parties agree to attempt resolution through good-faith negotiations for a period of 30 days. If unresolved, disputes may be submitted to arbitration under the Arbitration and Conciliation Act, 1996, with the seat of arbitration in Patna, Bihar.',
    ],
  },
  {
    title: '12. Privacy',
    content: [
      'Your use of the Platform is also governed by our Privacy Policy, which is incorporated herein by reference. By using the Platform, you consent to the collection and processing of your personal data as described in the Privacy Policy, in compliance with the Digital Personal Data Protection Act, 2023 (DPDP Act).',
    ],
  },
  {
    title: '13. Modifications',
    content: [
      'ZipRIGHT reserves the right to modify these Terms at any time. Material changes will be communicated via in-app notification or email. Continued use of the Platform after any modification constitutes your acceptance of the revised Terms.',
    ],
  },
  {
    title: '14. Termination',
    content: [
      'ZipRIGHT may terminate or suspend your access to the Platform immediately, without prior notice, if you breach these Terms. Upon termination, your right to use the Platform ceases immediately. Sections relating to Intellectual Property, Limitation of Liability, Indemnification, and Governing Law shall survive termination.',
    ],
  },
  {
    title: '15. Contact',
    content: [
      'For any legal notices, complaints, or queries regarding these Terms, contact us at: legal@zipright.in | ZipRIGHT, Patna, Bihar, India — 800001.',
    ],
  },
];

const TermsOfUse: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 bg-surface-0/90 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full active:scale-90 transition-transform bg-surface-2">
          <span className="material-symbols-outlined text-[20px] text-[#6157FF]">arrow_back</span>
        </button>
        <div className="text-center">
          <h1 className="text-[12px] font-bold text-[#6157FF]">Terms of Use</h1>
          <p className="text-[11px] text-ink-faint mt-0.5">Effective: April 2026</p>
        </div>
        <div className="w-10" />
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6 border-b border-line">
        <div className="flex items-center gap-4 mb-4">
          <div className="h-14 w-14 rounded-2xl bg-[#6157FF]/10 border border-[#6157FF]/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-2xl text-[#6157FF]">gavel</span>
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight" style={{ fontFamily: 'DM Sans, sans-serif' }}>
              <span className="text-ink">Zip</span><span className="text-[#6157FF]">RIGHT</span> Terms of Use
            </h2>
            <p className="text-[12px] text-ink-soft mt-0.5">Legally Binding Agreement</p>
          </div>
        </div>
        <div className="bg-[#FF4D6D]/10 border border-[#FF4D6D]/20 rounded-2xl p-4">
          <p className="text-[11px] text-ink-soft leading-relaxed">
            <span className="text-[#FF4D6D] font-bold">Important: </span>
            By using ZipRIGHT, you agree to these Terms. Violation of any clause may result in account suspension, civil liability, or legal proceedings under applicable Indian law.
          </p>
        </div>
      </div>

      {/* Sections Accordion */}
      <div className="flex-1 px-4 py-4 pb-24">
        {sections.map((section, idx) => (
          <div key={idx} className="mb-2 border border-line rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left active:scale-[0.99] transition-transform"
              onClick={() => setExpanded(expanded === idx ? null : idx)}
            >
              <span className="text-[12px] font-bold text-ink-soft pr-4 leading-tight">{section.title}</span>
              <span className="material-symbols-outlined text-[18px] text-[#6157FF] flex-shrink-0 transition-transform duration-200" style={{ transform: expanded === idx ? 'rotate(180deg)' : 'none' }}>
                expand_more
              </span>
            </button>
            {expanded === idx && (
              <div className="px-5 pb-5 border-t border-line pt-4">
                {section.content.map((para, pIdx) => (
                  <p key={pIdx} className="text-[11px] text-ink-soft leading-relaxed mb-3 last:mb-0">
                    {para}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Footer notice */}
        <div className="mt-6 p-4 bg-white/3 border border-line rounded-2xl">
          <p className="text-[12px] text-ink-faint text-center leading-relaxed">
            ZipRIGHT reserves the right to take legal action against any user violating these Terms under the Information Technology Act, 2000, Consumer Protection Act, 2019, and other applicable Indian laws.
          </p>
          <p className="text-[12px] text-[#6157FF]/60 text-center mt-2">legal@zipright.in</p>
        </div>
      </div>
    </div>
  );
};

export default TermsOfUse;
