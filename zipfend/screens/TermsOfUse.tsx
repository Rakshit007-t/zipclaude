import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Button, Breadcrumbs } from '../components/ui';

interface Section {
  title: string;
  content: string[];
}

const sections: Section[] = [
  {
    title: '1. Acceptance of Terms & Legal Binding',
    content: [
      'By accessing, downloading, registering with, or using the ZipRIGHT mobile web application, APIs, or associated services (collectively, the "Platform"), you ("User") agree to be bound by these Terms of Use ("Terms"). If you do not agree with any part of these Terms, you must cease using the Platform immediately.',
      'These Terms constitute a legally binding electronic contract between you and ZipRIGHT Technologies (registered under the laws of India, with principal office in Patna, Bihar, India). Your access and use constitutes electronic acceptance under the Information Technology Act, 2000 and applicable international electronic commerce standards.',
    ],
  },
  {
    title: '2. Eligibility & Account Responsibilities',
    content: [
      '• Age Requirement: You must be at least eighteen (18) years of age to establish an account or perform virtual try-on scans.',
      '• Account Security: You are solely responsible for safeguarding your login credentials and for all activities occurring under your account. Notify us immediately at security@zipright.in if you suspect unauthorized access.',
      '• True and Accurate Data: You agree to provide accurate, truthful personal height and fit parameters. Misleading or fraudulent input compromises sizing algorithms and constitutes a violation of these Terms.',
    ],
  },
  {
    title: '3. AI-Powered Services & Sizing Disclaimers ("AS IS")',
    content: [
      '• Algorithmic Estimation: ZipRIGHT provides size recommendations, fit confidence scores, and virtual try-on visualizations powered by machine learning algorithms and computer vision models. These outputs are probabilistic estimations designed to assist your shopping decisions.',
      '• NO EXPRESS WARRANTY OF FIT: Recommendations are provided on an "AS IS" and "AS AVAILABLE" basis. ZipRIGHT does not warrant or guarantee that a recommended size will achieve a 100% perfect physical fit, nor that virtual try-on renders will perfectly match physical textile drape, elasticity, or garment color.',
      '• User Sizing Verification: Garment sizing variations occur across manufacturers, fabric blends, and production batches. You remain responsible for inspecting merchant size charts and product descriptions before finalizing purchases.',
    ],
  },
  {
    title: '4. Third-Party Trademarks & Nominative Fair Use Disclaimer',
    content: [
      '• Ownership of Marks: All third-party brand names, company names, trademarks, service marks, and trade dress referenced on the Platform (including but not limited to Zara, H&M, Nike, Uniqlo, Levi’s, Adidas, and Roadster) are the exclusive property of their respective owners.',
      '• Nominative Fair Use: Any reference to third-party brands, sizing charts, or garments on ZipRIGHT is made solely for descriptive, comparative, and sizing compatibility purposes under the doctrine of nominative fair use (Section 30 of the Trade Marks Act, 1999).',
      '• No Endorsement: Mention of third-party brand trademarks does not imply sponsorship, affiliation, partnership, or endorsement by the trademark holder of ZipRIGHT or its sizing technology.',
    ],
  },
  {
    title: '5. Marketplace & Intermediary Role',
    content: [
      '• Intermediary Safe Harbor: In accordance with Section 79 of the Information Technology Act, 2000 and the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, ZipRIGHT functions as an intermediary connecting consumers with product information and merchant catalog listings.',
      '• Independent Transactions: When you purchase garments through outward links, the transaction, delivery, invoicing, and warranty exist strictly between you and the respective third-party retailer.',
      '• Affiliate Disclosure: In compliance with FTC Endorsement Guides (16 CFR Part 255) and Indian Consumer Protection E-Commerce Rules, ZipRIGHT discloses that we may earn affiliate commissions from qualifying purchases made via outbound product links at no additional cost to you.',
    ],
  },
  {
    title: '6. User Content & Image Processing License',
    content: [
      '• Ownership: You retain full copyright and ownership of any photographs, avatar images, reviews, or outfit compositions ("Looks") you upload.',
      '• Limited License: By uploading photos for virtual try-on or SmartFit scanning, you grant ZipRIGHT a limited, worldwide, non-exclusive, royalty-free license solely to process, render, resize, and display your image to execute the AI styling and try-on features you request.',
      '• Privacy Safeguards: We do not sell your photos or biometric representations. Raw scan photos are automatically purged from active servers within thirty (30) days in accordance with our Privacy Policy.',
      '• Prohibited Content: You agree not to upload any image containing nudity, non-consensual imagery of third parties, copyrighted photography you do not own, or defamatory content.',
    ],
  },
  {
    title: '7. Intellectual Property & Prohibited Uses',
    content: [
      '• ZipRIGHT IP: The algorithms, user interface, brand designs, software architecture, and proprietary try-on synthesis pipelines are the exclusive intellectual property of ZipRIGHT Technologies, protected by the Copyright Act, 1957 and applicable patent/trade secret laws.',
      '• Restrictions: You agree not to: (a) scrape, crawl, or harvest catalog or size data using automated bots; (b) reverse engineer or decompile any portion of the backend APIs or client code; (c) bypass security firewalls or tamper with Firestore authorization rules; (d) deploy deepfakes or harmful imagery.',
    ],
  },
  {
    title: '8. Subscriptions, Fees & Refund Policy',
    content: [
      '• Pricing Transparency: All subscription tiers (Starter, Pro, Elite) and token costs are disclosed upfront with applicable taxes. No hidden recurring fees are billed without explicit consent.',
      '• Refund Terms: Cancellations and refund requests are governed by our comprehensive Refund Policy, which provides a 7-day cooling-off window for unused subscription plans.',
    ],
  },
  {
    title: '9. Limitation of Liability',
    content: [
      '• Maximum Consequential Waiver: To the maximum extent permitted by applicable law, ZipRIGHT, its founders, officers, and contractors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, return shipping costs, or data corruption.',
      '• Aggregate Liability Cap: In all events, ZipRIGHT’s total aggregate liability for all claims arising out of or relating to the Platform shall not exceed the greater of ₹5,000 (Indian Rupees Five Thousand) or the total fees paid by you to ZipRIGHT in the three (3) months preceding the incident.',
    ],
  },
  {
    title: '10. Indemnification',
    content: [
      'You agree to defend, indemnify, and hold harmless ZipRIGHT Technologies, its officers, employees, and licensors from and against any third-party claims, liabilities, damages, and legal costs arising from: (a) your breach of these Terms; (b) your violation of any third-party intellectual property or privacy rights; or (c) any content you upload to the Platform.',
    ],
  },
  {
    title: '11. Governing Law & Dispute Resolution',
    content: [
      '• Governing Law: These Terms are governed by and construed in accordance with the substantive laws of the Republic of India, without regard to conflict of law principles.',
      '• Mandatory Arbitration: Any dispute arising out of or related to these Terms shall be referred to and finally resolved by sole-arbitrator arbitration under the Arbitration and Conciliation Act, 1996. The seat and venue of arbitration shall be Patna, Bihar, India, and the proceedings shall be conducted in English.',
      '• Court Jurisdiction: Subject to arbitration, the competent courts in Patna, Bihar, India shall have exclusive jurisdiction.',
    ],
  },
  {
    title: '12. Legal Notices & Contact Details',
    content: [
      'For formal legal notices, trademark inquiries, or terms questions:',
      'Email: legal@zipright.in | Alternate: privacy@zipright.in',
      'Address: ZipRIGHT Technologies, Legal Department, Patna, Bihar, India — 800001.',
    ],
  },
];

const TermsOfUse: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Terms of Use" headingTag="span" subtitle="Effective April 2026" onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="px-6 pt-6 pb-7 max-w-2xl mx-auto w-full">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Settings', href: '/settings' },
            { label: 'Terms of Use' },
          ]}
          className="mb-4"
        />
        <Eyebrow className="mb-3">Legal Agreement</Eyebrow>
        <h1 className="font-display text-[30px] leading-tight font-light mb-4">
          Terms of <em className="font-medium text-brand">Service.</em>
        </h1>

        {/* Warning card */}
        <div className="rounded-card border border-brand/30 bg-surface-1 p-4 mb-5 shadow-sm">
          <p className="text-[12.5px] text-ink-soft leading-relaxed">
            <span className="text-brand font-semibold">Important Notice: </span>
            By using ZipRIGHT, you agree to these Terms. AI size predictions and virtual try-ons are estimations provided for convenience without express warranty of perfect fit.
          </p>
        </div>

        {/* Policy Links */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/privacy-policy')} icon="policy">
            Privacy Policy
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/cookie-policy')} icon="cookie">
            Cookie Policy
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/refund-policy')} icon="payments">
            Refund Policy
          </Button>
        </div>
      </div>

      {/* Sections Accordion */}
      <div className="flex-1 px-6 pb-24">
        {sections.map((section, idx) => {
          const open = expanded === idx;
          return (
            <div key={idx} className="border-b border-line">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-4 py-4 text-left"
                onClick={() => setExpanded(open ? null : idx)}
                aria-expanded={open}
              >
                <span className="text-[13.5px] font-medium text-ink pr-2 leading-snug">{section.title}</span>
                <span
                  className="material-symbols-outlined text-[18px] text-ink-faint flex-shrink-0 transition-transform duration-200"
                  style={{ transform: open ? 'rotate(180deg)' : 'none' }}
                  aria-hidden="true"
                >
                  expand_more
                </span>
              </button>
              {open && (
                <div className="pb-5 pr-2 flex flex-col gap-2.5">
                  {section.content.map((p, i) => (
                    <p key={i} className="text-[12.5px] text-ink-soft leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Contact Legal Team */}
        <div className="mt-8 rounded-card border border-line bg-surface-1 p-5 text-center">
          <p className="text-[13px] text-ink font-medium mb-1">Questions regarding our Terms?</p>
          <p className="text-[11.5px] text-ink-soft mb-3">Our legal department is available for inquiries.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (window.location.href = 'mailto:legal@zipright.in?subject=Terms%20of%20Use%20Inquiry')}
            icon="gavel"
          >
            Contact Legal Team
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TermsOfUse;
