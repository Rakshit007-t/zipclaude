import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AppBar, Button, Eyebrow, SegmentedControl, Chip } from '../components/ui';

const AvatarIntro: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [avatarData, setAvatarData] = useState({
    gender: 'Male',
    height: 175,
    weight: 70,
    bodyType: 'Average',
    skinTone: '#E0AC69',
    hairStyle: 'Short',
    hairColor: '#4B2C20'
  });

  const nextStep = () => setStep(prev => prev + 1);
  const prevStep = () => setStep(prev => prev - 1);

  const skinTones = ['#FAD7B0', '#E0AC69', '#8D5524', '#C68642', '#3C2E28'];
  const hairColors = ['#000000', '#4B2C20', '#A52A2A', '#D2B48C', '#FFFFFF'];

  const renderStep = () => {
    switch(step) {
      case 1:
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col gap-10"
          >
            <div className="text-center">
              <div className="h-18 w-18 p-5 rounded-full border border-line-strong inline-flex items-center justify-center mx-auto mb-7">
                <span className="material-symbols-outlined text-[34px] text-brand" aria-hidden="true">verified_user</span>
              </div>
              <Eyebrow className="mb-3">Your digital twin</Eyebrow>
              <h2 className="font-display text-[32px] font-light leading-[1.08] mb-4">
                Privacy <em className="font-medium">first.</em>
              </h2>
              <p className="text-ink-soft text-[14px] leading-relaxed max-w-[290px] mx-auto">
                We don't use your camera or collect face data. Create your digital twin manually for a secure and private experience.
              </p>
            </div>
            <Button size="lg" fullWidth trailingIcon="auto_awesome" onClick={nextStep}>
              Get started
            </Button>
          </motion.div>
        );
      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-7"
          >
            <div>
              <Eyebrow className="mb-2">Step two</Eyebrow>
              <h2 className="font-display text-[26px] font-light">Basic <em className="font-medium">attributes.</em></h2>
            </div>

            <div className="space-y-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Gender / body frame</p>
                <SegmentedControl
                  aria-label="Gender"
                  value={avatarData.gender}
                  onChange={(g) => setAvatarData({ ...avatarData, gender: g })}
                  options={[
                    { value: 'Male', label: 'Male' },
                    { value: 'Female', label: 'Female' },
                  ]}
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">
                  Height <span className="font-display normal-case text-[15px] text-ink ml-1">{avatarData.height} cm</span>
                </p>
                <input
                  type="range" min="140" max="210"
                  value={avatarData.height}
                  onChange={(e) => setAvatarData({...avatarData, height: parseInt(e.target.value)})}
                  className="w-full h-1 bg-surface-3 rounded-lg appearance-none cursor-pointer accent-[var(--brand)]"
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">
                  Weight <span className="font-display normal-case text-[15px] text-ink ml-1">{avatarData.weight} kg</span>
                </p>
                <input
                  type="range" min="40" max="150"
                  value={avatarData.weight}
                  onChange={(e) => setAvatarData({...avatarData, weight: parseInt(e.target.value)})}
                  className="w-full h-1 bg-surface-3 rounded-lg appearance-none cursor-pointer accent-[var(--brand)]"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button aria-label="Go back" onClick={prevStep} className="h-12 w-12 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform">
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">arrow_back</span>
              </button>
              <Button className="flex-1" onClick={nextStep}>Continue</Button>
            </div>
          </motion.div>
        );
      case 3:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-7"
          >
            <div>
              <Eyebrow className="mb-2">Step three</Eyebrow>
              <h2 className="font-display text-[26px] font-light">Appear<em className="font-medium">ance.</em></h2>
            </div>

            <div className="space-y-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Skin tone</p>
                <div className="flex gap-3">
                  {skinTones.map(tone => (
                    <button
                      key={tone}
                      onClick={() => setAvatarData({...avatarData, skinTone: tone})}
                      aria-label={`Skin tone ${tone}`}
                      aria-pressed={avatarData.skinTone === tone}
                      className={`h-10 w-10 rounded-full transition-all ${avatarData.skinTone === tone ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-0 scale-110' : 'ring-1 ring-line'}`}
                      style={{ backgroundColor: tone }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Hair style</p>
                <div className="flex gap-2.5">
                  {['Short', 'Medium', 'Long'].map(s => (
                    <Chip
                      key={s}
                      selected={avatarData.hairStyle === s}
                      className="flex-1"
                      onClick={() => setAvatarData({...avatarData, hairStyle: s})}
                    >
                      {s}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Hair color</p>
                <div className="flex gap-3">
                  {hairColors.map(color => (
                    <button
                      key={color}
                      onClick={() => setAvatarData({...avatarData, hairColor: color})}
                      aria-label={`Hair color ${color}`}
                      aria-pressed={avatarData.hairColor === color}
                      className={`h-10 w-10 rounded-full transition-all ${avatarData.hairColor === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-0 scale-110' : 'ring-1 ring-line'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button aria-label="Go back" onClick={prevStep} className="h-12 w-12 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform">
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">arrow_back</span>
              </button>
              <Button variant="accent" className="flex-1" onClick={() => navigate('/avatar-view', { state: { avatarData } })}>
                Generate avatar
              </Button>
            </div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">
      <AppBar
        title={
          <div className="flex flex-col">
            <h1 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink">Digital Twin</h1>
            <div className="flex gap-1 mt-1.5" aria-label={`Step ${step} of 3`}>
              {[1, 2, 3].map(i => (
                <div key={i} className={`h-[3px] w-5 rounded-full transition-all ${step >= i ? 'bg-brand' : 'bg-surface-3'}`} />
              ))}
            </div>
          </div>
        }
      />

      {/* Content */}
      <div className="flex-1 px-6 flex flex-col justify-center pb-16 relative z-10">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>

      {/* Background Decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="absolute -top-24 -right-24 h-96 w-96 blur-[120px] rounded-full" style={{ background: 'var(--brand)', opacity: 0.05 }} />
      </div>
    </div>
  );
};

export default AvatarIntro;
