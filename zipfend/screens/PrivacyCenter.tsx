import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, ListRow } from '../components/ui';

const PrivacyCenter: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Privacy center" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-8 pb-24">
        <Eyebrow className="mb-3">Your data</Eyebrow>
        <h2 className="font-display text-[32px] leading-tight font-light mb-3">
          In your <em className="font-medium text-brand">control.</em>
        </h2>
        <p className="text-ink-soft text-[14px] leading-relaxed mb-8 max-w-[320px]">
          Manage how your information is used. Your measurements and photos only ever power your recommendations and try-on renders.
        </p>

        <div className="rounded-card border border-line bg-surface-1 px-4 divide-y divide-line">
          <ListRow icon="description" title="Privacy Policy" subtitle="How we store and use your data" onClick={() => navigate('/privacy-policy')} />
          <ListRow icon="gavel" title="Terms of Use" subtitle="The agreement you accepted" onClick={() => navigate('/terms-of-use')} />
          <ListRow icon="tune" title="App permissions" subtitle="Camera, location, photos" onClick={() => navigate('/settings', { state: { view: 'permissions' } })} />
        </div>
      </div>
    </div>
  );
};

export default PrivacyCenter;
