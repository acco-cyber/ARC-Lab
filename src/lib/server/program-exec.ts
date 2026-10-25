/**
 * ARC Lab — sandboxed JS program executor for verified program synthesis
 * (SERVER ONLY). Used by the APEX-style agent to run LLM-written programs
 * against demonstration pairs.
 *
 * Mirrors the acco-cyber/ARC-AGI-2 Phase-B contract: a program is only
 * accepted if it reproduces EVERY demonstration pair exactly.
 */

import vm from 'node:vm';
import type { Grid, Pair } from '@/lib/arc/types';

export interface ExecOutcome {
  ok: boolean;
  grid?: Grid;
  error?: string;
}

function validate(g: unknown): g is Grid {
  if (!Array.isArray(g) || g.length === 0 || g.length > 90) return false;
  const w = (g[0] as unknown[])?.length;
  if (typeof w !== 'number' || w === 0 || w > 90) return false;
  return g.every((row) => Array.isArray(row) && row.length === w && row.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 9));
}

/** Pure grid helpers exposed to synthesized programs (mirrors the engine's DSL surface). */
function makeHelpers() {
  const dims = (g: Grid) => ({ h: g.length, w: g[0]?.length ?? 0 });
  const clone = (g: Grid): Grid => g.map((r) => [...r]);
  const make = (h: number, w: number, fill = 0): Grid => Array.from({ length: h }, () => Array(w).fill(fill));
  const rot90 = (g: Grid): Grid => {
    const h = g.length, w = g[0].length;
    const out = make(w, h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[c][h - 1 - r] = g[r][c];
    return out;
  };
  return {
    dims, clone, make, rot90,
    rot180: (g: Grid): Grid => g.map((r) => [...r].reverse()).reverse(),
    rot270: (g: Grid): Grid => {
      const h = g.length, w = g[0].length;
      const out = make(w, h);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[w - 1 - c][r] = g[r][c];
      return out;
    },
    flipH: (g: Grid): Grid => g.map((r) => [...r].reverse()),
    flipV: (g: Grid): Grid => [...g].reverse(),
    transpose: (g: Grid): Grid => g[0].map((_, c) => g.map((r) => r[c])),
    recolor: (g: Grid, map: Record<number, number>): Grid => g.map((r) => r.map((c) => (map[c] === undefined ? c : map[c]))),
    shift: (g: Grid, dr: number, dc: number): Grid => {
      const { h, w } = dims(g);
      const out = make(h, w);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < h && nc >= 0 && nc < w) out[nr][nc] = g[r][c];
      }
      return out;
    },
    cropToContent: (g: Grid): Grid => {
      let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
      g.forEach((row, r) => row.forEach((c, ci) => {
        if (c !== 0) { minR = Math.min(minR, r); minC = Math.min(minC, ci); maxR = Math.max(maxR, r); maxC = Math.max(maxC, ci); }
      }));
      if (maxR < 0) return clone(g);
      const out = make(maxR - minR + 1, maxC - minC + 1);
      for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) out[r - minR][c - minC] = g[r][c];
      return out;
    },
  };
}

export type Helpers = ReturnType<typeof makeHelpers>;

/**
 * LLMs often ignore the "body only" contract and return a full function
 * declaration (`function solve(train, testInput, H) { ... }`). Extract the
 * body so it still compiles under the body-wrapper contract.
 */
export function extractFunctionBody(code: string): string {
  const m = code.match(/^\s*(?:async\s+)?function\s*[A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/);
  if (!m) return code;
  const open = code.indexOf('{', m[0].length - 1);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return code;
}

/**
 * Compiles `code` (a function *body*) into solve(train, testInput, H) and runs it
 * inside a fresh vm context with a hard timeout. No require/process/network access.
 * Also tolerates code that RETURNS a solver function (`return function (...) {...}`).
 */
export function compileSolver(code: string): { ok: true; fn: (train: Pair[], testInput: Grid, H: Helpers) => unknown } | { ok: false; error: string } {
  const body = extractFunctionBody(code);
  const src = `(function () {\n"use strict";\nreturn (function (train, testInput, H) {\n${body}\n});\n})()`;
  try {
    const context = vm.createContext({ JSON, Math, Number, String, Boolean, Array, Object, Infinity, NaN, parseInt, parseFloat, isNaN, isFinite });
    const factory = vm.runInContext(src, context, { timeout: 1000 }) as unknown;
    if (typeof factory !== 'function') return { ok: false, error: 'Code did not evaluate to a function.' };
    const solver = (train: Pair[], testInput: Grid, H: Helpers): unknown => {
      const first = (factory as (t: Pair[], i: Grid, h: Helpers) => unknown)(train, testInput, H);
      if (typeof first === 'function') {
        // the body returned its own solver function — call it with the same args
        return (first as (t: Pair[], i: Grid, h: Helpers) => unknown)(train, testInput, H);
      }
      return first;
    };
    return { ok: true, fn: solver };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function runSolver(solver: (train: Pair[], testInput: Grid, H: Helpers) => unknown, train: Pair[], testInput: Grid, timeoutMs = 2000): ExecOutcome {
  try {
    const context = vm.createContext({ JSON, Math, Number, String, Boolean, Array, Object, Infinity, NaN, parseInt, parseFloat, isNaN, isFinite });
    const out = vm.runInContext('1', context, { timeout: 10 }); // warm no-op
    void out;
    // vm has no per-call async timeout, so run synchronously with a wall-clock guard:
    const started = Date.now();
    const result = solver(train, testInput, makeHelpers());
    if (Date.now() - started > timeoutMs) return { ok: false, error: 'timeout' };
    if (!validate(result)) return { ok: false, error: 'Program did not return a valid grid (rectangular ints 0..9).' };
    return { ok: true, grid: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
