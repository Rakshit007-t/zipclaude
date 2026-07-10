import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow } from '../components/ui';

interface Section {
  icon: string;
  title: string;
  content: string[];
}

const sections: Section[] = [
  {
    icon: 'info',
    title: '1. Data Controller',
    content: [
      'ZipRIGHT ("we", "us", "our") is the Data Fiduciary as defined under the Digital Personal Data Protection Act, 2023 (DPDP Act) and the data controller under applicable law. Our principal office is in Patna, Bihar, India.',
      'For privacy-related queries, contact our Data Protection Officer at: privacy@zipright.in',
    ],
  },
  {
    icon: 'data_object',
    title: '2. Data We Collect',
    content: [
      'Account Information: Name, email address, phone number, date of birth, gender, and profile photo when you register.',
      'Body Measurements & Fit Data: Height, weight, size preferences, and brand-specific sizing you voluntarily provide for AI size recommendations.',
      'Device & Usage Data: Device type, OS version, IP address, app usage patterns, crash reports, and interaction logs.',
      'Photos & Images: Images you upload for Virtual Try-On, AI Avatar, or Community Looks features. These are stored securely and used solely for the AI services you request.',
      'Transaction Data: Purchase history, wishlist, cart contents, and marketplace interactions.',
      'Communications: Messages sent to our AI Stylist and customer support queries.',
    ],
  },
  {
    icon: 'psychology',
    title: '3. How We Use Your Data',
    content: [
      'To provide and improve the Platform, including AI size recommendations, virtual try-on, and personalized styling.',
      'To verify your identity and prevent fraud.',
      'To send transactional communications (OTPs, order updates) and, with your consent, promotional notifications.',
      'To comply with legal obligations under Indian law, including the DPDP Act, 2023, IT Act, 2000, and Consumer Protection Act, 2019.',
      'We do not sell, rent, or trade your personal data to third parties for marketing purposes.',
    ],
  },
  {
    icon: 'share',
    title: '4. Data Sharing',
    content: [
      'Service Providers: We share data with trusted third-party service providers (cloud infrastructure, payment processors, AI APIs) who are contractually bound to protect your data.',
      'Legal Compliance: We may disclose data when required by law, court order, or governmental authority under applicable Indian law.',
      'Business Transfers: In the event of a merger or acquisition, your data may be transferred to the successor entity, subject to the same privacy protections.',
      'We do not share your body measurement data or personal fit profile with sellers without your explicit consent.',
    ],
  },
  {
    icon: 'lock',
    title: '5. Data Security',
    content: [
      'We implement industry-standard security measures including AES-256 encryption for data at rest, TLS 1.3 for data in transit, and access controls limiting data access to authorized personnel only.',
      'Firebase Authentication is used for secure login, and Firestore Security Rules enforce per-user data isolation.',
      'While we take all reasonable precautions, no system is 100% secure. We encourage you to use strong passwords and to report any suspected breach immediately to security@zipright.in.',
    ],
  },
  {
    icon: 'person_check',
    title: '6. Your Rights (DPDP Act 2023)',
    content: [
      'Right to Access: You may request a copy of the personal data we hold about you.',
      'Right to Correction: You may request correction of inaccurate or incomplete data.',
      'Right to Erasure: You may request deletion of your personal data, subject to legal retention requirements.',
      'Right to Grievance Redressal: You may raise a grievance with our Data Protection Officer at privacy@zipright.in. We will respond within 30 days.',
      'Right to Nominate: You may nominate an individual to exercise your rights in the event of death or incapacity.',
      'To exercise any of these rights, email us at privacy@zipright.in with your registered account email and a description of your request.',
    ],
  },
  {
    icon: 'child_care',
    title: '7. Children\'s Privacy',
    content: [
      'ZipRIGHT is not intended for users under 18 years of age. We do not knowingly collect personal data from children. If we become aware that a child under 18 has provided personal data, we will delete it promptly.',
      'If you believe a child has used our Platform, please contact us at privacy@zipright.in.',
    ],
  },
  {
    icon: 'cookie',
    title: '8. Cookies & Local Storage',
    content: [
      'We use browser local storage and device storage to remember your preferences (theme, swipe hints, session state). We do not use third-party advertising cookies.',
      'You can clear app data through your device settings, though this will reset your in-app preferences.',
    ],
  },
  {
    icon: 'history',
    title: '9. Data Retention',
    content: [
      'We retain your personal data for as long as your account is active or as necessary to provide services. After account deletion, we retain certain data for up to 90 days for fraud prevention and legal compliance, after which it is permanently deleted.',
      'Body measurement data is deleted within 30 days of account deletion.',
    ],
  },
  {
    icon: 'link',
    title: '10. Third-Party Links',
    content: [
      'The Platform may contain links to third-party websites or affiliate product pages. We are not responsible for the privacy practices of such third parties. We encourage you to review the privacy policies of any third-party services you access.',
    ],
  },
  {
    icon: 'update',
    title: '11. Changes to This Policy',
    content: [
      'We may update this Privacy Policy from time to time. Material changes will be notified via in-app notification or email at least 7 days before taking effect. Continued use of the Platform after the effective date constitutes your acceptance of the updated Policy.',
    ],
  },
  {
    icon: 'contact_support',
    title: '12. Grievance Officer',
    content: [
      'In accordance with the Information Technology Act, 2000 and the DPDP Act, 2023, the name and contact details of our Grievance Officer are:',
      'Name: Rakshit (Founder, ZipRIGHT) | Email: privacy@zipright.in | Address: Patna, Bihar, India — 800001 | Response Time: Within 30 days of receipt of grievance.',
    ],
  },
];

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Privacy Policy" subtitle="Effective April 2026" onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="px-6 pt-8 pb-7">
        <Eyebrow className="mb-3">DPDP Act 2023 compliant</Eyebrow>
        <h2 className="font-display text-[30px] leading-tight font-light mb-5">
          Your <em className="font-medium text-brand">privacy.</em>
        </h2>
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {[
            { icon: 'block', label: 'No data selling' },
            { icon: 'lock', label: 'AES-256 encrypted' },
            { icon: 'verified_user', label: 'DPDP compliant' },
          ].map(item => (
            <div key={item.label} className="bg-surface-1 border border-line rounded-card p-3 flex flex-col items-center gap-2 text-center">
              <span className="material-symbols-outlined text-[17px] text-brand" aria-hidden="true">{item.icon}</span>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft leading-tight">{item.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-soft leading-relaxed">
          ZipRIGHT is committed to protecting your personal data. This Policy explains what data we collect, why, and how you can control it — in compliance with India's Digital Personal Data Protection Act, 2023.
        </p>
      </div>

      {/* Sections Accordion */}
      <div className="flex-1 px-6 pb-24">
        {sections.map((section, idx) => {
          const open = expanded === idx;
          return (
            <div key={idx} className="border-b border-line">
              <button
                className="w-full flex items-center justify-between gap-3 py-4 text-left"
                onClick={() => setExpanded(open ? null : idx)}
                aria-expanded={open}
              >
                <div className="flex items-center gap-3 flex-1 pr-2 min-w-0">
                  <span className="material-symbols-outlined text-[17px] text-ink-faint flex-shrink-0" aria-hidden="true">{section.icon}</span>
                  <span className="text-[13.5px] font-medium text-ink leading-snug">{section.title}</span>
                </div>
                <span className="material-symbols-outlined text-[18px] text-ink-faint flex-shrink-0 transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true">
                  expand_more
                </span>
              </button>
              {open && (
                <div className="pb-5 pl-8">
                  {section.content.map((para, pIdx) => (
                    <p key={pIdx} className="text-[12.5px] text-ink-soft leading-relaxed mb-3 last:mb-0">
                      {para}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Contact */}
        <div className="mt-8 p-5 rounded-card bg-surface-1 border border-line">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand mb-2">Contact our privacy team</p>
          <p className="text-[12.5px] text-ink-soft leading-relaxed">
            For any data protection requests, grievances, or concerns, email us at <a href="mailto:privacy@zipright.in" className="text-brand">privacy@zipright.in</a>. We respond within 30 days as required by the DPDP Act, 2023.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
