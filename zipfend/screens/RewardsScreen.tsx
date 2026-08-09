import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { calculateRank } from '../services/rewards';
import { AppBar, Badge, Button, Eyebrow, Spinner } from '../components/ui';

const REWARD_TIERS = [
  { rank: 'Bronze', coins: '0 – 99', perk: 'Standard ZipRight Fit recommendations & 5% cashback coins' },
  { rank: 'Silver', coins: '100 – 499', perk: 'Priority Virtual Try-On rendering & 10% bonus coins' },
  { rank: 'Gold', coins: '500 – 999', perk: 'Exclusive brand partner drops & free express fit exchanges' },
  { rank: 'Platinum', coins: '1,000 – 2,499', perk: '1-on-1 AI Stylist consultations & zero fee returns' },
  { rank: 'Diamond', coins: '2,500 – 4,999', perk: 'VIP preview access to new designer collections' },
  { rank: 'Elite', coins: '5,000+', perk: 'Custom 3D body twin scanning & personal atelier concierge' },
];

const REWARD_RULES = [
  { spend: '₹1 – ₹499', coins: '5 ZipCoins' },
  { spend: '₹500 – ₹999', coins: '15 ZipCoins' },
];

const RewardsScreen: React.FC = () => {
  const { goBack } = useAppNavigation();
  const { userProfile } = useUserProfile();

  const [loading, setLoading] = useState(true);
  const [zipPoints, setZipPoints] = useState(0);
  const [giftsGiven, setGiftsGiven] = useState(0);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      setLoading(false);
      return;
    }

    getDoc(doc(db, 'users', user.uid)).then(snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setZipPoints(typeof data.zipPoints === 'number' ? data.zipPoints : 0);
        setGiftsGiven(typeof data.giftsGiven === 'number' ? data.giftsGiven : 0);
      } else {
        setZipPoints(0);
        setGiftsGiven(0);
      }
      setLoading(false);
    }).catch(() => {
      setZipPoints(0);
      setGiftsGiven(0);
      setLoading(false);
    });
  }, []);

  const rankInfo = calculateRank(zipPoints);

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink pb-28">
      <AppBar title="ZipRIGHT Rewards" onBack={() => goBack('/profile')} />

      <div className="px-6 pt-6 flex flex-col gap-6">
        {/* Hero Rank Card */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-[1.75rem] bg-surface-1 border border-line shadow-elev-lift relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <Eyebrow className="!text-[9px]">Current Rank</Eyebrow>
              <h1 className="font-display text-[28px] font-semibold text-ink leading-tight flex items-center gap-2 mt-0.5">
                {rankInfo.rank}
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${rankInfo.badgeColor}`}>
                  <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>{rankInfo.icon}</span>
                  {rankInfo.rank}
                </span>
              </h1>
            </div>
            <div className="text-right">
              <p className="eyebrow !text-[9px]">ZipCoins Balance</p>
              <p className="font-display text-[26px] font-semibold text-brand mt-0.5">{rankInfo.currentCoins}</p>
            </div>
          </div>

          {/* Animated Progress Bar */}
          {rankInfo.nextRank && rankInfo.nextThreshold && (
            <div className="mt-5">
              <div className="flex justify-between items-center text-[12px] mb-2">
                <span className="text-ink-soft">Progress to <strong className="text-ink">{rankInfo.nextRank}</strong></span>
                <span className="font-semibold text-ink">{rankInfo.currentCoins} / {rankInfo.nextThreshold} ZipCoins</span>
              </div>
              <div className="h-2.5 bg-surface-2 rounded-full overflow-hidden border border-line p-0.5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${rankInfo.progressPct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full bg-brand rounded-full shadow-glow"
                />
              </div>
              <p className="text-[11px] text-ink-faint mt-1.5 text-right">
                {rankInfo.nextThreshold - rankInfo.currentCoins} more ZipCoins to unlock {rankInfo.nextRank}
              </p>
            </div>
          )}

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-4 mt-6 pt-5 border-t border-line/60">
            <div className="p-3 bg-surface-2 rounded-xl border border-line/50 text-center">
              <p className="eyebrow !text-[8.5px]">Gifts Given</p>
              <p className="font-display text-[20px] font-medium text-ink mt-0.5">{giftsGiven}</p>
            </div>
            <div className="p-3 bg-surface-2 rounded-xl border border-line/50 text-center">
              <p className="eyebrow !text-[8.5px]">Fit Accuracy Tier</p>
              <p className="font-display text-[20px] font-medium text-success mt-0.5">98% Match</p>
            </div>
          </div>
        </motion.div>

        {/* Earning Rules Breakdown */}
        <div className="p-5 rounded-2xl bg-surface-1 border border-line">
          <Eyebrow className="mb-2">ZipCoins Earning Rules</Eyebrow>
          <p className="text-[12.5px] text-ink-faint mb-4 leading-relaxed">
            Earn ZipCoins automatically on every purchase to level up your membership tier.
          </p>
          <div className="flex flex-col gap-2">
            {REWARD_RULES.map((rule, idx) => (
              <div key={idx} className="flex items-center justify-between py-2.5 border-b border-line last:border-none text-[13px]">
                <span className="text-ink-soft font-medium">Order Value: {rule.spend}</span>
                <span className="font-semibold text-brand bg-brand-soft px-2.5 py-0.5 rounded-full border border-brand/20">{rule.coins}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rank Tier Perks */}
        <div>
          <Eyebrow className="mb-3">Membership Tier Privileges</Eyebrow>
          <div className="flex flex-col gap-3">
            {REWARD_TIERS.map(t => (
              <div key={t.rank} className={`p-4 rounded-2xl border transition-colors ${t.rank === rankInfo.rank ? 'bg-surface-1 border-brand/50 shadow-sm' : 'bg-surface-1/60 border-line'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-display text-[16px] font-semibold text-ink flex items-center gap-1.5">
                    {t.rank}
                    {t.rank === rankInfo.rank && <Badge variant="brand" size="sm">Current</Badge>}
                  </span>
                  <span className="text-[11px] font-medium text-ink-faint">{t.coins} ZipCoins</span>
                </div>
                <p className="text-[12.5px] text-ink-soft leading-relaxed">{t.perk}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RewardsScreen;
