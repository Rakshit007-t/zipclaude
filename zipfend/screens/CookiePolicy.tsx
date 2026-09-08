import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Button, Breadcrumbs } from '../components/ui';
import { openCookiePreferences } from '../services/cookieConsent';

interface StorageCategory {
  title: string;
  badge: string;
  badgeTone: 'brand' | 'neutral';
  description: string;
  items: {
    key: string;
    purpose: string;
    duration: string;
    type: string;
  }[];
}

const STORAGE_CATEGORIES: StorageCategory[] = [
  {
    title: '1. Strictly Necessary Storage',
    badge: 'Always Active',
    badgeTone: 'neutral',
    description:
      'These local storage items and cookies are technically required for core application operations, user authentication, security isolation, and rendering your chosen visual preferences. They cannot be turned off.',
    items: [
      {
        key: 'firebase:authUser:*',
        purpose: 'Authenticates and isolates your logged-in session securely via Firebase Authentication.',
        duration: 'Session / Persistent until sign-out',
        type: 'IndexedDB / LocalStorage',
      },
      {
        key: 'zipright_theme',
        purpose: 'Stores your display mode preference (dark atelier vs. light gallery theme).',
        duration: 'Persistent until cleared',
        type: 'LocalStorage',
      },
      {
        key: 'zipright_addresses:*',
        purpose: 'Stores saved delivery addresses locally on your device for fast, private re-use.',
        duration: 'Persistent until cleared',
        type: 'LocalStorage',
      },
      {
        key: 'zipright_closet_*',
        purpose: 'Caches your cart and saved items locally so your wardrobe is responsive offline.',
        duration: 'Persistent until cleared',
        type: 'LocalStorage',
      },
      {
        key: 'zipright_active_vto_job',
        purpose: 'Tracks asynchronous virtual try-on render jobs so results populate upon completion.',
        duration: 'Session / 24 hours',
        type: 'LocalStorage',
      },
      {
        key: 'zipright_consent_preferences',
        purpose: 'Records your explicit informed consent choices and category opt-in/opt-out status.',
        duration: '12 months',
        type: 'LocalStorage',
      },
    ],
  },
  {
    title: '2. Functional & Personalization Storage',
    badge: 'Optional (Opt-In)',
    badgeTone: 'brand',
    description:
      'Functional storage enables enhanced customization, style journey streaks, and saved outfit drafts. These are enabled only if you provide consent.',
    items: [
      {
        key: 'zipright_style_journey',
        purpose: 'Maintains daily style streak score and styling progression milestones on-device.',
        duration: 'Persistent until cleared',
        type: 'LocalStorage',
      },
      {
        key: 'zipright_draft_look',
        purpose: 'Stores draft lookbook images and tags before you choose to publish or discard them.',
        duration: 'Session / 7 days',
        type: 'LocalStorage',
      },
      {
        key: 'zr_saved_looks_data',
        purpose: 'Caches editorial and community looks saved to your personal lookbook.',
        duration: 'Persistent until cleared',
        type: 'LocalStorage',
      },
    ],
  },
  {
    title: '3. Analytics & Performance Storage',
    badge: 'Optional (Opt-In)',
    badgeTone: 'brand',
    description:
      'Analytics storage helps us measure recommendation model accuracy, fit feedback reliability, and platform stability. No cross-site advertising or third-party behavioral trackers are used.',
    items: [
      {
        key: 'zr_tracked_recommendation_*',
        purpose: 'Deduplicates fit feedback and size outcome telemetry so algorithms learn accurately.',
        duration: 'Session',
        type: 'SessionStorage',
      },
      {
        key: 'zr_salon_views',
        purpose: 'Prevents duplicate view counters when browsing curated editorial collections.',
        duration: 'Session / 24 hours',
        type: 'LocalStorage',
      },
    ],
  },
];

const SECTIONS = [
  {
    icon: 'info',
    title: '1. What Are Cookies and Web Storage?',
    content: [
      'Cookies are small text files stored on your device by a web server. Web storage (comprising Local Storage and Session Storage) and IndexedDB allow web applications to store data directly and securely within your browser with greater capacity and zero automatic transmission to network headers.',
      'ZipRIGHT primarily utilizes modern HTML5 Web Storage rather than traditional tracking cookies, giving you greater control, superior speed, and reduced data leakage.',
    ],
  },
  {
    icon: 'gavel',
    title: '2. Legal Basis for Storage & Consent',
    content: [
      'Under the Digital Personal Data Protection Act, 2023 (DPDP Act, India), the European Union General Data Protection Regulation (GDPR), and the ePrivacy Directive (Directive 2002/58/EC):',
      '• Strictly Necessary storage is processed on the grounds of legitimate interests and contract performance (providing requested app features).',
      '• Functional and Analytics storage requires your prior, affirmative, and revocable consent.',
      'We never deploy non-essential storage or third-party marketing tracking without your explicit opt-in.',
    ],
  },
  {
    icon: 'tune',
    title: '3. Managing & Revoking Your Consent',
    content: [
      'You have complete control over non-essential cookies and storage at any time:',
      '• You can open the in-app Cookie Preferences Manager at any time using the button below or via Settings > Support & Legal > Cookie Preferences.',
      '• You can also clear all cached storage and cookies through your web browser settings (Chrome, Safari, Firefox, or Edge). Please note that clearing essential storage will log you out and reset your visual preferences.',
    ],
  },
  {
    icon: 'hub',
    title: '4. Third-Party Services & SDKs',
    content: [
      '• Firebase (Google LLC): Authenticates your account, isolates Firestore security records, and hosts encrypted try-on images. Compliant with ISO 27001, SOC 2, and GDPR standard contractual clauses.',
      '• Razorpay: Loads our secure payment gateway checkout library solely when initiating transaction flows.',
      '• Google Fonts: Styles application typography using cached web fonts loaded with privacy-preserving headers.',
      '• MediaPipe (Google LLC): Performs on-device, client-side pose and landmark detection. No raw video feed or pose coordinates are shared with external advertising networks.',
    ],
  },
  {
    icon: 'contact_support',
    title: '5. Questions & Grievance Redressal',
    content: [
      'For inquiries regarding our use of cookies, storage technologies, or your privacy rights, please contact our Data Protection and Grievance Officer:',
      'Email: privacy@zipright.in | Postal: ZipRIGHT Technologies, Patna, Bihar, India — 800001.',
      'Response Time: Within 30 days as mandated by applicable law.',
    ],
  },
];

const CookiePolicy: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Cookie Policy" headingTag="span" subtitle="Effective April 2026" onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="px-6 pt-6 pb-6 max-w-2xl mx-auto w-full">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/home' },
            { label: 'Settings', href: '/settings' },
            { label: 'Cookie Policy' },
          ]}
          className="mb-4"
        />
        <Eyebrow className="mb-3">Transparency & Consent</Eyebrow>
        <h1 className="font-display text-[30px] leading-tight font-light mb-4">
          Cookies &amp; <em className="font-medium text-brand">Storage.</em>
        </h1>
        <p className="text-[13.5px] text-ink-soft leading-relaxed mb-6">
          This Cookie Policy explains how ZipRIGHT uses cookies, browser local storage, and similar technologies to deliver our fit atelier experience, respect your privacy, and adhere to global consent standards.
        </p>

        {/* Action button to open preference modal */}
        <div className="rounded-card border border-brand/30 bg-surface-1 p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-[13.5px] font-semibold text-ink">Cookie &amp; Storage Preferences</p>
            <p className="text-[11.5px] text-ink-soft mt-0.5">Change or withdraw your consent settings at any moment.</p>
          </div>
          <Button size="sm" variant="accent" onClick={openCookiePreferences} icon="tune">
            Manage Preferences
          </Button>
        </div>

        {/* Feature summary cards */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {[
            { icon: 'lock', label: 'Zero Ad Trackers' },
            { icon: 'verified_user', label: 'Opt-In Only' },
            { icon: 'history', label: '100% User Control' },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-surface-1 border border-line rounded-card p-3 flex flex-col items-center gap-1.5 text-center"
            >
              <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-soft leading-tight">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Storage Inventory Categories */}
      <div className="px-6 pb-6 flex flex-col gap-6">
        <Eyebrow className="ml-1">Storage Itemization</Eyebrow>
        {STORAGE_CATEGORIES.map((cat) => (
          <div key={cat.title} className="bg-surface-1 rounded-card border border-line p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] font-semibold text-ink">{cat.title}</h2>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  cat.badgeTone === 'brand' ? 'bg-brand-soft text-brand' : 'bg-surface-3 text-ink-soft'
                }`}
              >
                {cat.badge}
              </span>
            </div>
            <p className="text-[12.5px] text-ink-soft leading-relaxed mb-4">{cat.description}</p>
            <div className="divide-y divide-line border-t border-line">
              {cat.items.map((item) => (
                <div key={item.key} className="py-3 flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <code className="text-[11.5px] font-mono font-semibold text-brand bg-surface-2 px-1.5 py-0.5 rounded">
                      {item.key}
                    </code>
                    <span className="text-[10.5px] text-ink-faint shrink-0">{item.duration}</span>
                  </div>
                  <p className="text-[12px] text-ink-soft leading-relaxed mt-0.5">{item.purpose}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Policy Details Accordion */}
      <div className="px-6 pb-24 flex flex-col gap-3">
        <Eyebrow className="ml-1 mb-2">Policy Details</Eyebrow>
        {SECTIONS.map((section, idx) => {
          const open = expanded === idx;
          return (
            <div key={idx} className="border-b border-line">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-4 py-4 text-left"
                onClick={() => setExpanded(open ? null : idx)}
                aria-expanded={open}
              >
                <div className="flex items-center gap-2.5 min-w-0">
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
                    <p key={i} className="text-[13px] text-ink-soft leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CookiePolicy;
