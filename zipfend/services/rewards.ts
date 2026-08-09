export interface RankInfo {
  rank: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Elite';
  nextRank: string | null;
  currentCoins: number;
  minCoins: number;
  nextThreshold: number | null;
  progressPct: number;
  badgeColor: string;
  icon: string;
}

/** Calculate ZipCoins earned from a purchase amount (in INR ₹). */
export function calculateCoinsFromOrder(amountInr: number): number {
  // Product policy only defines these two tiers. Higher tiers deliberately
  // award nothing until an approved server-side schedule is supplied.
  if (amountInr >= 500) return 15;
  if (amountInr >= 1) return 5;
  return 0;
}

/** Calculate current ZipCoin level, next level threshold, and progress percentage. */
export function calculateRank(coins: number): RankInfo {
  const currentCoins = Math.max(0, coins || 0);

  if (currentCoins >= 5000) {
    return {
      rank: 'Elite',
      nextRank: null,
      currentCoins,
      minCoins: 5000,
      nextThreshold: null,
      progressPct: 100,
      badgeColor: 'bg-amber-400/20 text-amber-500 border-amber-400/40',
      icon: 'auto_awesome',
    };
  }

  if (currentCoins >= 2500) {
    const minCoins = 2500;
    const nextThreshold = 5000;
    const progressPct = Math.min(100, Math.round(((currentCoins - minCoins) / (nextThreshold - minCoins)) * 100));
    return {
      rank: 'Diamond',
      nextRank: 'Elite',
      currentCoins,
      minCoins,
      nextThreshold,
      progressPct,
      badgeColor: 'bg-cyan-500/20 text-cyan-500 border-cyan-500/40',
      icon: 'diamond',
    };
  }

  if (currentCoins >= 1000) {
    const minCoins = 1000;
    const nextThreshold = 2500;
    const progressPct = Math.min(100, Math.round(((currentCoins - minCoins) / (nextThreshold - minCoins)) * 100));
    return {
      rank: 'Platinum',
      nextRank: 'Diamond',
      currentCoins,
      minCoins,
      nextThreshold,
      progressPct,
      badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40',
      icon: 'workspace_premium',
    };
  }

  if (currentCoins >= 500) {
    const minCoins = 500;
    const nextThreshold = 1000;
    const progressPct = Math.min(100, Math.round(((currentCoins - minCoins) / (nextThreshold - minCoins)) * 100));
    return {
      rank: 'Gold',
      nextRank: 'Platinum',
      currentCoins,
      minCoins,
      nextThreshold,
      progressPct,
      badgeColor: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/40',
      icon: 'military_tech',
    };
  }

  if (currentCoins >= 100) {
    const minCoins = 100;
    const nextThreshold = 500;
    const progressPct = Math.min(100, Math.round(((currentCoins - minCoins) / (nextThreshold - minCoins)) * 100));
    return {
      rank: 'Silver',
      nextRank: 'Gold',
      currentCoins,
      minCoins,
      nextThreshold,
      progressPct,
      badgeColor: 'bg-slate-400/20 text-slate-500 border-slate-400/40',
      icon: 'stars',
    };
  }

  // Bronze Tier
  const minCoins = 0;
  const nextThreshold = 100;
  const progressPct = Math.min(100, Math.round((currentCoins / nextThreshold) * 100));
  return {
    rank: 'Bronze',
    nextRank: 'Silver',
    currentCoins,
    minCoins,
    nextThreshold,
    progressPct,
    badgeColor: 'bg-brand/20 text-brand border-brand/40',
    icon: 'emoji_events',
  };
}
