/**
 * ARC Lab — grid utilities: cloning, comparison, measurement.
 */

import type { Color, Grid } from './types';

export function cloneGrid(g: Grid): Grid {
  return g.map((r) => [...r]);
}

export function makeGrid(h: number, w: number, fill: Color = 0): Grid {
  return Array.from({ length: h }, () => Array<Color>(w).fill(fill));
}

export function dims(g: Grid): { h: number; w: number } {
  return { h: g.length, w: g[0]?.length ?? 0 };
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

export interface GridDiff {
  shapeEqual: boolean;
  diffCells: number; // differing cells (0 if shapeEqual and identical)
  totalCells: number;
  firstDiff?: { r: number; c: number };
}

export function diffGrids(a: Grid, b: Grid): GridDiff {
  const da = dims(a);
  const db = dims(b);
  const totalCells = da.h * da.w;
  if (da.h !== db.h || da.w !== db.w) {
    return { shapeEqual: false, diffCells: totalCells, totalCells };
  }
  let diffCells = 0;
  let firstDiff: GridDiff['firstDiff'];
  for (let r = 0; r < da.h; r++) {
    for (let c = 0; c < da.w; c++) {
      if (a[r][c] !== b[r][c]) {
        diffCells++;
        if (!firstDiff) firstDiff = { r, c };
      }
    }
  }
  return { shapeEqual: true, diffCells, totalCells, firstDiff };
}

/** Resize by padding with `fill` (bottom/right) or cropping. */
export function resizeGrid(g: Grid, h: number, w: number, fill: Color = 0): Grid {
  const out = makeGrid(h, w, fill);
  for (let r = 0; r < Math.min(h, g.length); r++) {
    for (let c = 0; c < Math.min(w, g[r].length); c++) out[r][c] = g[r][c];
  }
  return out;
}

export function colorHistogram(g: Grid): Map<Color, number> {
  const m = new Map<Color, number>();
  for (const row of g) {
    for (const cell of row) {
      m.set(cell, (m.get(cell) ?? 0) + 1);
    }
  }
  return m;
}

export function uniqueColors(g: Grid, includeZero = true): Color[] {
  const hist = colorHistogram(g);
  const colors = [...hist.keys()];
  if (!includeZero) return colors.filter((c) => c !== 0).sort((a, b) => a - b);
  return colors.sort((a, b) => a - b);
}

export function countColor(g: Grid, color: Color): number {
  let n = 0;
  for (const row of g) for (const cell of row) if (cell === color) n++;
  return n;
}

/** Most frequent color; ties broken by lower color id for determinism. */
export function modeColor(g: Grid, includeZero = true): Color {
  const hist = colorHistogram(g);
  let best: Color = 0;
  let bestN = -1;
  for (const [c, n] of hist) {
    if (!includeZero && c === 0) continue;
    if (n > bestN || (n === bestN && c < best)) {
      best = c;
      bestN = n;
    }
  }
  return bestN >= 0 ? best : 0;
}

export function isSymmetricH(g: Grid): boolean {
  // mirror across vertical axis (left-right)
  const { h, w } = dims(g);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] !== g[r][w - 1 - c]) return false;
  return true;
}

export function isSymmetricV(g: Grid): boolean {
  const { h, w } = dims(g);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] !== g[h - 1 - r][c]) return false;
  return true;
}

export function isDiagonalSymmetric(g: Grid): boolean {
  const { h, w } = dims(g);
  if (h !== w) return false;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] !== g[c][r]) return false;
  return true;
}

export function gridToPrettyString(g: Grid): string {
  return g.map((row) => row.join(' ')).join('\n');
}

export function cellsOf(g: Grid, color: Color): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < (g[r]?.length ?? 0); c++) {
      if (g[r][c] === color) out.push([r, c]);
    }
  }
  return out;
}
