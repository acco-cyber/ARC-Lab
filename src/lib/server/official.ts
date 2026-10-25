/**
 * ARC Lab — official ARC-AGI-2 puzzle store (SERVER ONLY).
 *
 * Serves the 1,120 official tasks vendored from github.com/arcprize/ARC-AGI-2
 * (the same public set distributed via the Kaggle "ARC Prize 2026" competition
 * and shown on arcprize.org/tasks?v=2):
 *   - training   : 1,000 tasks
 *   - evaluation :   120 tasks (the public evaluation set)
 *
 * Also owns the "fresh puzzle" guarantee: `pickUnseenTask` excludes every task
 * previously recorded in the AgentPuzzleRun table for (playerId, agentId,
 * dataset), so an agent is never served the same puzzle twice unless the
 * player explicitly resets the history.
 */

import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import type { Grid, Task } from '@/lib/arc/types';

export const OFFICIAL_DATASETS = ['training', 'evaluation'] as const;
export type OfficialDataset = (typeof OFFICIAL_DATASETS)[number];

const DATA_ROOT = path.join(process.cwd(), 'data', 'arc-agi-2');

export interface OfficialIndexEntry {
  id: string;
  nTrain: number;
  nTest: number;
  hasOutput: boolean;
}

export interface OfficialTaskPayload {
  task: Task;
  /** Metrics are computed server-side; expected grids stay here until commit. */
  expected: Grid[];
}

export function isOfficialDataset(v: unknown): v is OfficialDataset {
  return typeof v === 'string' && (OFFICIAL_DATASETS as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────── index cache

const indexCache = new Map<OfficialDataset, OfficialIndexEntry[]>();

export function officialIndex(ds: OfficialDataset): OfficialIndexEntry[] {
  const cached = indexCache.get(ds);
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(DATA_ROOT, `${ds}-index.json`), 'utf8');
    const parsed = JSON.parse(raw) as OfficialIndexEntry[];
    indexCache.set(ds, parsed);
    return parsed;
  } catch {
    // index missing: rebuild lazily from the directory listing
    const dir = path.join(DATA_ROOT, ds);
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    } catch {
      ids = [];
    }
    const parsed = ids.map((id) => ({ id, nTrain: 0, nTest: 1, hasOutput: true }));
    indexCache.set(ds, parsed);
    return parsed;
  }
}

export function officialCounts(): Record<OfficialDataset, number> {
  return {
    training: officialIndex('training').length,
    evaluation: officialIndex('evaluation').length,
  };
}

// ─────────────────────────────────────────────────────────── task I/O

function rawTask(ds: OfficialDataset, id: string): { train: Array<{ input: Grid; output: Grid }>; test: Array<{ input: Grid; output?: Grid }> } | null {
  if (!/^[0-9a-f]{8}$/.test(id)) return null;
  try {
    const raw = fs.readFileSync(path.join(DATA_ROOT, ds, `${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { train?: unknown; test?: unknown };
    if (!parsed || !Array.isArray(parsed.train) || !Array.isArray(parsed.test)) return null;
    return parsed as { train: Array<{ input: Grid; output: Grid }>; test: Array<{ input: Grid; output?: Grid }> };
  } catch {
    return null;
  }
}

export function loadOfficialTask(ds: OfficialDataset, id: string, reveal: boolean): OfficialTaskPayload | null {
  const raw = rawTask(ds, id);
  if (!raw) return null;
  const expected: Grid[] = raw.test.map((t) => t.output ?? []).filter((g) => g.length > 0);
  const task: Task = {
    id,
    schemaVersion: 'official-arc-agi-2',
    train: raw.train.map((p) => ({ input: p.input, output: p.output })),
    test: raw.test.map((t) => ({ input: t.input, output: reveal ? (t.output ?? undefined) : undefined })),
    metadata: {
      title: `Official ${ds === 'training' ? 'training' : 'evaluation'} task ${id}`,
      difficulty: undefined,
      skills: ['official-arc-agi-2'],
      source: 'arc-official',
    },
  };
  return { task, expected };
}

// ─────────────────────────────────────────────────────────── unseen picker

export interface PickUnseenResult {
  taskId: string | null;
  seen: number;
  total: number;
  exhausted: boolean;
}

/**
 * Pick a uniformly random task from `ds` that this (playerId, agentId) pair has
 * never been served before. When everything has been seen, `exhausted` is true
 * and the UI offers a history reset.
 */
export async function pickUnseenTask(playerId: string, agentId: string, ds: OfficialDataset): Promise<PickUnseenResult> {
  const all = officialIndex(ds).map((e) => e.id);
  let seenIds = new Set<string>();
  try {
    const rows = await db.agentPuzzleRun.findMany({
      where: { playerId, agentId, dataset: ds },
      select: { taskId: true },
    });
    seenIds = new Set(rows.map((r) => r.taskId));
  } catch {
    // DB unavailable: still serve a random task, just without the dedup guarantee
  }
  const unseen = all.filter((id) => !seenIds.has(id));
  if (unseen.length === 0) {
    return { taskId: null, seen: all.length, total: all.length, exhausted: true };
  }
  const idx = Math.floor(Math.random() * unseen.length);
  return { taskId: unseen[idx], seen: seenIds.size, total: all.length, exhausted: false };
}

export interface ScorePayload {
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  shapeOk: boolean;
  diffCells: number | null;
  failure: string;
}

/**
 * Score agent attempts against the official task's expected outputs.
 * attempts[i] = candidate list for test input i (pass@2 = any candidate exact).
 */
export function scoreAttempts(expected: Grid[], attempts: Grid[][]): ScorePayload {
  if (expected.length === 0) {
    return { exact: null, pass2: null, pixelAcc: null, shapeOk: false, diffCells: null, failure: 'unverifiable' };
  }
  let anyExact = false;
  let anyPass2 = false;
  let accSum = 0;
  let shapeOkAll = true;
  let diffTotal = 0;
  let failure = 'none';
  for (let i = 0; i < expected.length; i++) {
    const truth = expected[i];
    const cands = attempts[i] ?? [];
    const valid = cands.filter((g) => Array.isArray(g) && g.length > 0 && Array.isArray(g[0]) && g.every((row) => Array.isArray(row) && row.length === (g[0] as Grid[number]).length));
    const first = valid[0] ?? null;
    const shapeOk = !!first && first.length === truth.length && (first[0] as Grid[number] | undefined)?.length === truth[0].length;
    if (!shapeOk) shapeOkAll = false;
    const cellEq = (g: Grid): boolean => g.length === truth.length && g.every((row, r) => row.length === truth[r].length && row.every((c, ci) => c === truth[r][ci]));
    if (valid.some(cellEq)) anyPass2 = true;
    if (first && shapeOk && cellEq(first)) anyExact = true;
    if (shapeOk && first) {
      let diff = 0;
      for (let r = 0; r < truth.length; r++) for (let c = 0; c < truth[r].length; c++) if (first[r][c] !== truth[r][c]) diff++;
      diffTotal += diff;
      accSum += 1 - diff / (truth.length * truth[0].length);
      if (diff > 0 && failure === 'none') {
        const palette = new Set<number>();
        for (const row of first) for (const c of row) palette.add(c);
        const truthPalette = new Set<number>();
        for (const row of truth) for (const c of row) truthPalette.add(c);
        const samePalette = palette.size === truthPalette.size && [...palette].every((c) => truthPalette.has(c));
        failure = samePalette ? 'cell-errors' : 'color-mismatch';
      }
    } else {
      failure = shapeOkAll ? 'no-prediction' : 'shape-mismatch';
    }
  }
  return {
    exact: anyExact,
    pass2: anyPass2,
    pixelAcc: accSum / expected.length,
    shapeOk: shapeOkAll,
    diffCells: diffTotal,
    failure,
  };
}

/** Record a run (idempotent per puzzle) and refresh stats. */
export async function recordRun(opts: {
  playerId: string;
  agentId: string;
  dataset: OfficialDataset;
  taskId: string;
  score: ScorePayload;
  elapsedMs?: number;
  engine?: string;
}): Promise<void> {
  await upsertRun({
    playerId: opts.playerId,
    agentId: opts.agentId,
    dataset: opts.dataset,
    taskId: opts.taskId,
    exact: opts.score.exact,
    pass2: opts.score.pass2,
    pixelAcc: opts.score.pixelAcc,
    elapsedMs: opts.elapsedMs,
    engine: opts.engine,
  });
}

/**
 * Mark a puzzle as SERVED at hand-out time (exact = null until scored).
 * This is what makes the never-repeat guarantee hold even when the agent is
 * never actually run on the served puzzle.
 */
export async function markServed(playerId: string, agentId: string, ds: OfficialDataset, taskId: string): Promise<void> {
  await upsertRun({ playerId, agentId, dataset: ds, taskId, exact: null, pass2: null, pixelAcc: null });
}

async function upsertRun(vals: {
  playerId: string;
  agentId: string;
  dataset: OfficialDataset;
  taskId: string;
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  elapsedMs?: number;
  engine?: string;
}): Promise<void> {
  try {
    await db.agentPuzzleRun.upsert({
      where: { playerId_agentId_dataset_taskId: { playerId: vals.playerId, agentId: vals.agentId, dataset: vals.dataset, taskId: vals.taskId } },
      create: {
        playerId: vals.playerId,
        agentId: vals.agentId,
        dataset: vals.dataset,
        taskId: vals.taskId,
        exact: vals.exact,
        pass2: vals.pass2,
        pixelAcc: vals.pixelAcc,
        elapsedMs: vals.elapsedMs ?? null,
        engine: vals.engine ?? null,
      },
      update: {
        ...(vals.exact !== null ? { exact: vals.exact } : {}),
        ...(vals.pass2 !== null ? { pass2: vals.pass2 } : {}),
        ...(vals.pixelAcc !== null ? { pixelAcc: vals.pixelAcc } : {}),
        ...(vals.elapsedMs !== undefined ? { elapsedMs: vals.elapsedMs } : {}),
        ...(vals.engine !== undefined ? { engine: vals.engine } : {}),
      },
    });
  } catch (err) {
    // best-effort: scoring still returns even if persistence fails
    console.error('[official] run upsert failed:', err instanceof Error ? err.message : err);
  }
}

export async function agentHistory(playerId: string, agentId: string): Promise<Record<string, { seen: number; solved: number; total: number }>> {
  const out: Record<string, { seen: number; solved: number; total: number }> = {};
  const counts = officialCounts();
  try {
    const seenRows = await db.agentPuzzleRun.groupBy({
      by: ['dataset'],
      where: { playerId, agentId },
      _count: { _all: true },
    });
    const solvedRows = await db.agentPuzzleRun.groupBy({
      by: ['dataset'],
      where: { playerId, agentId, exact: true },
      _count: { _all: true },
    });
    for (const ds of OFFICIAL_DATASETS) {
      out[ds] = {
        seen: seenRows.find((r) => r.dataset === ds)?._count?._all ?? 0,
        solved: solvedRows.find((r) => r.dataset === ds)?._count?._all ?? 0,
        total: counts[ds],
      };
    }
  } catch {
    for (const ds of OFFICIAL_DATASETS) out[ds] = { seen: 0, solved: 0, total: counts[ds] };
  }
  return out;
}

export async function resetHistory(playerId: string, agentId: string, ds?: OfficialDataset): Promise<number> {
  try {
    const res = await db.agentPuzzleRun.deleteMany({ where: { playerId, agentId, ...(ds ? { dataset: ds } : {}) } });
    return res.count;
  } catch {
    return 0;
  }
}

/** Last N runs (newest first) for the agent's history panel. */
export async function recentRuns(playerId: string, agentId: string, limit = 20) {
  try {
    return await db.agentPuzzleRun.findMany({
      where: { playerId, agentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { dataset: true, taskId: true, exact: true, pass2: true, pixelAcc: true, elapsedMs: true, engine: true, createdAt: true },
    });
  } catch {
    return [];
  }
}
