import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Button, Breadcrumbs } from '../components/ui';

interface Section {
  icon: string;
  title: string;
  content: string[];
}

const sections: Section[] = [
  {
    icon: 'info',
    title: '1. Data Controller & Scope',
    content: [
      'ZipRIGHT Technologies ("ZipRIGHT", "we", "us", or "our") acts as the Data Fiduciary under the Digital Personal Data Protection Act, 2023 (DPDP Act, India) and the Data Controller under the General Data Protection Regulation (GDPR, EU/UK) and California Consumer Privacy Act / CPRA (California, USA).',
      'Our principal registered office is located in Patna, Bihar, India — 800001. For any data protection inquiries, contact our dedicated Data Protection & Grievance Officer at privacy@zipright.in.',
    ],
  },
  {
    icon: 'data_object',
    title: '2. Data We Collect & Data Minimization',
    content: [
      'We strictly adhere to the principle of Data Minimization: we collect only personal data that is adequate, relevant, and strictly necessary for the purpose of accurate sizing, style recommendations, and virtual try-on visualization:',
      '• Account Information: Name, verified email address, phone number, and optional profile photo.',
      '• Fit & Sizing Metrics: Voluntary self-reported height, weight, preferred brand sizing (e.g. Zara, H&M, Nike), waist size, and garment ease preferences.',
      '• Technical & Session Storage: Minimal on-device storage for authentication, security tokens, active try-on job IDs, and user display mode (dark/light theme).',
      '• Transaction Records: In-app purchase records, saved wishlist items, and closet bookmarks.',
      '• What We Do NOT Collect: We do not access your device contacts, background microphone, continuous GPS location, or unrelated device sensors. Camera access is strictly on-demand for virtual try-on and body measurement scans.',
    ],
  },
  {
    icon: 'accessibility_new',
    title: '3. Biometric & Morphological Body Data Notice (BIPA & GDPR Art. 9)',
    content: [
      'ZipRIGHT takes extraordinary care with images of your face and body:',
      '• Purpose Specification: Photographs and live camera feeds provided for SmartFit Scan or Virtual Try-On are processed solely to compute body landmark geometry and superimpose garments onto your silhouette.',
      '• No Sale or Commercial Exploitation: In strict compliance with the Illinois Biometric Information Privacy Act (740 ILCS 14/) and GDPR Article 9, ZipRIGHT will never sell, lease, trade, or profit from your biometric identifiers or body scan data.',
      '• Retention Schedule: Raw body scan photographs uploaded for sizing analysis are automatically purged from our active processing servers within thirty (30) days. Computed fit measurements are saved to your private profile until you choose to delete them.',
      '• Withdrawal of Consent: You may request the immediate deletion of all stored body data and try-on history at any time through Settings > Delete Account or by emailing privacy@zipright.in.',
    ],
  },
  {
    icon: 'psychology',
    title: '4. How We Use Your Data & Lawful Bases',
    content: [
      'We process your personal information under the following lawful grounds:',
      '• Performance of Contract: To generate AI size recommendations, process virtual try-on jobs, manage your saved closet, and deliver customer support.',
      '• Explicit Informed Consent: For processing camera feeds, body scan images, and non-essential functional/analytics cookies.',
      '• Compliance with Legal Obligations: Under the Information Technology Act, 2000, the Consumer Protection (E-Commerce) Rules, 2020, and the DPDP Act, 2023.',
      'We do not train general-purpose public AI models on your private personal photos without your explicit written authorization.',
    ],
  },
  {
    icon: 'share',
    title: '5. Third-Party Service Providers & Sub-processors',
    content: [
      'We share data exclusively with trusted technical infrastructure providers who are bound by stringent Data Processing Agreements (DPAs):',
      '• Google Cloud / Firebase: Secure hosting, database storage, and authentication with AES-256 encryption at rest and TLS 1.3 in transit.',
      '• Razorpay: PCI-DSS Level 1 compliant payment gateway for processing subscription and gifting payments. ZipRIGHT never stores your full credit card number or CVV.',
      '• MediaPipe (Google): Client-side landmark analysis running locally in your browser/device without transmitting raw camera video.',
      '• Affiliate Merchants: When you click outward product links, you are directed to the merchant’s website. We share an anonymous referral identifier to credit the referral, but never share your personal measurements with sellers.',
    ],
  },
  {
    icon: 'lock',
    title: '6. Security Safeguards & Encryption',
    content: [
      'We employ bank-grade security safeguards:',
      '• End-to-end TLS 1.3 encryption for all data in transit and AES-256 encryption for data stored in Google Cloud / Firebase.',
      '• Strict Firestore per-user security isolation rules preventing unauthorized cross-tenant data access.',
      '• Regular automated vulnerability scans and strict principle-of-least-privilege access controls.',
      'In the unlikely event of a personal data breach, we will notify affected users and the Data Protection Board within 72 hours as required by law.',
    ],
  },
  {
    icon: 'person_check',
    title: '7. Your Global Privacy Rights',
    content: [
      'Regardless of your geographic location, ZipRIGHT honors universal privacy rights:',
      '• Right to Access & Portability: Request an export of your stored fit profile, transaction history, and account data.',
      '• Right to Correction: Edit or update inaccurate measurements or profile details at any time in Edit Profile.',
      '• Right to Erasure ("Right to be Forgotten"): Permanently delete your account and associated fit data via Settings > Delete Account.',
      '• Right to Withdraw Consent: Turn off non-essential cookies via our Cookie Policy or revoke camera permissions in browser settings.',
      '• California Rights (CCPA/CPRA): We do not "sell" or "share" personal information for cross-context behavioral advertising. You have the right to opt-out of automated profiling.',
      '• Right to Nominate (DPDP Act): You may nominate a legal representative to exercise your data rights in the event of death or incapacity.',
    ],
  },
  {
    icon: 'cookie',
    title: '8. Cookies & Local Storage',
    content: [
      'ZipRIGHT uses browser local storage and essential session identifiers to maintain your login and aesthetic theme. We do not use third-party tracking or advertising cookies.',
      'For a detailed breakdown of all storage keys, durations, and to change your consent preferences, review our dedicated Cookie Policy.',
    ],
  },
  {
    icon: 'child_care',
    title: '9. Protection of Minors',
    content: [
      'ZipRIGHT is designed for adult consumers aged 18 and older. We do not knowingly collect personal data or biometric scan information from individuals under 18 years of age.',
      'If you become aware that a minor has submitted personal photos or data without parental consent, notify privacy@zipright.in for immediate deletion.',
    ],
  },
  {
    icon: 'history',
    title: '10. Data Retention Schedule',
    content: [
      '• Active Account Data: Retained for the lifetime of your account to maintain your saved size profiles and closet.',
      '• Raw Scan Images: Automatically deleted from processing servers within thirty (30) days.',
      '• Post-Account Deletion: Upon account deletion, all personal identifiers and fit profiles are permanently purged within thirty (30) days. Minimal transaction logs are retained for up to 90 days solely to comply with tax and anti-fraud statutory obligations.',
    ],
  },
  {
    icon: 'contact_support',
    title: '11. Grievance Redressal & Contact Details',
    content: [
      'In accordance with the Information Technology Act, 2000, the Consumer Protection Act, 2019, and the DPDP Act, 2023, the details of our Data Protection and Grievance Officer are:',
      'Name: Grievance Officer, ZipRIGHT Technologies',
      'Email: privacy@zipright.in | Alternate: support@zipright.in',
      'Address: ZipRIGHT Technologies, Patna, Bihar, India — 800001',
      'Response Time: Grievances are acknowledged within 48 hours and resolved within thirty (30) calendar days.',
    ],
  },
];

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Privacy Policy" headingTag="span" subtitle="Effective April 2026" onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="px-6 pt-6 pb-7 max-w-2xl mx-auto w-full">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Settings', href: '/settings' },
            { label: 'Privacy Policy' },
          ]}
          className="mb-4"
        />
        <Eyebrow className="mb-3">DPDP Act 2023 &amp; GDPR Compliant</Eyebrow>
        <h1 className="font-display text-[30px] leading-tight font-light mb-4">
          Your <em className="font-medium text-brand">privacy.</em>
        </h1>
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {[
            { icon: 'block', label: 'No Data Selling' },
            { icon: 'lock', label: 'AES-256 Encrypted' },
            { icon: 'verified_user', label: 'BIPA & DPDP Safe' },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-surface-1 border border-line rounded-card p-3 flex flex-col items-center gap-2 text-center"
            >
              <span className="material-symbols-outlined text-[17px] text-brand" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft leading-tight">
                {item.label}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-soft leading-relaxed mb-4">
          ZipRIGHT is committed to protecting your personal, biometric, and sizing data. This policy explains what data we collect, our strict minimization standards, and how you retain total control over your digital identity.
        </p>

        {/* Quick Links Row */}
        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/cookie-policy')} icon="cookie">
            Cookie Policy
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/refund-policy')} icon="payments">
            Refund Policy
          </Button>
        </div>
      </div>

      {/* Accordion List */}
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
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className="material-symbols-outlined text-[18px] text-brand shrink-0" aria-hidden="true">
                    {section.icon}
                  </span>
                  <span className="text-[13.5px] font-medium text-ink leading-snug">{section.title}</span>
                </div>
                <span
                  className="material-symbols-outlined text-[18px] text-ink-faint flex-shrink-0 transition-transform duration-200"
                  style={{ transform: open ? 'rotate(180deg)' : 'none' }}
                  aria-hidden="true"
                >
                  expand_more
                </span>
              </button>
              {open && (
                <div className="pb-5 pl-7 pr-2 flex flex-col gap-2.5">
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

        {/* Footer Contact Callout */}
        <div className="mt-8 rounded-card border border-line bg-surface-1 p-5 text-center">
          <p className="text-[13px] text-ink font-medium mb-1">Have questions about your data?</p>
          <p className="text-[11.5px] text-ink-soft mb-3">Our privacy team is available to assist you.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (window.location.href = 'mailto:privacy@zipright.in?subject=Privacy%20Inquiry')}
            icon="mail"
          >
            Contact Privacy Officer
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
