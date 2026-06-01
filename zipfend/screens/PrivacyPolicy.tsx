import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
    icon: 'cookies',
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
    <div className="flex flex-col min-h-screen bg-[#111111] text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 bg-[#111111]/90 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full active:scale-90 transition-transform bg-white/5">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <div className="text-center">
          <h1 className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#C9A06C]">Privacy Policy</h1>
          <p className="text-[9px] text-white/30 mt-0.5">Effective: April 2026</p>
        </div>
        <div className="w-10" />
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6 border-b border-white/5">
        <div className="flex items-center gap-4 mb-4">
          <div className="h-14 w-14 rounded-2xl bg-[#C9A06C]/10 border border-[#C9A06C]/20 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-2xl text-[#C9A06C]">shield</span>
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
              <span className="text-white">Your</span> <span className="text-[#C9A06C]">Privacy</span>
            </h2>
            <p className="text-[10px] text-white/40 mt-0.5 uppercase tracking-widest">DPDP Act, 2023 Compliant</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { icon: 'no_encryption_gae', label: 'No Data Selling' },
            { icon: 'lock', label: 'AES-256 Encrypted' },
            { icon: 'verified_user', label: 'DPDP Compliant' },
          ].map(item => (
            <div key={item.label} className="bg-white/3 border border-white/5 rounded-xl p-3 flex flex-col items-center gap-1">
              <span className="material-symbols-outlined text-[16px] text-[#C9A06C]">{item.icon}</span>
              <span className="text-[9px] text-white/50 text-center font-bold uppercase tracking-wide leading-tight">{item.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-white/50 leading-relaxed">
          ZipRIGHT is committed to protecting your personal data. This Policy explains what data we collect, why, and how you can control it — in compliance with India's Digital Personal Data Protection Act, 2023.
        </p>
      </div>

      {/* Sections Accordion */}
      <div className="flex-1 px-4 py-4 pb-24">
        {sections.map((section, idx) => (
          <div key={idx} className="mb-2 border border-white/5 rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left active:scale-[0.99] transition-transform"
              onClick={() => setExpanded(expanded === idx ? null : idx)}
            >
              <div className="flex items-center gap-3 flex-1 pr-2">
                <span className="material-symbols-outlined text-[16px] text-[#C9A06C] flex-shrink-0">{section.icon}</span>
                <span className="text-[12px] font-black text-white/90 leading-tight">{section.title}</span>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[#C9A06C] flex-shrink-0 transition-transform duration-200" style={{ transform: expanded === idx ? 'rotate(180deg)' : 'none' }}>
                expand_more
              </span>
            </button>
            {expanded === idx && (
              <div className="px-5 pb-5 border-t border-white/5 pt-4">
                {section.content.map((para, pIdx) => (
                  <p key={pIdx} className="text-[11px] text-white/60 leading-relaxed mb-3 last:mb-0">
                    {para}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Contact */}
        <div className="mt-6 p-5 bg-[#C9A06C]/5 border border-[#C9A06C]/20 rounded-2xl">
          <p className="text-[10px] font-black text-[#C9A06C] uppercase tracking-widest mb-2">Contact Our Privacy Team</p>
          <p className="text-[11px] text-white/50 leading-relaxed">
            For any data protection requests, grievances, or concerns, email us at <span className="text-[#C9A06C]">privacy@zipright.in</span>. We respond within 30 days as required by the DPDP Act, 2023.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
