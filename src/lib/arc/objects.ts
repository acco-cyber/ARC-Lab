/**
 * ARC Lab — object (connected component) detection and object-level operations.
 *
 * An "object" is a set of cells of the same non-background color. Objects are
 * *detected properties*, not guaranteed ground truth — the Workbench presents
 * them as such.
 */

import type { Color, Grid } from './types';
import { cloneGrid, dims, makeGrid } from './grid';

export interface BBox {
  minR: number;
  minC: number;
  maxR: number;
  maxC: number;
}

export interface ArcObject {
  id: number; // 1-based
  color: Color;
  cells: Array<[number, number]>;
  size: number;
  bbox: BBox;
  height: number;
  width: number;
  symmetricH: boolean; // object symmetric within its bbox (left-right)
  symmetricV: boolean;
  touchesBorder: boolean;
}

export interface ObjectDetection {
  objects: ArcObject[];
  /** Same dims as grid; value = object id (0 = background), for overlays. */
  overlay: number[][];
}

export function findObjects(g: Grid, opts?: { bg?: Color; connectivity?: 4 | 8 }): ObjectDetection {
  const bg = opts?.bg ?? 0;
  const conn = opts?.connectivity ?? 4;
  const { h, w } = dims(g);
  const overlay = makeGrid(h, w, 0);
  const objects: ArcObject[] = [];
  let nextId = 1;

  const neighbors: Array<[number, number]> =
    conn === 4
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (g[r][c] === bg || overlay[r][c] !== 0) continue;
      const id = nextId++;
      const color = g[r][c];
      const cells: Array<[number, number]> = [];
      const stack: Array<[number, number]> = [[r, c]];
      overlay[r][c] = id;
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        cells.push([cr, cc]);
        for (const [dr, dc] of neighbors as Array<[number, number]>) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= h || nc < 0 || nc >= w) continue;
          if (overlay[nr][nc] !== 0) continue;
          if (g[nr][nc] !== color) continue;
          overlay[nr][nc] = id;
          stack.push([nr, nc]);
        }
      }
      const bbox = bboxOf(cells);
      objects.push({
        id,
        color,
        cells,
        size: cells.length,
        bbox,
        height: bbox.maxR - bbox.minR + 1,
        width: bbox.maxC - bbox.minC + 1,
        symmetricH: cellsSymmetricH(cells),
        symmetricV: cellsSymmetricV(cells),
        touchesBorder:
          bbox.minR === 0 || bbox.minC === 0 || bbox.maxR === h - 1 || bbox.maxC === w - 1,
      });
    }
  }
  return { objects, overlay };
}

export function bboxOf(cells: Array<[number, number]>): BBox {
  let minR = Infinity,
    minC = Infinity,
    maxR = -Infinity,
    maxC = -Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return { minR, minC, maxR, maxC };
}

function cellsSymmetricH(cells: Array<[number, number]>): boolean {
  const bbox = bboxOf(cells);
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  for (const [r, c] of cells) {
    if (!set.has(`${r},${bbox.minC + bbox.maxC - c}`)) return false;
  }
  return true;
}

function cellsSymmetricV(cells: Array<[number, number]>): boolean {
  const bbox = bboxOf(cells);
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  for (const [r, c] of cells) {
    if (!set.has(`${bbox.minR + bbox.maxR - r},${c}`)) return false;
  }
  return true;
}

export function largestObject(objs: ArcObject[]): ArcObject {
  return objs.reduce((best, o) => (o.size > best.size ? o : best), objs[0]);
}

export function smallestObject(objs: ArcObject[]): ArcObject {
  return objs.reduce((best, o) => (o.size < best.size ? o : best), objs[0]);
}

/** Keep only the given objects' cells; everything else becomes bg. */
export function keepObjects(g: Grid, objs: ArcObject[], bg: Color = 0): Grid {
  const out = makeGrid(dims(g).h, dims(g).w, bg);
  for (const o of objs) {
    for (const [r, c] of o.cells) out[r][c] = o.color;
  }
  return out;
}

/** Remove the given objects (cells → bg). */
export function removeObjects(g: Grid, objs: ArcObject[], bg: Color = 0): Grid {
  const out = cloneGrid(g);
  for (const o of objs) {
    for (const [r, c] of o.cells) out[r][c] = bg;
  }
  return out;
}

/**
 * Gravity: every object falls straight down until it collides with another
 * object or the bottom edge. All movable objects advance one step per tick
 * (simultaneous), repeated until stable — standard ARC "gravity" semantics.
 */
export function gravityDown(g: Grid, bg: Color = 0): Grid {
  const { h, w } = dims(g);
  let out = cloneGrid(g);
  for (let tick = 0; tick < h; tick++) {
    const det = findObjects(out, { bg, connectivity: 4 });
    if (det.objects.length === 0) break;
    let anyMoved = false;
    // target positions if each object moved down 1
    const occupied = new Set<string>();
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (out[r][c] !== bg) occupied.add(`${r},${c}`);
      }
    }
    const moves: Array<{ cells: Array<[number, number]>; color: Color }> = [];
    for (const o of det.objects) {
      const canMove = o.cells.every(([r, c]) => {
        const nr = r + 1;
        if (nr >= h) return false;
        const key = `${nr},${c}`;
        // target cell must be empty or part of this object
        if (occupied.has(key) && !o.cells.some(([orr, occ]) => orr === nr && occ === c)) return false;
        return true;
      });
      if (canMove) {
        anyMoved = true;
        moves.push({ cells: o.cells.map(([r, c]) => [r + 1, c] as [number, number]), color: o.color });
      } else {
        moves.push({ cells: o.cells, color: o.color });
      }
    }
    if (!anyMoved) break;
    const next = makeGrid(h, w, bg);
    for (const m of moves) {
      for (const [r, c] of m.cells) next[r][c] = m.color;
    }
    out = next;
  }
  return out;
}

/** Mirror each object horizontally within its own bounding box (in place). */
export function mirrorObjectsInPlace(g: Grid, bg: Color = 0): Grid {
  const { h, w } = dims(g);
  const out = makeGrid(h, w, bg);
  const det = findObjects(g, { bg, connectivity: 4 });
  for (const o of det.objects) {
    for (const [r, c] of o.cells) {
      out[r][o.bbox.minC + o.bbox.maxC - c] = o.color;
    }
  }
  return out;
}

/** Draw a rectangle frame of `frameColor` around each object's bbox (in place). */
export function frameEachObject(g: Grid, frameColor: Color, bg: Color = 0): Grid {
  const { h, w } = dims(g);
  const out = cloneGrid(g);
  const det = findObjects(g, { bg, connectivity: 4 });
  for (const o of det.objects) {
    for (let c = o.bbox.minC - 1; c <= o.bbox.maxC + 1; c++) {
      for (const r of [o.bbox.minR - 1, o.bbox.maxR + 1]) {
        if (r >= 0 && r < h && c >= 0 && c < w && out[r][c] === bg) out[r][c] = frameColor;
      }
    }
    for (let r = o.bbox.minR - 1; r <= o.bbox.maxR + 1; r++) {
      for (const c of [o.bbox.minC - 1, o.bbox.maxC + 1]) {
        if (r >= 0 && r < h && c >= 0 && c < w && out[r][c] === bg) out[r][c] = frameColor;
      }
    }
  }
  return out;
}

/**
 * Translate `cells` by (dr, dc) onto an empty grid of size h×w.
 * Returns null if any cell would leave the grid.
 */
export function placeCells(
  h: number,
  w: number,
  cells: Array<[number, number]>,
  color: Color,
  dr: number,
  dc: number,
): Grid | null {
  const out = makeGrid(h, w, 0);
  for (const [r, c] of cells) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= h || nc < 0 || nc >= w) return null;
    out[nr][nc] = color;
  }
  return out;
}
