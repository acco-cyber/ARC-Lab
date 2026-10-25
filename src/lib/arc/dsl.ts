/**
 * ARC Lab — bounded DSL for transformation programs.
 *
 * The DSL is shared by the Workbench program builder/trace and the Arena
 * program-search baseline. Semantics are identical to the generator
 * transformations (one implementation, reused everywhere).
 */

import type { Color, Grid, Pair } from './types';
import { gridsEqual, uniqueColors } from './grid';
import * as T from './transforms';
import {
  findObjects,
  gravityDown,
  keepObjects,
  largestObject,
  mirrorObjectsInPlace,
  smallestObject,
  frameEachObject,
} from './objects';

// ---------------------------------------------------------------------------
// Program representation (JSON-serializable)
// ---------------------------------------------------------------------------

export type OpParams = Record<string, number | Array<[number, number]>>;

export interface DslOp {
  op: string;
  params: OpParams;
}

export type Program = DslOp[];

export interface OpSpec {
  op: string;
  label: string;
  category: 'geometry' | 'shape' | 'color' | 'object';
  /** Human description with params filled in. */
  describe: (p: OpParams) => string;
  apply: (g: Grid, p: OpParams) => Grid;
  /**
   * Enumerate bounded parameter combos for program search.
   * `colors` = colors present in the task (inputs+outputs).
   */
  paramChoices: (colors: Color[]) => OpParams[];
}

const geoSpecs: Array<{ op: string; label: string; fn: (g: Grid) => Grid }> = [
  { op: 'rotate90', label: 'Rotate 90° cw', fn: T.rotate90 },
  { op: 'rotate180', label: 'Rotate 180°', fn: T.rotate180 },
  { op: 'rotate270', label: 'Rotate 270° cw', fn: T.rotate270 },
  { op: 'flipH', label: 'Flip left-right', fn: T.flipH },
  { op: 'flipV', label: 'Flip top-bottom', fn: T.flipV },
  { op: 'transpose', label: 'Transpose', fn: T.transpose },
];

const geoOpSpecs: OpSpec[] = geoSpecs.map(({ op, label, fn }) => ({
  op,
  label,
  category: 'geometry',
  describe: () => label,
  apply: (g) => fn(g),
  paramChoices: () => [{}],
}));

function intChoices(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}

export const OP_SPECS: OpSpec[] = [
  ...geoOpSpecs,
  {
    op: 'shift',
    label: 'Shift',
    category: 'shape',
    describe: (p) => `Shift by (down ${p.dr}, right ${p.dc})`,
    apply: (g, p) => T.shift(g, Number(p.dr), Number(p.dc)),
    paramChoices: () =>
      intChoices(-2, 2)
        .flatMap((dr) => intChoices(-2, 2).map((dc) => ({ dr, dc })))
        .filter((p) => p.dr !== 0 || p.dc !== 0),
  },
  {
    op: 'scale2',
    label: 'Scale ×2',
    category: 'shape',
    describe: () => 'Scale every cell to a 2×2 block',
    apply: (g) => T.scale(g, 2),
    paramChoices: () => [{}],
  },
  {
    op: 'tile2x2',
    label: 'Tile 2×2',
    category: 'shape',
    describe: () => 'Repeat the grid 2×2',
    apply: (g) => T.tile(g, 2, 2),
    paramChoices: () => [{}],
  },
  {
    op: 'tile1x2',
    label: 'Tile 1×2',
    category: 'shape',
    describe: () => 'Repeat the grid side by side',
    apply: (g) => T.tile(g, 1, 2),
    paramChoices: () => [{}],
  },
  {
    op: 'cropContent',
    label: 'Crop to content',
    category: 'shape',
    describe: () => 'Crop to the bounding box of non-zero cells',
    apply: (g) => T.cropContent(g),
    paramChoices: () => [{}],
  },
  {
    op: 'wrapFrame',
    label: 'Wrap frame',
    category: 'shape',
    describe: (p) => `Add a 1-cell border of ${p.color}`,
    apply: (g, p) => T.wrapFrame(g, Number(p.color)),
    paramChoices: (colors) => colors.map((color) => ({ color })),
  },
  {
    op: 'mapColor',
    label: 'Recolor',
    category: 'color',
    describe: (p) => {
      const pairs = p.pairs as Array<[number, number]>;
      return `Recolor ${pairs.map(([f, t]) => `${f}→${t}`).join(', ')}`;
    },
    apply: (g, p) => {
      const map: Record<number, Color> = {};
      for (const [from, to] of p.pairs as Array<[number, number]>) map[from] = to;
      return T.recolor(g, map);
    },
    paramChoices: (colors) => {
      const out: OpParams[] = [];
      for (const from of colors) {
        for (const to of colors) {
          if (from !== to) out.push({ pairs: [[from, to]] });
        }
      }
      return out;
    },
  },
  {
    op: 'swapColors',
    label: 'Swap colors',
    category: 'color',
    describe: (p) => `Swap ${p.a} ↔ ${p.b}`,
    apply: (g, p) => T.recolor(g, { [Number(p.a)]: Number(p.b), [Number(p.b)]: Number(p.a) }),
    paramChoices: (colors) => {
      const out: OpParams[] = [];
      for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
          out.push({ a: colors[i], b: colors[j] });
        }
      }
      return out;
    },
  },
  {
    op: 'keepColor',
    label: 'Keep one color',
    category: 'color',
    describe: (p) => `Keep only color ${p.color}, erase the rest`,
    apply: (g, p) =>
      T.recolor(
        g,
        Object.fromEntries(
          uniqueColors(g, false)
            .filter((c) => c !== Number(p.color))
            .map((c) => [c, 0]),
        ),
      ),
    paramChoices: (colors) => colors.filter((c) => c !== 0).map((color) => ({ color })),
  },
  {
    op: 'setNonzero',
    label: 'Paint foreground',
    category: 'color',
    describe: (p) => `Paint every non-zero cell ${p.color}`,
    apply: (g, p) =>
      g.map((row) => row.map((c) => (c === 0 ? 0 : Number(p.color)))),
    paramChoices: (colors) => colors.filter((c) => c !== 0).map((color) => ({ color })),
  },
  {
    op: 'keepLargest',
    label: 'Keep largest object',
    category: 'object',
    describe: () => 'Keep only the largest object',
    apply: (g) => {
      const det = findObjects(g);
      if (det.objects.length === 0) return g;
      return keepObjects(g, [largestObject(det.objects)]);
    },
    paramChoices: () => [{}],
  },
  {
    op: 'keepSmallest',
    label: 'Keep smallest object',
    category: 'object',
    describe: () => 'Keep only the smallest object',
    apply: (g) => {
      const det = findObjects(g);
      if (det.objects.length === 0) return g;
      return keepObjects(g, [smallestObject(det.objects)]);
    },
    paramChoices: () => [{}],
  },
  {
    op: 'gravityDown',
    label: 'Gravity down',
    category: 'object',
    describe: () => 'Let every object fall to the bottom',
    apply: (g) => gravityDown(g),
    paramChoices: () => [{}],
  },
  {
    op: 'mirrorInPlace',
    label: 'Mirror objects in place',
    category: 'object',
    describe: () => 'Mirror each object horizontally inside its bounding box',
    apply: (g) => mirrorObjectsInPlace(g),
    paramChoices: () => [{}],
  },
  {
    op: 'frameObjects',
    label: 'Frame objects',
    category: 'object',
    describe: (p) => `Draw a border of ${p.color} around every object`,
    apply: (g, p) => frameEachObject(g, Number(p.color)),
    paramChoices: (colors) => colors.filter((c) => c !== 0).map((color) => ({ color })),
  },
];

export function getOpSpec(op: string): OpSpec | undefined {
  return OP_SPECS.find((s) => s.op === op);
}

/** Apply a single op; returns null on failure (bad params, runtime error). */
export function applyOp(g: Grid, op: DslOp): Grid | null {
  const spec = getOpSpec(op.op);
  if (!spec) return null;
  try {
    const out = spec.apply(g, op.params ?? {});
    // sanity: valid grid
    if (!Array.isArray(out) || out.length === 0 || !Array.isArray(out[0])) return null;
    return out;
  } catch {
    return null;
  }
}

/** Apply a program left-to-right; returns null on any failure. */
export function applyProgram(g: Grid, program: Program): Grid | null {
  let cur = g;
  for (const op of program) {
    const next = applyOp(cur, op);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export function describeProgram(program: Program): string[] {
  return program.map((op) => {
    const spec = getOpSpec(op.op);
    return spec ? spec.describe(op.params ?? {}) : op.op;
  });
}

// ---------------------------------------------------------------------------
// Bounded program search (used by Workbench search + Arena baseline)
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** max program length (default 2, hard cap 3) */
  maxOps?: number;
  /** hard cap on evaluated programs */
  maxPrograms?: number;
  /** wall-clock budget */
  timeBudgetMs?: number;
  /** max candidates returned */
  topK?: number;
}

export interface CandidateProgram {
  program: Program;
  /** fits every training pair exactly */
  fitsAll: boolean;
  /** average pixel accuracy over train pairs */
  trainPixelAcc: number;
  score: number;
  outputs: Grid[]; // predictions for each train input (for inspection)
}

function pixelAcc(a: Grid, b: Grid): number {
  if (a.length !== b.length || a[0].length !== b[0].length) return 0;
  let same = 0;
  const total = a.length * a[0].length;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[0].length; c++) {
      if (a[r][c] === b[r][c]) same++;
    }
  }
  return total === 0 ? 0 : same / total;
}

/**
 * Iterative-deepening search over bounded op sequences with pruning:
 * prefixes are only extended while they fit the FIRST training pair.
 * Deterministic ordering. Never sees the test output.
 */
export function searchPrograms(train: Pair[], opts?: SearchOptions): CandidateProgram[] {
  const maxOps = Math.min(opts?.maxOps ?? 2, 3);
  const maxPrograms = opts?.maxPrograms ?? 200_000;
  const timeBudgetMs = opts?.timeBudgetMs ?? 3000;
  const topK = opts?.topK ?? 12;
  const deadline = Date.now() + timeBudgetMs;

  const colors = new Set<Color>();
  for (const p of train) {
    for (const row of p.input) for (const c of row) colors.add(c);
    if (p.output) for (const row of p.output) for (const c of row) colors.add(c);
  }
  const colorList = [...colors];

  // build op universe
  const universe: DslOp[] = [];
  for (const spec of OP_SPECS) {
    for (const params of spec.paramChoices(colorList)) {
      universe.push({ op: spec.op, params });
    }
  }

  const first = train[0];
  const results: CandidateProgram[] = [];
  let evaluated = 0;

  // level 1..maxOps BFS with pruning on first pair
  let frontier: Array<{ program: Program; grids: Grid[] }> = [];
  // seed: each single op applied to all train inputs
  for (const op of universe) {
    if (Date.now() > deadline || evaluated > maxPrograms) break;
    const grids: Grid[] = [];
    let ok = true;
    for (const p of train) {
      const out = applyOp(p.input, op);
      if (!out) {
        ok = false;
        break;
      }
      grids.push(out);
    }
    if (!ok) continue;
    evaluated++;
    if (!gridsEqual(grids[0], first.output!)) continue; // prune
    frontier.push({ program: [op], grids });
    results.push(scoreCandidate([op], train, grids));
  }

  for (let depth = 2; depth <= maxOps; depth++) {
    if (Date.now() > deadline || frontier.length === 0) break;
    const nextFrontier: Array<{ program: Program; grids: Grid[] }> = [];
    for (const node of frontier) {
      for (const op of universe) {
        if (Date.now() > deadline || evaluated > maxPrograms) break;
        const grids: Grid[] = [];
        let ok = true;
        for (let i = 0; i < train.length; i++) {
          const out = applyOp(node.grids[i], op);
          if (!out) {
            ok = false;
            break;
          }
          grids.push(out);
        }
        if (!ok) continue;
        evaluated++;
        if (!gridsEqual(grids[0], first.output!)) continue;
        nextFrontier.push({ program: [...node.program, op], grids });
        results.push(scoreCandidate([...node.program, op], train, grids));
      }
    }
    frontier = nextFrontier.slice(0, 400); // bound frontier growth
  }

  results.sort((a, b) => b.score - a.score);
  // dedupe by output signature on first pair
  const seen = new Set<string>();
  const deduped: CandidateProgram[] = [];
  for (const cand of results) {
    const key = JSON.stringify(cand.outputs[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cand);
    if (deduped.length >= topK) break;
  }
  return deduped;
}

function scoreCandidate(program: Program, train: Pair[], grids: Grid[]): CandidateProgram {
  let fitsAll = true;
  let accSum = 0;
  for (let i = 0; i < train.length; i++) {
    const expected = train[i].output;
    if (!expected) continue;
    if (!gridsEqual(grids[i], expected)) fitsAll = false;
    accSum += pixelAcc(grids[i], expected);
  }
  const acc = accSum / Math.max(1, train.length);
  const score = (fitsAll ? 1000 : 0) + acc * 100 + (10 - program.length);
  return { program, fitsAll, trainPixelAcc: acc, score, outputs: grids };
}
