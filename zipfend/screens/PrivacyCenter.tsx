import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, ListRow } from '../components/ui';
import { openCookiePreferences } from '../services/cookieConsent';

const PrivacyCenter: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Privacy Center" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-8 pb-24">
        <Eyebrow className="mb-3">Your Data &amp; Controls</Eyebrow>
        <h2 className="font-display text-[32px] leading-tight font-light mb-3">
          In your <em className="font-medium text-brand">control.</em>
        </h2>
        <p className="text-ink-soft text-[14px] leading-relaxed mb-8 max-w-[340px]">
          Manage how your information is collected and stored. Your measurements and photos only ever power your size recommendations and private try-on renders.
        </p>

        <div className="rounded-card border border-line bg-surface-1 px-4 divide-y divide-line mb-6 shadow-sm">
          <ListRow
            icon="description"
            title="Privacy Policy"
            subtitle="DPDP Act 2023, GDPR, and BIPA safeguards"
            onClick={() => navigate('/privacy-policy')}
          />
          <ListRow
            icon="gavel"
            title="Terms of Use"
            subtitle="User agreement, AI disclaimers & IP terms"
            onClick={() => navigate('/terms-of-use')}
          />
          <ListRow
            icon="cookie"
            title="Cookie Policy"
            subtitle="Storage itemization & retention rules"
            onClick={() => navigate('/cookie-policy')}
          />
          <ListRow
            icon="payments"
            title="Refund Policy"
            subtitle="Cancellations, returns & dispute terms"
            onClick={() => navigate('/refund-policy')}
          />
        </div>

        <Eyebrow className="mb-3 ml-1">Consent &amp; Permissions</Eyebrow>
        <div className="rounded-card border border-line bg-surface-1 px-4 divide-y divide-line shadow-sm">
          <ListRow
            icon="tune"
            title="Cookie & Storage Preferences"
            subtitle="Manage analytics & functional consent"
            onClick={openCookiePreferences}
          />
          <ListRow
            icon="security"
            title="Device Permissions"
            subtitle="Camera access for sizing and try-ons"
            onClick={() => navigate('/settings', { state: { view: 'permissions' } })}
          />
        </div>
      </div>
    </div>
  );
};

export default PrivacyCenter;
