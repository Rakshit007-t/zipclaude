import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Eyebrow, Button } from '../components/ui';

interface ComingSoonProps {
  featureName: string;
}

const ComingSoon: React.FC<ComingSoonProps> = ({ featureName }) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="In the atelier" onBack={() => navigate('/home')} />

      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-7">
          <span className="material-symbols-outlined text-[28px] text-ink-faint" aria-hidden="true">architecture</span>
        </div>
        <Eyebrow className="mb-3">Coming soon</Eyebrow>
        <h2 className="font-display text-[30px] font-light leading-tight mb-3">
          {featureName}<em className="font-medium text-brand">.</em>
        </h2>
        <p className="text-ink-soft text-[14px] leading-relaxed max-w-[280px] mb-8">
          This is being tailored in the atelier. We'll let you know the moment it's ready to wear.
        </p>
        <Button variant="outline" icon="arrow_back" onClick={() => navigate('/home')}>
          Back to home
        </Button>
      </div>
    </div>
  );
};

export default ComingSoon;
