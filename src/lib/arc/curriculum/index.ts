/**
 * ARC Lab — curriculum facade: deterministic puzzle generation + Task building.
 */

import { mulberry32, hashSeed } from '../rng';
import { makeTask, ARC_LAB_DATASET_VERSION, type Difficulty, type Task } from '../types';
import { GENERATORS_A } from './generators-a';
import { GENERATORS_B } from './generators-b';
import { getLevelDef, LEVELS, levelId, WORLDS, listManifest, type LevelDef } from './worlds';
import type { PuzzleDraft } from './gen-helpers';

export { LEVELS, WORLDS, getLevelDef, levelId, listManifest };
export type { LevelDef };

export const GENERATORS: Record<string, (rng: ReturnType<typeof mulberry32>, d: number) => PuzzleDraft> = {
  ...GENERATORS_A,
  ...GENERATORS_B,
};

const WORLD_TO_DIFFICULTY: Record<string, Difficulty> = {
  Beginner: 'beginner',
  Easy: 'easy',
  Intermediate: 'intermediate',
  Advanced: 'advanced',
  Expert: 'expert',
};

export function generateFromTemplate(template: string, seed: number, d: number): PuzzleDraft {
  const gen = GENERATORS[template];
  if (!gen) throw new Error(`Unknown generator template: ${template}`);
  const rng = mulberry32(seed);
  return gen(rng, Math.max(0, Math.min(1, d)));
}

export function generateLevel(levelIdStr: string): PuzzleDraft {
  const def = getLevelDef(levelIdStr);
  if (!def) throw new Error(`Unknown level: ${levelIdStr}`);
  return generateFromTemplate(def.template, def.seed, def.d);
}

export function levelTask(levelIdStr: string, opts?: { reveal?: boolean }): Task {
  const def = getLevelDef(levelIdStr);
  if (!def) throw new Error(`Unknown level: ${levelIdStr}`);
  const draft = generateLevel(levelIdStr);
  return makeTask(levelIdStr, draft.train, [{ input: draft.testInput, output: opts?.reveal ? draft.testOutput : null }], {
    title: `${def.world}.${def.level} ${def.title}`,
    world: def.world,
    level: def.level,
    skills: def.skills,
    difficulty: WORLD_TO_DIFFICULTY[def.worldDifficulty] ?? 'intermediate',
    source: 'arc-lab-synthetic',
    datasetVersion: ARC_LAB_DATASET_VERSION,
    explanation: draft.explanation,
    hints: draft.hints,
  });
}

// ---------------------------------------------------------------------------
// Daily puzzle — deterministic per calendar day (Asia/Dhaka).
// ---------------------------------------------------------------------------

export const DAILY_POOL = [
  'map-one',
  'swap-two',
  'keep-one',
  'keep-largest',
  'rotate-k',
  'complete-h',
  'fix-symmetry',
  'tile-2x2',
  'gravity',
  'geo-then-color',
  'cycle-colors',
  'frame-objects',
  'two-op',
  'triple-op',
  'noise-filter',
  'capstone',
];

export function todayKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date); // YYYY-MM-DD
}

export function dailyIdForDate(dateKey: string): string {
  return `daily-${dateKey}`;
}

export function dailyLevelForDate(dateKey: string): { id: string; template: string; draft: PuzzleDraft } {
  const seed = hashSeed('arc-lab-daily-v1', dateKey);
  const rng = mulberry32(seed);
  const template = DAILY_POOL[seed % DAILY_POOL.length];
  const draft = generateFromTemplate(template, seed, 0.55);
  return { id: dailyIdForDate(dateKey), template, draft };
}

export function dailyTask(dateKey: string, opts?: { reveal?: boolean }): Task {
  const { id, template, draft } = dailyLevelForDate(dateKey);
  const t = makeTask(id, draft.train, [{ input: draft.testInput, output: opts?.reveal ? draft.testOutput : null }], {
    title: `Daily Challenge — ${dateKey} (${template})`,
    skills: ['daily'],
    difficulty: 'intermediate',
    source: 'arc-lab-synthetic',
    datasetVersion: ARC_LAB_DATASET_VERSION,
    explanation: draft.explanation,
    hints: draft.hints,
  });
  return t;
}

/** Is this id a daily puzzle id? */
export function isDailyId(id: string): boolean {
  return id.startsWith('daily-');
}

export function taskForId(id: string, opts?: { reveal?: boolean }): Task {
  if (isDailyId(id)) return dailyTask(id.slice('daily-'.length), opts);
  return levelTask(id, opts);
}

export { GENERATORS_A, GENERATORS_B };
