/**
 * ARC Lab — grid transformations.
 * These are the shared semantics used by the Academy generators, the
 * Workbench DSL, and the Arena solvers — one implementation everywhere.
 */

import type { Color, Grid } from './types';
import { cloneGrid, dims, makeGrid } from './grid';

/** Rotate 90° clockwise. */
export function rotate90(g: Grid): Grid {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const out: Grid = makeGrid(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[c][h - 1 - r] = g[r][c];
    }
  }
  return out;
}

export function rotate180(g: Grid): Grid {
  return rotate90(rotate90(g));
}

export function rotate270(g: Grid): Grid {
  return rotate90(rotate90(rotate90(g)));
}

/** Mirror horizontally (left ↔ right). */
export function flipH(g: Grid): Grid {
  return g.map((row) => [...row].reverse());
}

/** Mirror vertically (top ↔ bottom). */
export function flipV(g: Grid): Grid {
  return [...g].reverse().map((row) => [...row]);
}

export function transpose(g: Grid): Grid {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const out: Grid = makeGrid(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[c][r] = g[r][c];
    }
  }
  return out;
}

/**
 * Shift content by (dr, dc). Positive dr = down, positive dc = right.
 * Cells shifted out of bounds are dropped; vacated cells become `bg`.
 */
export function shift(g: Grid, dr: number, dc: number, bg: Color = 0): Grid {
  const { h, w } = dims(g);
  const out = makeGrid(h, w, bg);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const sr = r - dr;
      const sc = c - dc;
      if (sr >= 0 && sr < h && sc >= 0 && sc < w) out[r][c] = g[sr][sc];
    }
  }
  return out;
}

/** Integer nearest-neighbor scaling by factor k ≥ 1. */
export function scale(g: Grid, k: number): Grid {
  if (k <= 1) return cloneGrid(g);
  const { h, w } = dims(g);
  const out = makeGrid(h * k, w * k);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          out[r * k + i][c * k + j] = g[r][c];
        }
      }
    }
  }
  return out;
}

/** Tile the grid ry times vertically and rx times horizontally. */
export function tile(g: Grid, ry: number, rx: number): Grid {
  const { h, w } = dims(g);
  const out = makeGrid(h * ry, w * rx);
  for (let ty = 0; ty < ry; ty++) {
    for (let tx = 0; tx < rx; tx++) {
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          out[ty * h + r][tx * w + c] = g[r][c];
        }
      }
    }
  }
  return out;
}

/** Recolor cells via mapping; unmapped cells keep their color. */
export function recolor(g: Grid, map: Record<number, Color>): Grid {
  return g.map((row) => row.map((cell) => (cell in map ? map[cell] : cell)));
}

export function fillAll(g: Grid, color: Color): Grid {
  return g.map((row) => row.map(() => color));
}

/** Wrap the grid in a one-cell border of `color` (dims +2). */
export function wrapFrame(g: Grid, color: Color): Grid {
  const { h, w } = dims(g);
  const out = makeGrid(h + 2, w + 2, color);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) out[r + 1][c + 1] = g[r][c];
  }
  return out;
}

/** Crop to the bounding box of non-background content. */
export function cropContent(g: Grid, bg: Color = 0): Grid {
  const { h, w } = dims(g);
  let minR = h,
    maxR = -1,
    minC = w,
    maxC = -1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (g[r][c] !== bg) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return [[0]];
  const out = makeGrid(maxR - minR + 1, maxC - minC + 1);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) out[r - minR][c - minC] = g[r][c];
  }
  return out;
}

/** Complete horizontal symmetry: mirror the left half onto the right half.
 * Input width may be half (floor) of output width. */
export function completeSymmetryH(g: Grid): Grid {
  const { h, w } = dims(g);
  const out = makeGrid(h, w * 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[r][c] = g[r][c];
      out[r][2 * w - 1 - c] = g[r][c];
    }
  }
  return out;
}

/** Complete vertical symmetry: mirror the top half onto the bottom half. */
export function completeSymmetryV(g: Grid): Grid {
  const t = transpose(completeSymmetryH(transpose(g)));
  return t;
}

// ---------------------------------------------------------------------------
// Deterministic geometric op registry (used by solvers + DSL search).
// ---------------------------------------------------------------------------

export type GeoOpId = 'rotate90' | 'rotate180' | 'rotate270' | 'flipH' | 'flipV' | 'transpose';

export const GEO_OPS: Array<{ id: GeoOpId; label: string; fn: (g: Grid) => Grid }> = [
  { id: 'rotate90', label: 'rotate 90° cw', fn: rotate90 },
  { id: 'rotate180', label: 'rotate 180°', fn: rotate180 },
  { id: 'rotate270', label: 'rotate 270° cw', fn: rotate270 },
  { id: 'flipH', label: 'flip horizontal', fn: flipH },
  { id: 'flipV', label: 'flip vertical', fn: flipV },
  { id: 'transpose', label: 'transpose', fn: transpose },
];

export function applyGeoOp(id: GeoOpId, g: Grid): Grid {
  const op = GEO_OPS.find((o) => o.id === id);
  if (!op) return cloneGrid(g);
  return op.fn(g);
}
