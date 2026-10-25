/**
 * ARC Lab — baseline solver registry for the Arena.
 *
 * Every solver receives ONLY the demonstration pairs and the test INPUT —
 * never the expected test output. All implementations are deterministic
 * except the LLM adapter. Each documents its limitations honestly.
 */

import type { Grid, Pair, Task } from './types';
import { dims, gridsEqual, modeColor, countColor, makeGrid, diffGrids } from './grid';
import { GEO_OPS } from './transforms';
import { recolor } from './transforms';
import { findObjects, keepObjects, largestObject } from './objects';
import { searchPrograms, applyProgram } from './dsl';
import { solveWithLlm } from './llm-solver';

export interface SolverOutput {
  predictions: Grid[];
  note?: string;
}

export interface SolverDef {
  id: string;
  name: string;
  kind: 'baseline' | 'search' | 'llm' | 'ensemble';
  description: string;
  limitations: string;
  /** Optional per-task cap used by the runner UI. */
  slow?: boolean;
  run: (train: Pair[], testInput: Grid) => Promise<SolverOutput> | SolverOutput;
}

function copyInput(train: Pair[], testInput: Grid): SolverOutput {
  void train;
  return { predictions: [testInput.map((r) => [...r])], note: 'Sanity baseline: predicts the input unchanged.' };
}

function majorityFill(train: Pair[], testInput: Grid): SolverOutput {
  void testInput;
  // most common output shape among train outputs
  const shapes = new Map<string, number>();
  for (const p of train) {
    if (!p.output) continue;
    const d = dims(p.output);
    const key = `${d.h}x${d.w}`;
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, n] of shapes) {
    if (n > bestN || (n === bestN && k < best)) {
      best = k;
      bestN = n;
    }
  }
  if (!best) return { predictions: [] };
  const [h, w] = best.split('x').map(Number);
  const ref = train.find((p) => p.output && dims(p.output).h === h && dims(p.output).w === w)!.output!;
  const color = modeColor(ref, false);
  return { predictions: [makeGrid(h, w, color)], note: `Predicts the modal train output shape (${h}×${w}) filled with its dominant color.` };
}

function nearestTrain(train: Pair[], testInput: Grid): SolverOutput {
  let bestPair: Pair | null = null;
  let bestDist = Infinity;
  for (const p of train) {
    const d = diffGrids(p.input, testInput);
    const dist = d.shapeEqual ? d.diffCells : Math.abs(dims(p.input).h - testInput.length) + Math.abs(dims(p.input).w - (testInput[0]?.length ?? 0)) + 1000;
    if (dist < bestDist) {
      bestDist = dist;
      bestPair = p;
    }
  }
  if (!bestPair?.output) return { predictions: [] };
  return { predictions: [bestPair.output.map((r) => [...r])], note: 'Returns the output of the pixel-nearest training input.' };
}

/**
 * Rule-based baseline: finds a single geometric op OR a single recolor that is
 * consistent across ALL demonstrations, and applies it to the test input.
 */
function ruleBased(train: Pair[], testInput: Grid): SolverOutput {
  // geometric ops
  for (const op of GEO_OPS) {
    const fits = train.every((p) => p.output && gridsEqual(op.fn(p.input), p.output));
    if (fits) {
      return { predictions: [op.fn(testInput)], note: `Consistent rule found: ${op.label}.` };
    }
  }
  // identity recolor variants: a→b
  const colors = new Set<number>();
  for (const p of train) {
    for (const row of p.input) for (const c of row) colors.add(c);
    if (p.output) for (const row of p.output) for (const c of row) colors.add(c);
  }
  const colorList = [...colors];
  for (const a of colorList) {
    for (const b of colorList) {
      if (a === b) continue;
      const fits = train.every((p) => p.output && gridsEqual(recolor(p.input, { [a]: b }), p.output));
      if (fits) {
        return { predictions: [recolor(testInput, { [a]: b })], note: `Consistent rule found: recolor ${a}→${b}.` };
      }
    }
  }
  // object ops: keepLargest
  const largestFits = train.every((p) => {
    if (!p.output) return false;
    const det = findObjects(p.input);
    if (det.objects.length === 0) return false;
    return gridsEqual(keepObjects(p.input, [largestObject(det.objects)]), p.output);
  });
  if (largestFits) {
    const det = findObjects(testInput);
    if (det.objects.length > 0) {
      return { predictions: [keepObjects(testInput, [largestObject(det.objects)])], note: 'Consistent rule found: keep the largest object.' };
    }
  }
  return copyInput(train, testInput);
}

function programSearch(train: Pair[], testInput: Grid): SolverOutput {
  const cands = searchPrograms(train, { maxOps: 2, timeBudgetMs: 2500, topK: 4 });
  if (cands.length === 0) return { predictions: [testInput.map((r) => [...r])], note: 'No consistent program found within budget; copy-input fallback.' };
  const predictions: Grid[] = [];
  for (const cand of cands) {
    const pred = applyProgram(testInput, cand.program);
    if (pred && !predictions.some((p) => gridsEqual(p, pred))) predictions.push(pred);
    if (predictions.length >= 2) break;
  }
  if (predictions.length === 0) predictions.push(testInput.map((r) => [...r]));
  return {
    predictions: predictions.slice(0, 2),
    note: `Best program (${cands[0].program.map((o) => o.op).join(' → ')}), fits train: ${cands[0].fitsAll}.`,
  };
}

async function ensemble(train: Pair[], testInput: Grid): Promise<SolverOutput> {
  const ps = programSearch(train, testInput);
  const first = ps.predictions[0];
  const rb = ruleBased(train, testInput);
  const predictions: Grid[] = [];
  if (first) predictions.push(first);
  for (const p of rb.predictions) {
    if (predictions.length >= 2) break;
    if (!predictions.some((q) => gridsEqual(q, p))) predictions.push(p);
  }
  if (predictions.length === 0) predictions.push(testInput.map((r) => [...r]));
  return { predictions: predictions.slice(0, 2), note: `Program-search preferred; falls back to rule-based (${rb.note ?? ''}).` };
}

async function llmGlm(train: Pair[], testInput: Grid): Promise<SolverOutput> {
  const res = await solveWithLlm(train, testInput, 2);
  return { predictions: res.predictions, note: res.note };
}

export const SOLVERS: SolverDef[] = [
  {
    id: 'copy-input',
    name: 'Copy-Input (sanity)',
    kind: 'baseline',
    description: 'Predicts the test input unchanged. Verifies the evaluation pipeline end to end.',
    limitations: 'Solves only identity-style tasks by construction.',
    run: copyInput,
  },
  {
    id: 'majority-fill',
    name: 'Majority Fill',
    kind: 'baseline',
    description: 'Predicts the most common training output shape filled with its dominant color.',
    limitations: 'Ignores the test input entirely; useful as a weak reference point.',
    run: majorityFill,
  },
  {
    id: 'nearest-train',
    name: 'Nearest Train',
    kind: 'baseline',
    description: 'Returns the output of the pixel-nearest training input to the test input.',
    limitations: 'Cannot generalize beyond memorized examples.',
    run: nearestTrain,
  },
  {
    id: 'rule-based',
    name: 'Rule-Based',
    kind: 'baseline',
    description: 'Searches single geometric ops, single recolors, and keep-largest for a rule consistent across all demonstrations.',
    limitations: 'Only one-step rules; no composition, no shifting.',
    run: ruleBased,
  },
  {
    id: 'program-search',
    name: 'Program Search (DSL)',
    kind: 'search',
    description: 'Bounded search over a 20-op DSL (geometry, color, shape, object ops) with pruning on the first demonstration and consistency scoring across all.',
    limitations: 'Depth ≤ 2 within time budget; parameters are enumerated from a bounded grid.',
    slow: true,
    run: programSearch,
  },
  {
    id: 'ensemble',
    name: 'Ensemble',
    kind: 'ensemble',
    description: 'Prefers program-search predictions; falls back to rule-based, then copy-input. Explicit deterministic selection criteria.',
    limitations: 'Inherits limitations of its members; no learned selection.',
    slow: true,
    run: ensemble,
  },
  {
    id: 'llm-glm',
    name: 'LLM Adapter (GLM)',
    kind: 'llm',
    description: 'Sends demonstration pairs to an LLM which returns candidate output grids as JSON. Two samples for pass@2.',
    limitations: 'Network-dependent; may fail to parse; capped tasks per run; copy-input fallback on failure.',
    slow: true,
    run: llmGlm,
  },
];

export function getSolver(id: string): SolverDef | undefined {
  return SOLVERS.find((s) => s.id === id);
}

export function sanitizeTaskForSolver(task: Task): { train: Pair[]; testInput: Grid } {
  return {
    train: task.train.map((p) => ({ input: p.input, output: p.output ?? undefined })),
    testInput: task.test[0].input,
  };
}

export { countColor };
