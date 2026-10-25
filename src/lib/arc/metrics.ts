/**
 * ARC Lab — evaluation metrics and failure taxonomy.
 *
 * Official-style scoring (exact match, pass@2) is kept strictly separate from
 * diagnostic metrics (pixel accuracy, failure category).
 */

import type { Grid } from './types';
import { diffGrids, colorHistogram } from './grid';

export function exactMatch(pred: Grid | null | undefined, truth: Grid): boolean {
  if (!pred) return false;
  const d = diffGrids(pred, truth);
  return d.shapeEqual && d.diffCells === 0;
}

export function pixelAccuracy(pred: Grid | null | undefined, truth: Grid): number {
  if (!pred) return 0;
  const d = diffGrids(pred, truth);
  if (!d.shapeEqual || d.totalCells === 0) return 0;
  return 1 - d.diffCells / d.totalCells;
}

export type FailureCategory =
  | 'none' // exact match
  | 'no-prediction'
  | 'unverifiable' // no ground truth for this task
  | 'shape-mismatch'
  | 'color-mismatch'
  | 'cell-errors';

/**
 * Heuristic failure taxonomy for diagnostics:
 * - shape-mismatch: predicted grid has wrong dimensions
 * - color-mismatch: right shape, but predicted palette differs from truth's
 * - cell-errors: right shape & palette, some cells misplaced
 */
export function classifyFailure(pred: Grid | null | undefined, truth: Grid | null | undefined): FailureCategory {
  if (!pred) return 'no-prediction';
  if (!truth) return 'unverifiable';
  const d = diffGrids(pred, truth);
  if (d.shapeEqual && d.diffCells === 0) return 'none';
  if (!d.shapeEqual) return 'shape-mismatch';
  const ph = new Set(colorHistogram(pred).keys());
  const th = new Set(colorHistogram(truth).keys());
  const samePalette = ph.size === th.size && [...ph].every((c) => th.has(c));
  if (!samePalette) return 'color-mismatch';
  return 'cell-errors';
}

export const FAILURE_LABELS: Record<FailureCategory, string> = {
  none: 'Solved',
  'no-prediction': 'No prediction',
  unverifiable: 'Unverifiable (no ground truth)',
  'shape-mismatch': 'Wrong output dimensions',
  'color-mismatch': 'Wrong color palette',
  'cell-errors': 'Some cells misplaced',
};

export interface PerTaskResult {
  taskId: string;
  solverId: string;
  runtimeMs: number;
  predictions: Grid[];
  expected: Grid | null;
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  failure: FailureCategory;
  note?: string;
}

export interface PerSolverSummary {
  solverId: string;
  total: number;
  solved: number;
  exactRate: number;
  pass2Solved: number;
  pass2Rate: number;
  avgPixelAcc: number | null;
  avgRuntimeMs: number;
  totalRuntimeMs: number;
  failures: Record<FailureCategory, number>;
}

export function summarize(results: PerTaskResult[]): PerSolverSummary {
  const failures: Record<FailureCategory, number> = {
    none: 0,
    'no-prediction': 0,
    unverifiable: 0,
    'shape-mismatch': 0,
    'color-mismatch': 0,
    'cell-errors': 0,
  };
  let solved = 0;
  let pass2 = 0;
  let accSum = 0;
  let accN = 0;
  let runtime = 0;
  for (const r of results) {
    failures[r.failure]++;
    if (r.exact === true) solved++;
    if (r.pass2 === true) pass2++;
    if (r.pixelAcc !== null) {
      accSum += r.pixelAcc;
      accN++;
    }
    runtime += r.runtimeMs;
  }
  const total = results.length;
  return {
    solverId: results[0]?.solverId ?? 'unknown',
    total,
    solved,
    exactRate: total === 0 ? 0 : solved / total,
    pass2Solved: pass2,
    pass2Rate: total === 0 ? 0 : pass2 / total,
    avgPixelAcc: accN === 0 ? null : accSum / accN,
    avgRuntimeMs: total === 0 ? 0 : runtime / total,
    totalRuntimeMs: runtime,
    failures,
  };
}
