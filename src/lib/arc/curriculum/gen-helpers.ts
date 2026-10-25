/**
 * ARC Lab — curriculum generator helpers.
 *
 * Generators construct puzzle instances whose outputs are computed by applying
 * the intended transformation T, so ground truth is correct by construction.
 * Helpers here make each generator short and guarantee determinism per seed.
 */

import type { Color, Grid } from '../types';
import { chance, pick, randInt, shuffle, until, type Rng } from '../rng';
import { dims, gridsEqual, makeGrid } from '../grid';
import * as T from '../transforms';

export interface PairD {
  input: Grid;
  output: Grid;
}

export interface PuzzleDraft {
  train: PairD[];
  testInput: Grid;
  testOutput: Grid;
  /** Tiered: [0] "what changed?" [1] transformation clue [2] worked explanation. */
  hints: [string, string, string];
  explanation: string;
}

export const PALETTE: Color[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Sample n distinct colors from the palette (never 0). */
export function sampleColors(rng: Rng, n: number, exclude: Color[] = []): Color[] {
  const pool = PALETTE.filter((c) => !exclude.includes(c));
  return shuffle(rng, pool).slice(0, Math.min(n, pool.length));
}

/** Random grid with scattered colored cells on background 0. */
export function randGrid(
  rng: Rng,
  h: number,
  w: number,
  opts?: { colors?: Color[]; density?: number; minCells?: number },
): Grid {
  const colors = opts?.colors ?? sampleColors(rng, randInt(rng, 1, 3));
  const density = opts?.density ?? 0.3;
  return until(
    () => {
      const g = makeGrid(h, w, 0);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          if (chance(rng, density)) g[r][c] = pick(rng, colors);
        }
      }
      return g;
    },
    (g) => {
      const n = g.flat().filter((v) => v !== 0).length;
      return n >= (opts?.minCells ?? 1) && n < h * w * 0.9;
    },
  );
}

export interface ScatterObj {
  cells: Array<[number, number]>;
  color: Color;
}

/**
 * Scatter `count` non-overlapping single-color objects.
 * shapes: 'any' (random blob), 'rect', 'line' (h or v), 'square'.
 */
export function scatterObjects(
  rng: Rng,
  h: number,
  w: number,
  count: number,
  opts?: {
    colorPool?: Color[];
    minSize?: number;
    maxSize?: number;
    shapes?: 'any' | 'rect' | 'line' | 'square';
    margin?: number;
  },
): ScatterObj[] {
  const colorPool = opts?.colorPool ?? sampleColors(rng, Math.max(count, 1));
  const minSize = opts?.minSize ?? 1;
  const maxSize = opts?.maxSize ?? 4;
  const margin = opts?.margin ?? 0;
  const taken = new Set<string>();
  const objs: ScatterObj[] = [];
  let guard = 0;
  while (objs.length < count && guard++ < 500) {
    const shape = opts?.shapes ?? pick(rng, ['any', 'rect', 'line'] as const);
    const color = colorPool[objs.length % colorPool.length];
    const size = randInt(rng, minSize, maxSize);
    let cells: Array<[number, number]> = [];
    if (shape === 'line') {
      const horiz = chance(rng, 0.5);
      const r0 = randInt(rng, margin, h - margin - 1 - (horiz ? 0 : size - 1));
      const c0 = randInt(rng, margin, w - margin - 1 - (horiz ? size - 1 : 0));
      for (let i = 0; i < size; i++) {
        cells.push(horiz ? [r0, c0 + i] : [r0 + i, c0]);
      }
    } else if (shape === 'rect' || shape === 'square') {
      const hh = Math.min(shape === 'square' ? size : randInt(rng, 1, size), h - 2 * margin);
      const ww = Math.min(shape === 'square' ? size : randInt(rng, 1, size), w - 2 * margin);
      if (hh < 1 || ww < 1) continue;
      const r0 = randInt(rng, margin, h - margin - hh);
      const c0 = randInt(rng, margin, w - margin - ww);
      for (let r = r0; r < r0 + hh; r++) for (let c = c0; c < c0 + ww; c++) cells.push([r, c]);
    } else {
      // blob: random walk
      const r0 = randInt(rng, margin, h - margin - 1);
      const c0 = randInt(rng, margin, w - margin - 1);
      const set = new Set<string>([`${r0},${c0}`]);
      let frontier: Array<[number, number]> = [[r0, c0]];
      while (set.size < size && frontier.length > 0) {
        const idx = randInt(rng, 0, frontier.length - 1);
        const [r, c] = frontier.splice(idx, 1)[0];
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < margin || nr >= h - margin || nc < margin || nc >= w - margin) continue;
          const key = `${nr},${nc}`;
          if (!set.has(key) && set.size < size) {
            set.add(key);
            frontier.push([nr, nc]);
          }
        }
      }
      cells = [...set].map((s) => {
        const [r, c] = s.split(',').map(Number);
        return [r, c] as [number, number];
      });
    }
    // validity: in-bounds + no overlap
    let ok = cells.length > 0;
    for (const [r, c] of cells) {
      if (r < margin || r >= h - margin || c < margin || c >= w - margin) ok = false;
      if (taken.has(`${r},${c}`)) ok = false;
    }
    if (!ok) continue;
    for (const [r, c] of cells) taken.add(`${r},${c}`);
    objs.push({ cells, color });
  }
  return objs;
}

/** Draw scattered objects onto an empty grid. */
export function drawObjects(h: number, w: number, objs: ScatterObj[], bg: Color = 0): Grid {
  const g = makeGrid(h, w, bg);
  for (const o of objs) for (const [r, c] of o.cells) g[r][c] = o.color;
  return g;
}

/** Generate `count` (input, T(input)) pairs, all distinct inputs, optionally rejecting ambiguous/degenerate ones. */
export function genPairs(
  rng: Rng,
  count: number,
  make: () => PairD,
  opts?: {
    reject?: (p: PairD) => boolean;
    /** alternative transforms that must NOT also fit all pairs (ambiguity guard) */
    alts?: Array<(g: Grid) => Grid>;
  },
): PairD[] {
  const pairs: PairD[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (pairs.length < count && guard++ < 400) {
    const p = make();
    if (gridsEqual(p.input, p.output)) continue;
    const key = JSON.stringify(p.input);
    if (seen.has(key)) continue;
    if (opts?.reject && opts.reject(p)) continue;
    if (opts?.alts && opts.alts.length > 0) {
      // ANY alternative transform that also fits all pairs makes the rule ambiguous
      const ambiguous = opts.alts.some((alt) =>
        pairs.concat(p).every((q) => {
          try {
            return gridsEqual(alt(q.input), q.output);
          } catch {
            return false;
          }
        }),
      );
      if (ambiguous) continue;
    }
    seen.add(key);
    pairs.push(p);
  }
  return pairs;
}

/** Standard hint trio given rule description pieces. */
export function hints3(question: string, clue: string, worked: string): [string, string, string] {
  return [question, clue, worked];
}

export function keyEq(a: Grid, b: Grid): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Build n distinct training pairs (dedup by input; allows equal in/out for identity-style rules). */
export function makeTrain(n: number, make: () => PairD, isOk?: (p: PairD, acc: PairD[]) => boolean): PairD[] {
  const acc: PairD[] = [];
  let guard = 0;
  while (acc.length < n && guard++ < 400) {
    const p = make();
    if (isOk && !isOk(p, acc)) continue;
    acc.push(p);
  }
  return acc;
}

/** Generate a test pair whose input differs from every train input. */
export function distinctTest(make: () => PairD, train: PairD[]): PairD {
  for (let i = 0; i < 80; i++) {
    const p = make();
    if (!train.some((t) => keyEq(t.input, p.input))) return p;
  }
  return make();
}

export function assemble(train: PairD[], test: PairD, hints: [string, string, string], explanation: string): PuzzleDraft {
  return { train, testInput: test.input, testOutput: test.output, hints, explanation };
}

/** Dimension ramp with difficulty d∈[0,1]. */
export function rampDim(rng: Rng, d: number, min: number, max: number): { h: number; w: number } {
  const lo = min;
  const hi = Math.round(min + (max - min) * d);
  const h = randInt(rng, lo, Math.max(lo, hi));
  const w = randInt(rng, lo, Math.max(lo, hi));
  return { h, w };
}

export { chance, pick, randInt, shuffle, until };
export { dims, gridsEqual, makeGrid };
export { T };
