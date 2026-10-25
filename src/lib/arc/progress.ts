/**
 * ARC Lab — XP, badges, streaks and unlock rules.
 */

export interface LevelLite {
  puzzleId: string;
  solved: boolean;
  wrongAttempts: number;
  hintsUsed: number;
}

export interface DailyLite {
  date: string;
  solved: boolean;
}

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  earned: boolean;
}

export const XP = {
  practiceSolve: 25,
  challengeBase: 100,
  worldBonusPerWorld: 10,
  firstTryBonus: 25,
  noHintBonus: 25,
  dailyBase: 150,
  hintPenalty: [0, 15, 30, 50] as const, // penalty by max hint tier used
  failedAttempt: 5, // consolation XP per wrong submission in practice
  dailyFailedAttempt: 5,
};

export function worldOf(puzzleId: string): number {
  const m = /^w(\d+)l\d+$/.exec(puzzleId);
  return m ? Number(m[1]) : 0;
}

export function computeXpAward(opts: {
  puzzleId: string;
  mode: 'practice' | 'challenge';
  wrongAttempts: number;
  hintsUsed: number;
  isDaily?: boolean;
}): number {
  const { puzzleId, mode, wrongAttempts, hintsUsed, isDaily } = opts;
  const base = isDaily ? XP.dailyBase : mode === 'practice' ? XP.practiceSolve : XP.challengeBase + worldOf(puzzleId) * XP.worldBonusPerWorld;
  const penalty = XP.hintPenalty[Math.min(hintsUsed, 3)] ?? 0;
  const bonuses = (wrongAttempts === 0 ? XP.firstTryBonus : 0) + (hintsUsed === 0 ? XP.noHintBonus : 0);
  return Math.max(10, base - penalty + bonuses);
}

export function computeStreak(dailies: DailyLite[], todayKey: string): number {
  const solved = new Set(dailies.filter((d) => d.solved).map((d) => d.date));
  let streak = 0;
  // allow streak to count from today or yesterday backwards
  const d = new Date(`${todayKey}T12:00:00Z`);
  if (!solved.has(todayKey)) d.setUTCDate(d.getUTCDate() - 1);
  for (let i = 0; i < 400; i++) {
    const key = d.toISOString().slice(0, 10);
    if (solved.has(key)) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    } else break;
  }
  return streak;
}

export function computeBadges(levels: LevelLite[], dailies: DailyLite[], xp: number, todayKey: string): BadgeDef[] {
  const solvedLevels = levels.filter((l) => l.solved);
  const solvedCount = solvedLevels.length;
  const solvedIds = new Set(solvedLevels.map((l) => l.puzzleId));
  const noHintSolves = solvedLevels.filter((l) => l.hintsUsed === 0).length;
  const streak = computeStreak(dailies, todayKey);
  const anyDaily = dailies.some((d) => d.solved);

  const badges: BadgeDef[] = [
    { id: 'first-solve', name: 'First Insight', description: 'Solve your first puzzle', emoji: '💡', earned: solvedCount >= 1 },
    { id: 'no-hint-10', name: 'Pure Reasoner', description: 'Solve 10 puzzles without any hints', emoji: '🧠', earned: noHintSolves >= 10 },
    { id: 'halfway', name: 'Halfway There', description: 'Solve 50 curriculum levels', emoji: '🏔️', earned: solvedCount >= 50 },
    { id: 'century', name: 'Century', description: 'Solve all 100 curriculum levels', emoji: '💯', earned: solvedCount >= 100 },
    { id: 'daily-first', name: 'Daily Ritual', description: 'Solve a daily challenge', emoji: '📅', earned: anyDaily },
    { id: 'streak-7', name: 'On a Roll', description: '7-day daily puzzle streak', emoji: '🔥', earned: streak >= 7 },
    { id: 'xp-1000', name: 'Apprentice', description: 'Reach 1000 XP', emoji: '⭐', earned: xp >= 1000 },
    { id: 'xp-5000', name: 'Grandmaster', description: 'Reach 5000 XP', emoji: '🏆', earned: xp >= 5000 },
  ];
  for (let w = 1; w <= 10; w++) {
    const worldSolved = Array.from({ length: 10 }, (_, i) => solvedIds.has(`w${w}l${i + 1}`)).filter(Boolean).length;
    badges.push({
      id: `world-${w}-master`,
      name: `World ${w} Master`,
      description: `Solve all 10 levels of World ${w}`,
      emoji: ['🎨', '🔎', '🧭', '🔁', '🎨', '⚙️', '🧩', '🎭', '🕵️', '👑'][w - 1],
      earned: worldSolved >= 10,
    });
  }
  return badges;
}

/** Level l unlocked if l==1 or previous level solved. World w unlocked if w==1 or ≥5 levels solved in world w-1. */
export function computeUnlocks(levels: LevelLite[]): { unlockedLevels: Set<string>; unlockedWorlds: Set<number> } {
  const solved = new Set(levels.filter((l) => l.solved).map((l) => l.puzzleId));
  const unlockedLevels = new Set<string>();
  const unlockedWorlds = new Set<number>([1]);
  for (let w = 1; w <= 10; w++) {
    if (w > 1) {
      const prevSolved = Array.from({ length: 10 }, (_, i) => solved.has(`w${w - 1}l${i + 1}`)).filter(Boolean).length;
      if (prevSolved >= 5) unlockedWorlds.add(w);
    }
    for (let l = 1; l <= 10; l++) {
      if (l === 1) {
        if (unlockedWorlds.has(w)) unlockedLevels.add(`w${w}l${l}`);
      } else if (solved.has(`w${w}l${l - 1}`)) {
        unlockedLevels.add(`w${w}l${l}`);
      }
    }
  }
  return { unlockedLevels, unlockedWorlds };
}

export function playerLevel(xp: number): { level: number; title: string; nextAt: number } {
  const titles = ['Novice', 'Apprentice', 'Analyst', 'Pattern Seeker', 'Rule Bender', 'Logic Adept', 'Program Detective', 'Context Master', 'Reasoning Adept', 'ARC Grandmaster'];
  const level = Math.max(1, Math.floor(xp / 500) + 1);
  return {
    level: Math.min(level, 10),
    title: titles[Math.min(level - 1, titles.length - 1)],
    nextAt: level * 500,
  };
}
