/**
 * Style Journey — client-side progression system.
 *
 * Entirely localStorage-backed: no backend calls, no schema changes. Screens
 * record events (`recordJourneyEvent`) and surfaces read a computed snapshot
 * (`getJourneySnapshot`). Tone: Nike Run Club, not Duolingo — quiet numbers,
 * no mascots.
 */

const STORAGE_KEY = 'zipright_style_journey';

export type JourneyEventType =
  | 'tryon_generated'
  | 'size_rec_viewed'
  | 'fit_feedback_given'
  | 'stylist_chat'
  | 'profile_completed'
  | 'look_saved';

/** Points per event — feedback is weighted highest because it improves the engine. */
const EVENT_POINTS: Record<JourneyEventType, number> = {
  tryon_generated: 25,
  size_rec_viewed: 10,
  fit_feedback_given: 40,
  stylist_chat: 15,
  profile_completed: 50,
  look_saved: 10,
};

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earnedAt?: string;
}

const ACHIEVEMENT_DEFS: Array<Achievement & { test: (s: JourneyState) => boolean }> = [
  { id: 'first-render', title: 'First Look', description: 'Generated your first AI try-on', icon: 'view_in_ar', test: s => (s.counts.tryon_generated ?? 0) >= 1 },
  { id: 'ten-renders', title: 'Style Explorer', description: '10 AI try-ons generated', icon: 'auto_awesome', test: s => (s.counts.tryon_generated ?? 0) >= 10 },
  { id: 'first-feedback', title: 'Fit Truther', description: 'Gave your first fit feedback', icon: 'fact_check', test: s => (s.counts.fit_feedback_given ?? 0) >= 1 },
  { id: 'profile-complete', title: 'Measured Up', description: 'Completed your Fit Profile', icon: 'straighten', test: s => (s.counts.profile_completed ?? 0) >= 1 },
  { id: 'stylist-regular', title: 'Inner Circle', description: '10 conversations with your stylist', icon: 'forum', test: s => (s.counts.stylist_chat ?? 0) >= 10 },
  { id: 'week-streak', title: 'Seven Days of Style', description: '7-day fashion streak', icon: 'local_fire_department', test: s => s.bestStreak >= 7 },
];

/** Level thresholds — climbing gets harder, names stay adult. */
const LEVELS = [
  { name: 'Newcomer', min: 0 },
  { name: 'Curator', min: 100 },
  { name: 'Tastemaker', min: 300 },
  { name: 'Trendsetter', min: 700 },
  { name: 'Icon', min: 1500 },
];

interface JourneyState {
  points: number;
  counts: Partial<Record<JourneyEventType, number>>;
  /** ISO dates (yyyy-mm-dd) with at least one event — capped to last 60. */
  activeDays: string[];
  bestStreak: number;
  earned: Record<string, string>; // achievement id -> ISO earned time
}

export interface JourneySnapshot {
  points: number;
  level: string;
  nextLevel: string | null;
  /** 0–100 progress toward the next level. */
  levelProgress: number;
  currentStreak: number;
  bestStreak: number;
  achievements: Achievement[];
  /** Achievements newly earned by the most recent event (for celebration UI). */
  justEarned: Achievement[];
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): JourneyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.points === 'number') return parsed;
    }
  } catch {
    /* corrupted state falls through to fresh */
  }
  return { points: 0, counts: {}, activeDays: [], bestStreak: 0, earned: {} };
}

function save(state: JourneyState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full/blocked — journey is best-effort */
  }
}

function computeCurrentStreak(activeDays: string[]): number {
  const days = new Set(activeDays);
  let streak = 0;
  const cursor = new Date();
  // A streak counts if today OR yesterday is active (today's visit may be first event pending)
  if (!days.has(todayKey())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function levelFor(points: number) {
  let current = LEVELS[0];
  let next: (typeof LEVELS)[number] | null = null;
  for (const lvl of LEVELS) {
    if (points >= lvl.min) current = lvl;
    else {
      next = lvl;
      break;
    }
  }
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.min(100, Math.round(((points - current.min) / span) * 100)) : 100;
  return { current, next, progress };
}

/** Record an event. Returns the fresh snapshot (with any newly earned achievements). */
export function recordJourneyEvent(type: JourneyEventType): JourneySnapshot {
  const state = load();
  state.points += EVENT_POINTS[type];
  state.counts[type] = (state.counts[type] ?? 0) + 1;

  const today = todayKey();
  if (!state.activeDays.includes(today)) {
    state.activeDays.push(today);
    if (state.activeDays.length > 60) state.activeDays = state.activeDays.slice(-60);
  }
  const streak = computeCurrentStreak(state.activeDays);
  if (streak > state.bestStreak) state.bestStreak = streak;

  const justEarned: Achievement[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (!state.earned[def.id] && def.test(state)) {
      state.earned[def.id] = new Date().toISOString();
      justEarned.push({ id: def.id, title: def.title, description: def.description, icon: def.icon, earnedAt: state.earned[def.id] });
    }
  }

  save(state);
  return snapshotFrom(state, justEarned);
}

/** Read-only snapshot for surfaces (nav badge, Z-menu, profile). */
export function getJourneySnapshot(): JourneySnapshot {
  return snapshotFrom(load(), []);
}

function snapshotFrom(state: JourneyState, justEarned: Achievement[]): JourneySnapshot {
  const { current, next, progress } = levelFor(state.points);
  return {
    points: state.points,
    level: current.name,
    nextLevel: next?.name ?? null,
    levelProgress: progress,
    currentStreak: computeCurrentStreak(state.activeDays),
    bestStreak: state.bestStreak,
    achievements: ACHIEVEMENT_DEFS.map(({ test: _test, ...a }) => ({ ...a, earnedAt: state.earned[a.id] })),
    justEarned,
  };
}
