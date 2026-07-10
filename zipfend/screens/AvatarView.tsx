import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { AppBar, Button, EmptyState } from '../components/ui';

const AvatarView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const avatarData = location.state?.avatarData;

  if (!avatarData) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
        <AppBar title="Digital Twin" onBack={() => navigate('/home')} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="face_6"
            title="No twin yet"
            description="Create your digital twin first — it takes under a minute."
            action={<Button onClick={() => navigate('/avatar-intro')}>Create twin</Button>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col overflow-hidden">
      <AppBar
        title="Your Digital Twin"
        onBack={() => navigate('/home')}
        trailing={
          <button aria-label="Share" className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform">
            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">ios_share</span>
          </button>
        }
      />

      {/* Main Viewport */}
      <div className="flex-1 relative flex items-center justify-center py-6">
        {/* Background Glow */}
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="h-[420px] w-[420px] blur-[100px] rounded-full animate-pulse" style={{ background: 'var(--brand)', opacity: 0.08 }} />
        </div>

        {/* Avatar Display (Simulated) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 h-[62vh] aspect-[1/2.2] flex flex-col items-center"
        >
          <div className="relative h-full w-full rounded-card overflow-hidden border border-line shadow-lift">
            <img
              src={avatarData.gender === 'Male'
                ? "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&auto=format&fit=crop"
                : "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800&auto=format&fit=crop"}
              className="h-full w-full object-cover"
              alt="Digital Twin"
              referrerPolicy="no-referrer"
            />
            {/* Overlay for skin tone simulation */}
            <div
              className="absolute inset-0 opacity-20 mix-blend-multiply pointer-events-none"
              style={{ backgroundColor: avatarData.skinTone }}
            />
          </div>

          {/* Success Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="absolute -bottom-5 bg-ink text-ink-invert px-6 py-3 rounded-full flex items-center gap-2 shadow-float"
          >
            <span className="material-symbols-outlined text-[17px] text-success" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span>
            <span className="font-semibold text-[11px] uppercase tracking-[0.12em]">Avatar ready</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Actions */}
      <div className="px-6 pb-12 pt-8 flex flex-col gap-4 z-20">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" icon="download">Save</Button>
          <Button variant="accent" icon="auto_awesome" onClick={() => navigate('/tryon-studio')}>
            Try outfits
          </Button>
        </div>
        <button
          onClick={() => navigate('/home')}
          className="text-ink-faint text-[11px] font-semibold uppercase tracking-[0.12em] text-center mt-1 active:scale-95 transition-transform"
        >
          Back to home
        </button>
      </div>
    </div>
  );
};

export default AvatarView;
