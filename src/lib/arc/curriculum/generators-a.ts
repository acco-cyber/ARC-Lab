/**
 * ARC Lab — curriculum generators, Worlds 1–5.
 * Every output is computed by applying the intended transformation T to the
 * input, so ground truth is correct by construction. Fully deterministic.
 */

import { cloneGrid, dims, makeGrid } from '../grid';
import { colorName } from '../colors';
import * as T from '../transforms';
import { findObjects, keepObjects, largestObject, smallestObject } from '../objects';
import { chance, genPairs, pick, randInt, sampleColors, scatterObjects, drawObjects, makeTrain, distinctTest, assemble, keyEq, rampDim, type PairD, type PuzzleDraft } from './gen-helpers';
import type { Color, Grid } from '../types';
import type { Rng } from '../rng';

const GEO_ALTS = [T.rotate90, T.rotate180, T.rotate270, T.flipH, T.flipV, T.transpose];

// ---------------------------------------------------------------------------
// World 1 — Grid Explorer
// ---------------------------------------------------------------------------

function genIdentity(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 4, 10);
  const colors = sampleColors(rng, randInt(rng, 2, 3));
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: cloneGrid(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Compare each example side by side — what exactly changes from input to output?',
      'Nothing changes at all. The output keeps the exact size, colors and positions of the input.',
      'The rule is the identity transformation: copy every cell of the input exactly. Reproduce the challenge grid cell for cell, same dimensions and same colors.',
    ],
    'The transformation is the identity: the output is an exact copy of the input grid. This is the simplest possible ARC rule and a sanity check for the editor.',
  );
}

function genFillConstant(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 4, 9);
  const c = pick(rng, sampleColors(rng, 4));
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c2 = 0; c2 < w; c2++) if (chance(rng, 0.4)) g[r][c2] = c;
    return { input: g, output: makeGrid(h, w, c) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The shape of the grid stays the same — but what happens to the colors?',
      `Every cell, including the background, becomes ${colorName(c)} (color ${c}).`,
      `The rule: paint the entire output grid with ${colorName(c)} (color ${c}) — the single color used by the object in the input. Output dims equal input dims.`,
    ],
    `Every example fills the whole grid with ${colorName(c)} — the one color the input pattern uses. The output size matches the input size.`,
  );
}

function genMapOne(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 4, 10);
  const [a, b, o] = sampleColors(rng, 3);
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [a, o]);
    if (!g.flat().includes(a)) g[randInt(rng, 0, h - 1)][randInt(rng, 0, w - 1)] = a;
    return { input: g, output: T.recolor(g, { [a]: b }) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'One color is not acting like the others. Which cells are different in the output?',
      `Every ${colorName(a)} (color ${a}) cell becomes ${colorName(b)} (color ${b}). Nothing else moves.`,
      `The rule is a color mapping: ${colorName(a)} (${a}) → ${colorName(b)} (${b}), all other cells unchanged.`,
    ],
    `A simple substitution rule: recolor every ${colorName(a)} cell to ${colorName(b)}. Grid size and all other colors are preserved.`,
  );
}

function genMapTwo(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 5, 10);
  const [a, b, c, e, o] = sampleColors(rng, 5);
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c2 = 0; c2 < w; c2++) if (chance(rng, 0.45)) g[r][c2] = pick(rng, [a, c, o]);
    if (!g.flat().includes(a)) g[0][0] = a;
    if (!g.flat().includes(c)) g[h - 1][w - 1] = c;
    return { input: g, output: T.recolor(g, { [a]: b, [c]: e }) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Two colors are being rewritten. Track each one separately.',
      `${colorName(a)} (${a}) → ${colorName(b)} (${b}) AND ${colorName(c)} (${c}) → ${colorName(e)} (${e}).`,
      'Two independent substitutions are applied at once. Build the output by replacing each mapped color with its target; everything else is copied.',
    ],
    `Two simultaneous color mappings: ${colorName(a)}→${colorName(b)} and ${colorName(c)}→${colorName(e)}. Apply both mappings in one pass.`,
  );
}

function genSwapTwo(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 5, 10);
  const [a, b, o] = sampleColors(rng, 3);
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.5)) g[r][c] = pick(rng, [a, b, o]);
    if (!g.flat().includes(a)) g[0][0] = a;
    if (!g.flat().includes(b)) g[h - 1][w - 1] = b;
    return { input: g, output: T.recolor(g, { [a]: b, [b]: a }) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Colors are trading places. Which pairs exchange?',
      `${colorName(a)} (${a}) becomes ${colorName(b)} (${b}) and ${colorName(b)} becomes ${colorName(a)} — a symmetric swap.`,
      `The rule is a two-way color swap: ${a} ↔ ${b}. Replace both colors simultaneously (do not apply the map twice).`,
    ],
    `A color exchange: ${colorName(a)} ↔ ${colorName(b)}. Apply the swap in a single pass so cells are not swapped back.`,
  );
}

function genKeepOne(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 5, 10);
  const [a, o1, o2] = sampleColors(rng, 3);
  const make = (): PairD => {
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) g[r][c] = pick(rng, [a, o1, o2]);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: T.recolor(g, { [o1]: 0, [o2]: 0 }) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Most of the drawing disappears. What survives?',
      `Only ${colorName(a)} (color ${a}) cells remain — every other color is erased to black (0).`,
      `The rule is a filter: keep only ${colorName(a)} (${a}) cells; recolor everything else (except the background) to 0.`,
    ],
    `A selection rule: the output keeps only the ${colorName(a)} cells and erases all other colors to background 0. Positions and size of kept cells are unchanged.`,
  );
}

function genCountCells(rng: Rng, d: number): PuzzleDraft {
  const c = pick(rng, sampleColors(rng, 3));
  const o = pick(rng, sampleColors(rng, 2, [c]));
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 3, 5);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c2 = 0; c2 < w; c2++) if (chance(rng, 0.5)) g[r][c2] = pick(rng, [c, o]);
    const n = g.flat().filter((v) => v === c).length;
    return { input: g, output: [[n]] };
  };
  const train = makeTrain(3, make, (p, acc) => {
    const n = p.output[0][0];
    return n >= 1 && n <= 9 && !acc.some((t) => keyEq(t.input, p.input));
  });
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output is a single cell. What could one cell encode about the input?',
      `The single cell equals how many ${colorName(c)} (color ${c}) cells the input contains.`,
      'Count the cells of the target color and output a 1×1 grid whose value is that count. E.g. 6 cells of the color → output [[6]].',
    ],
    `The output is a 1×1 grid containing the number of ${colorName(c)} (color ${c}) cells in the input. Counting becomes a color value.`,
  );
}

function genUniqueColors(rng: Rng, d: number): PuzzleDraft {
  const k = randInt(rng, 2, d < 0.5 ? 3 : 4);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const colors = sampleColors(rng, k);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) g[r][c] = pick(rng, colors);
    const present = [...new Set(g.flat().filter((v) => v !== 0))].sort((x, y) => x - y);
    return { input: g, output: [present] };
  };
  const train = makeTrain(3, make, (p, acc) => p.output[0].length >= 2 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output is one row of colors. Where does its order come from?',
      'The row lists every distinct non-black color in the input, sorted from smallest to largest number.',
      'Collect the distinct non-zero colors of the input, sort them ascending, and output them as a single 1×N row.',
    ],
    'The output is a 1×N row containing the distinct non-zero colors of the input in ascending numeric order.',
  );
}

function genInvertFg(rng: Rng, d: number): PuzzleDraft {
  const { h, w } = rampDim(rng, d, 4, 9);
  const make = (): PairD => {
    const [c1, c2, a] = sampleColors(rng, 3);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [c1, c2]);
    const out = g.map((row) => row.map((v) => (v === 0 ? a : 0)));
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Background and drawing have traded places. What is the new background color?',
      'Every black (0) cell becomes the SAME new color; every previously colored cell becomes black.',
      'The rule is foreground/background inversion: all 0 cells → the new color, all non-zero cells → 0. The new color is the one that fills most of the output.',
    ],
    'Foreground/background inversion: non-zero cells become 0 and 0 cells become the replacement color. Grid size is unchanged.',
  );
}

function genW1Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genMapOne, genSwapTwo, genKeepOne, genFillConstant]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 2 — Shape Detective
// ---------------------------------------------------------------------------

function genCountObjects(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 12);
    const k = randInt(rng, 2, Math.min(9, 2 + Math.round(d * 6)));
    const colorPool = sampleColors(rng, k);
    const objs = scatterObjects(rng, h, w, k, { colorPool, minSize: 1, maxSize: 4, margin: 0 });
    const g = drawObjects(h, w, objs);
    return { input: g, output: [[Math.min(objs.length, 9)]] };
  };
  const train = makeTrain(3, make, (p, acc) => p.output[0][0] >= 2 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The answer is a single cell again. What quantity changes with each example?',
      'It is the number of separate objects (groups of touching cells of one color).',
      'Count the connected objects (4-direction adjacency, one color each) and output a 1×1 grid holding that count.',
    ],
    'The output is a 1×1 grid with the number of objects. Objects are connected groups of same-colored cells (adjacent up/down/left/right).',
  );
}

function genKeepLargest(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 13);
    const k = randInt(rng, 2, 4);
    const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 6, margin: 0 });
    const sizes = objs.map((o) => o.cells.length);
    if (new Set(sizes).size !== sizes.length) return { input: [[0]], output: [[1]] }; // retry marker
    const g = drawObjects(h, w, objs);
    const det = findObjects(g);
    return { input: g, output: keepObjects(g, [largestObject(det.objects)]) };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Only one shape survives. What decides the winner?',
      'The largest object (most cells) stays; all other objects are erased.',
      'Find the object with the most cells (4-adjacency, single color) and erase every other object to 0. The winner keeps its color and position.',
    ],
    'A size-selection rule: keep only the largest object by cell count; everything else becomes background 0.',
  );
}

function genKeepSmallest(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 13);
    const k = randInt(rng, 2, 4);
    const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 6, margin: 0 });
    const sizes = objs.map((o) => o.cells.length);
    if (new Set(sizes).size !== sizes.length) return { input: [[0]], output: [[1]] };
    const g = drawObjects(h, w, objs);
    const det = findObjects(g);
    return { input: g, output: keepObjects(g, [smallestObject(det.objects)]) };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'This time the survivor is tiny. Which object remains?',
      'The smallest object (fewest cells) stays; the rest are erased.',
      'Find the object with the fewest cells and erase every other object to 0.',
    ],
    'Selection by minimum: keep only the smallest object (fewest cells); all other objects become background.',
  );
}

function genSizeParityRecolor(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 2, 4);
    const objColors = sampleColors(rng, k);
    const [c1, c2] = sampleColors(rng, 2, objColors);
    const objs = scatterObjects(rng, h, w, k, { colorPool: objColors, minSize: 1, maxSize: 5, margin: 0 });
    if (new Set(objs.map((o) => o.cells.length % 2)).size < 2) return { input: [[0]], output: [[1]] };
    const g = drawObjects(h, w, objs);
    const out = cloneGrid(g);
    for (const o of objs) {
      const target = o.cells.length % 2 === 0 ? c1 : c2;
      for (const [r, c] of o.cells) out[r][c] = target;
    }
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Object positions never move — only colors change. What property sets the new color?',
      'Even-sized objects become one color; odd-sized objects become the other.',
      `Recolor every object by its size parity: an even number of cells → ${'the first new color'}, odd → the second. Shape and position are untouched.`,
    ],
    'A property-based recolor: each object is repainted according to whether its cell count is even or odd. Count each object\'s cells to decide.',
  );
}

function genCropContent(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 11);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, randInt(rng, 1, 3));
    const top = randInt(rng, 1, 2);
    const left = randInt(rng, 1, 2);
    const ih = randInt(rng, 3, Math.max(3, h - top - 1));
    const iw = randInt(rng, 3, Math.max(3, w - left - 1));
    for (let r = top; r < top + ih && r < h; r++) {
      for (let c = left; c < left + iw && c < w; c++) {
        if (chance(rng, 0.5)) g[r][c] = pick(rng, colors);
      }
    }
    const out = T.cropContent(g);
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => {
    const od = dims(p.output);
    return od.h < dims(p.input).h && od.w < dims(p.input).w && !acc.some((t) => keyEq(t.input, p.input));
  });
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output is a smaller grid. What part of the input does it keep?',
      'It is the tight box around all the drawing — the surrounding empty border is cut away.',
      'Crop the input to the bounding rectangle of all non-zero cells: delete empty rows/columns around the content.',
    ],
    'Cropping: the output is the smallest rectangle containing every non-zero cell (the empty margin is removed).',
  );
}

function genBorderObjects(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 3, 5);
    const inner = scatterObjects(rng, h, w, k - 1, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 3, margin: 2 });
    const edgeColor = pick(rng, sampleColors(rng, 1));
    // place one border-touching object manually
    const bObj: Array<[number, number]> = [];
    const col = randInt(rng, 1, w - 2);
    const len = randInt(rng, 2, 3);
    for (let i = 0; i < len; i++) bObj.push([0, Math.min(w - 1, col + i)]);
    const objs = [...inner, { cells: bObj, color: edgeColor }];
    const f = pick(rng, sampleColors(rng, 2, objs.map((o) => o.color)));
    const g = drawObjects(h, w, objs);
    const det = findObjects(g);
    const out = cloneGrid(g);
    for (const o of det.objects) {
      if (o.touchesBorder) for (const [r, c] of o.cells) out[r][c] = f;
    }
    if (!det.objects.some((o) => !o.touchesBorder) || !det.objects.some((o) => o.touchesBorder)) return { input: [[0]], output: [[1]] };
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Some shapes change color and some do not. What distinguishes them?',
      'Objects touching the grid border are repainted; interior objects keep their color.',
      `Detect which objects touch any edge of the grid and recolor those to ${'the new color'}; leave interior objects alone.`,
    ],
    'A positional rule: objects that touch the grid boundary are recolored; interior objects are unchanged.',
  );
}

function genCountColors(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 10);
    const k = randInt(rng, 2, 5);
    const colors = sampleColors(rng, k);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    const n = new Set(g.flat().filter((v) => v !== 0)).size;
    return { input: g, output: [[n]] };
  };
  const train = makeTrain(3, make, (p, acc) => p.output[0][0] >= 2 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'One cell again — but this time it counts variety, not quantity.',
      'The single cell is how many DIFFERENT non-black colors appear in the input.',
      'Count the distinct non-zero colors and output a 1×1 grid with that number.',
    ],
    'The output is a 1×1 grid holding the number of distinct non-zero colors in the input.',
  );
}

function genW2Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genCountObjects, genKeepLargest, genCropContent, genBorderObjects]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 3 — Spatial Wizard
// ---------------------------------------------------------------------------

function genRotateK(rng: Rng, d: number): PuzzleDraft {
  const k = d < 0.2 ? 1 : d < 0.5 ? 2 : 3;
  const fn = [T.rotate90, T.rotate180, T.rotate270][k - 1];
  const alts = GEO_ALTS.filter((f) => f !== fn);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 9);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, randInt(rng, 2, 3));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: fn(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  const test = distinctTest(make, pairs);
  return assemble(
    pairs,
    test,
    [
      'The drawing is the same but the whole grid has been moved around. How?',
      `Every example turns the grid by the same amount: ${k * 90} degrees clockwise.`,
      `The rule is a rotation of ${k * 90}° clockwise. Cell (r, c) moves accordingly; output dims swap for 90°/270° turns.`,
    ],
    `A fixed rotation: every grid is rotated ${k * 90} degrees clockwise. The rotation amount is identical across all examples.`,
  );
}

// ---------------------------------------------------------------------------

function genFlipAxis(rng: Rng, d: number): PuzzleDraft {
  const useH = chance(rng, 0.5);
  const fn = useH ? T.flipH : T.flipV;
  const alts = GEO_ALTS.filter((f) => f !== fn);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 9);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, randInt(rng, 2, 3));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: fn(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  const test = distinctTest(make, pairs);
  return assemble(
    pairs,
    test,
    [
      'Every example is reflected. Around which line?',
      useH
        ? 'Each row is reversed left-to-right: a horizontal mirror.'
        : 'Each column is reversed top-to-bottom: a vertical mirror.',
      useH
        ? 'The rule is a horizontal flip (mirror across the vertical center line): output[r][c] = input[r][W-1-c].'
        : 'The rule is a vertical flip (mirror across the horizontal center line): output[r][c] = input[H-1-r][c].',
    ],
    useH
      ? 'A horizontal reflection — the grid is mirrored left ↔ right, keeping its size.'
      : 'A vertical reflection — the grid is mirrored top ↔ bottom, keeping its size.',
  );
}

function genTranspose(rng: Rng, d: number): PuzzleDraft {
  const alts = GEO_ALTS.filter((f) => f !== T.transpose);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 9);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, randInt(rng, 2, 3));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: T.transpose(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  const test = distinctTest(make, pairs);
  return assemble(
    pairs,
    test,
    [
      'Rows became columns. What happened to the dimensions?',
      'The grid is flipped across its main diagonal: rows and columns are exchanged.',
      'The rule is the transpose: output[r][c] = input[c][r]. An H×W grid becomes W×H.',
    ],
    'A transpose (diagonal mirror): rows and columns swap places, so the output dimensions are transposed too.',
  );
}

function genShiftDxdy(rng: Rng, d: number): PuzzleDraft {
  const dr = d < 0.5 ? 0 : pick(rng, [-1, 1]);
  const dc = randInt(rng, 1, 2);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 10);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    const maxR = dr > 0 ? h - dr : h - 1;
    const minR = dr < 0 ? -dr : 0;
    const maxC = dc > 0 ? w - dc : w - 1;
    const minC = dc < 0 ? -dc : 0;
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: T.shift(g, dr, dc) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)) && !keyEq(T.shift(p.input, dr, dc), p.input));
  const test = distinctTest(make, train);
  const dirText = `${dr === 0 ? '' : dr > 0 ? `down ${dr}, ` : `up ${-dr}, `}right ${dc}`;
  return assemble(
    train,
    test,
    [
      'The drawing keeps its shape but slides. In which direction and how far?',
      `Every example shifts the content ${dirText}. Vacated cells become black.`,
      `The rule is a translation: shift all content ${dirText} (positive = down/right). Cells pushed out of the grid are lost; the rest of the grid fills with 0.`,
    ],
    `A pure translation by (${dr}, ${dc}) — down ${dr}, right ${dc}. The grid size never changes; exposed cells become background.`,
  );
}

function genFlipThenRotate(rng: Rng, d: number): PuzzleDraft {
  const Tfn = (g: Grid): Grid => T.rotate90(T.flipH(g));
  const alts = [T.flipH, T.rotate90, T.flipV, T.rotate270, T.transpose];
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  const test = distinctTest(make, pairs);
  return assemble(
    pairs,
    test,
    [
      'Two things happen in sequence. Can you find their order?',
      'First mirror left-right, THEN rotate 90° clockwise. Order matters!',
      'The rule is a composition: apply a horizontal flip first, then a 90° clockwise rotation to the result.',
    ],
    'A two-step composition: flip horizontally, then rotate 90° clockwise. Try the reverse order on the examples to see why the order matters.',
  );
}

function genW3Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genRotateK, genFlipAxis, genTranspose, genShiftDxdy, genFlipThenRotate]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 4 — Pattern Hunter
// ---------------------------------------------------------------------------

function genCompleteH(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const h = randInt(rng, 4, Math.max(5, Math.round(6 + d * 4)));
    const w = randInt(rng, 3, Math.max(3, Math.round(4 + d * 3)));
    const left = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) left[r][c] = pick(rng, colors);
    return { input: left, output: T.completeSymmetryH(left) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output is twice as wide. What fills the new columns?',
      'The right half is the mirror image of the input — together they form a horizontally symmetric grid.',
      'The rule: append the horizontal mirror of the input. output[r][W-1-c] = input[r][c] for the second half, producing a left-right symmetric grid.',
    ],
    'Symmetry completion: the input is the LEFT half of a symmetric picture. Mirror it onto the right to complete the pattern (output width = 2 × input width).',
  );
}

function genCompleteV(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const h = randInt(rng, 3, Math.max(3, Math.round(4 + d * 3)));
    const w = randInt(rng, 4, Math.max(5, Math.round(6 + d * 4)));
    const top = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) top[r][c] = pick(rng, colors);
    return { input: top, output: T.completeSymmetryV(top) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output is twice as tall this time. What fills the new rows?',
      'The bottom half is the upside-down mirror of the input — a vertically symmetric grid.',
      'The rule: append the vertical mirror of the input below it, producing a top-bottom symmetric grid (output height = 2 × input height).',
    ],
    'Symmetry completion (vertical): the input is the TOP half. Mirror it downward to complete the picture.',
  );
}

function genFixSymmetry(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const h = randInt(rng, 4, 8);
    const w = randInt(rng, 4, 8) * 2; // even width for easy mirroring
    const left = makeGrid(h, w / 2, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w / 2; c++) if (chance(rng, 0.45)) left[r][c] = pick(rng, colors);
    const sym = T.completeSymmetryH(left);
    const broken = cloneGrid(sym);
    const nBreak = randInt(rng, 1, 3);
    for (let i = 0; i < nBreak; i++) {
      const r = randInt(rng, 0, h - 1);
      const c = randInt(rng, 0, w / 2 - 1);
      broken[r][c] = pick(rng, [0, ...colors.filter((x) => x !== sym[r][c])]);
    }
    return { input: broken, output: sym };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The grid is *almost* symmetric. What is the output doing about the flaws?',
      'The output is the perfectly mirrored version — the mismatched cells are repaired to match their mirror partner.',
      'Find cells that break the left-right symmetry and set them to the color of their mirror counterpart. The output is fully symmetric.',
    ],
    'Symmetry repair: the input is a symmetric grid with 1–3 damaged cells. The output restores the exact mirror image.',
  );
}

function genTile2x2(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const s = randInt(rng, 3, Math.max(3, Math.round(4 + d * 2)));
    const tileG = makeGrid(s, s, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < s; r++) for (let c = 0; c < s; c++) if (chance(rng, 0.45)) tileG[r][c] = pick(rng, colors);
    return { input: tileG, output: T.tile(tileG, 2, 2) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The output repeats something. What and how many times?',
      'The entire input tile is repeated 2×2 — four copies in a square arrangement.',
      'The rule is 2×2 tiling: the output is the input repeated twice horizontally and twice vertically (dims double).',
    ],
    'Tiling: the input is a motif repeated in a 2×2 arrangement. Output dimensions are exactly double.',
  );
}

function genTile1x2(rng: Rng, d: number): PuzzleDraft {
  const vertical = chance(rng, 0.5);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 3, 6);
    const tileG = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) tileG[r][c] = pick(rng, colors);
    return { input: tileG, output: vertical ? T.tile(tileG, 2, 1) : T.tile(tileG, 1, 2) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The tile repeats — but in which direction this time?',
      vertical
        ? 'Two copies stacked vertically.'
        : 'Two copies placed side by side horizontally.',
      vertical
        ? 'The rule: stack the input twice vertically (output height doubles, width unchanged).'
        : 'The rule: repeat the input twice horizontally (output width doubles, height unchanged).',
    ],
    vertical
      ? 'A 2×1 tiling: the motif repeats top-to-bottom.'
      : 'A 1×2 tiling: the motif repeats left-to-right.',
  );
}

function genCheckerComplete(rng: Rng, d: number): PuzzleDraft {
  const [a, b] = sampleColors(rng, 2);
  const make = (): PairD => {
    const h = randInt(rng, 4, 7);
    const w = randInt(rng, 4, 7);
    const full = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) full[r][c] = (r + c) % 2 === 0 ? a : b;
    const partial = cloneGrid(full);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.35)) partial[r][c] = 0;
    return { input: partial, output: full };
  };
  const train = makeTrain(3, make, (p, acc) => {
    const zeros = p.input.flat().filter((v) => v === 0).length;
    return zeros >= 2 && !acc.some((t) => keyEq(t.input, p.input));
  });
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Some cells went missing. What pattern decides their color?',
      'It is a checkerboard: cells alternate between the two colors like a chess board — color depends on (row + column) parity.',
      `The rule: fill every black cell so that (row+column) even → ${colorName(a)} (${a}) and odd → ${colorName(b)} (${b}). Existing cells never change.`,
    ],
    'Checkerboard completion: the two colors alternate by (row + column) parity. Restore the erased cells without touching the rest.',
  );
}

function genQuadComplete(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const h = randInt(rng, 2, 4);
    const w = randInt(rng, 2, 4);
    const q = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.5)) q[r][c] = pick(rng, colors);
    const out = makeGrid(h * 2, w * 2, 0);
    const mirrored = T.flipH(q);
    const flipped = T.flipV(q);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        out[r][c] = q[r][c];
        out[r][w + c] = mirrored[r][c];
        out[h + r][c] = flipped[r][c];
        out[h + r][w + c] = flipped[r][w - 1 - c];
      }
    }
    return { input: q, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The quadrant grows into a full picture with four-way symmetry. What are the rules for each quarter?',
      'Top-right mirrors the input horizontally; bottom-left mirrors it vertically; bottom-right mirrors both.',
      'The rule: place the input top-left; fill top-right with its horizontal mirror, bottom-left with its vertical mirror, bottom-right with the double-mirrored copy.',
    ],
    'Four-way symmetry completion: the input is the top-left quadrant; the other three quadrants are its mirror images.',
  );
}

function genExtend1d(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const p = randInt(rng, 2, 3);
    const colors = sampleColors(rng, p);
    const full = Array.from({ length: p * 3 }, (_, i) => colors[i % p]);
    const take = p + randInt(rng, 0, 1);
    return { input: [full.slice(0, take)], output: [full] };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The input is a short fragment of a longer row. How does it continue?',
      'The row is a repeating pattern — the fragment you see repeats over and over.',
      'The rule: detect the repeating period in the row and repeat it to fill a row three periods long.',
    ],
    'Periodic continuation: the input shows the start of a repeating 1D pattern; the output extends it to three full periods.',
  );
}

function genStripesComplete(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const h = randInt(rng, 4, 7);
    const w = randInt(rng, 4, 7);
    const [a, b] = sampleColors(rng, 2);
    const full = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) {
      const color = r % 2 === 0 ? a : b;
      for (let c = 0; c < w; c++) full[r][c] = color;
    }
    const partial = cloneGrid(full);
    const blanks = randInt(rng, 1, 2);
    const rows = [...Array(h).keys()].sort(() => rng() - 0.5).slice(0, blanks);
    for (const r of rows) for (let c = 0; c < w; c++) partial[r][c] = 0;
    return { input: partial, output: full };
  };
  const train = makeTrain(3, make, (p, acc) => {
    const zeroRows = p.input.filter((row) => row.every((v) => v === 0)).length;
    return zeroRows >= 1 && !acc.some((t) => keyEq(t.input, p.input));
  });
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Whole rows are blank. What fills them in?',
      'The visible rows alternate between two colors — the blank rows continue that stripe pattern.',
      'The rule: rows alternate between the two stripe colors; fill every blank row according to its position in the alternation.',
    ],
    'Stripe completion: rows alternate between two colors. Missing rows are restored by continuing the alternation.',
  );
}

function genW4Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genCompleteH, genCompleteV, genFixSymmetry, genTile2x2, genCheckerComplete, genQuadComplete]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 5 — Color Logic
// ---------------------------------------------------------------------------

function genCycleColors(rng: Rng, d: number): PuzzleDraft {
  const k = d < 0.5 ? 3 : 4;
  const chain = sampleColors(rng, k);
  const map: Record<number, Color> = {};
  for (let i = 0; i < k; i++) map[chain[i]] = chain[(i + 1) % k];
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 9);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) g[r][c] = pick(rng, chain);
    if (!chain.every((col) => g.flat().includes(col))) {
      g[0][0] = chain[0];
      g[0][1 % w] = chain[1 % k];
      if (k > 2) g[0][2 % w] = chain[2];
    }
    return { input: g, output: T.recolor(g, map) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Every color moves to a new value. Is there a cycle?',
      `Yes — follow the chain: ${chain.map((c, i) => `${colorName(c)} (${c}) → ${colorName(chain[(i + 1) % k])} (${chain[(i + 1) % k]})`).join(', ')}.`,
      'The rule is a cyclic substitution: each color in the chain becomes the next one, and the last wraps around to the first.',
    ],
    'A cyclic color rotation: c₁→c₂→…→cₖ→c₁. Apply the whole cycle simultaneously.',
  );
}

function genMapMany(rng: Rng, d: number): PuzzleDraft {
  const n = d < 0.5 ? 3 : 4;
  const colors = sampleColors(rng, n * 2);
  const map: Record<number, Color> = {};
  for (let i = 0; i < n; i++) map[colors[i]] = colors[n + i];
  const srcs = colors.slice(0, n);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 10);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.45)) g[r][c] = pick(rng, srcs);
    for (const s of srcs) if (!g.flat().includes(s)) g[randInt(rng, 0, h - 1)][randInt(rng, 0, w - 1)] = s;
    return { input: g, output: T.recolor(g, map) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      `Several colors are rewritten at once. Build the full table from the ${train.length} examples.`,
      'Each source color consistently maps to one target color across every example.',
      'The rule is a many-entry color table: look up each cell\'s color in the mapping and write its target; unmapped cells stay.',
    ],
    'A multi-entry substitution table learned from the examples. Apply all mappings in one pass.',
  );
}

function genAdjacentHighlight(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 10);
    const [a, other] = sampleColors(rng, 2);
    const [b] = sampleColors(rng, 1, [a, other]);
    const g = makeGrid(h, w, 0);
    // place a few a-objects
    const objs = scatterObjects(rng, h, w, randInt(rng, 1, 3), { colorPool: [a], minSize: 1, maxSize: 3, margin: 1 });
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] === 0 && chance(rng, 0.25)) g[r][c] = other;
    for (const o of objs) for (const [r, c] of o.cells) g[r][c] = a;
    const out = cloneGrid(g);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (g[r][c] === a || g[r][c] === 0) continue;
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => {
          const nr = r + dr;
          const nc = c + dc;
          return nr >= 0 && nr < h && nc >= 0 && nc < w && g[nr][nc] === a;
        });
        if (adj) out[r][c] = b;
      }
    }
    if (!g.flat().some((v, i) => v !== 0 && v !== a && out.flat()[i] === b)) return { input: [[0]], output: [[1]] };
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Only some cells change color. What do they have in common?',
      'They are the cells that directly touch the special-color object (up, down, left or right).',
      `The rule: any non-background cell that is 4-adjacent to the object color becomes the highlight color. The object itself and the background never change.`,
    ],
    'Neighborhood rule: cells orthogonally adjacent to the target-color object are repainted with the highlight color.',
  );
}

function genFrequencyRank(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 10);
    const k = randInt(rng, 2, d < 0.5 ? 3 : 4);
    const colors = sampleColors(rng, k);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.5)) g[r][c] = pick(rng, colors);
    const counts = new Map<number, number>();
    for (const v of g.flat()) if (v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1);
    if (counts.size < 2) return { input: [[0]], output: [[1]] };
    const cvals = [...counts.values()];
    if (new Set(cvals).size !== cvals.length) return { input: [[0]], output: [[1]] };
    const sorted = [...counts.entries()].sort((x, y) => x[1] - y[1]);
    const map: Record<number, Color> = {};
    sorted.forEach(([color], idx) => {
      map[color] = idx + 1;
    });
    return { input: g, output: T.recolor(g, map) };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Colors are renumbered. Does rarity decide the new value?',
      'Count each color: the rarest becomes 1, the next rarest 2, and so on.',
      'The rule: rank the input colors by how often they appear (ascending) and recolor each cell with its color\'s rank (1-based).',
    ],
    'Frequency ranking: each color is replaced by its rank when the colors are sorted by frequency, rarest first.',
  );
}

function genRowGradient(rng: Rng, d: number): PuzzleDraft {
  const k = 3;
  const seq = sampleColors(rng, k);
  const base = pick(rng, sampleColors(rng, 2, seq));
  const make = (): PairD => {
    const h = randInt(rng, 4, Math.max(4, Math.round(6 + d * 4)));
    const w = randInt(rng, 4, 8);
    const g = makeGrid(h, w, base);
    const out = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r][c] = seq[r % k];
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Rows are repainted with a repeating sequence. What is the order?',
      `Reading top to bottom, rows cycle through ${seq.map((c) => colorName(c)).join(' → ')} and then repeat.`,
      `The rule: row r gets seq[r % 3] where the sequence is [${seq.map((c) => colorName(c)).join(', ')}]. The cycle repeats for taller grids.`,
    ],
    'Row-cycle repaint: each row is filled with the next color of a fixed 3-color sequence that repeats down the grid.',
  );
}

function genMirrorDiff(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 9);
    const wEven = w % 2 === 0 ? w : w - 1;
    if (wEven < 4) return { input: [[0]], output: [[1]] };
    const g = makeGrid(h, wEven, 0);
    const colors = sampleColors(rng, 2);
    const [mark] = sampleColors(rng, 1, colors);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < wEven / 2; c++) {
        if (chance(rng, 0.5)) {
          const col = pick(rng, colors);
          g[r][c] = col;
          if (chance(rng, 0.55)) g[r][wEven - 1 - c] = col;
        }
      }
    }
    const out = cloneGrid(g);
    let changed = false;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < wEven; c++) {
        if (g[r][c] !== g[r][wEven - 1 - c] && g[r][c] !== 0) {
          out[r][c] = mark;
          changed = true;
        }
      }
    }
    if (!changed) return { input: [[0]], output: [[1]] };
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => p.input.length > 1 && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Some cells get a marker color. What did those cells do wrong?',
      'They disagree with their horizontal mirror partner — the un-symmetric cells are flagged.',
      'The rule: every non-background cell whose horizontal mirror has a different color is repainted with the marker color; symmetric cells stay.',
    ],
    'Asymmetry detector: cells that differ from their left-right mirror partner are highlighted with the marker color.',
  );
}

function genW5Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genCycleColors, genMapMany, genAdjacentHighlight, genFrequencyRank, genRowGradient, genMirrorDiff]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------

export const GENERATORS_A: Record<string, (rng: Rng, d: number) => PuzzleDraft> = {
  identity: genIdentity,
  'fill-constant': genFillConstant,
  'map-one': genMapOne,
  'map-two': genMapTwo,
  'swap-two': genSwapTwo,
  'keep-one': genKeepOne,
  'count-cells': genCountCells,
  'unique-colors': genUniqueColors,
  'invert-fg': genInvertFg,
  'w1-trial': genW1Trial,
  'count-objects': genCountObjects,
  'keep-largest': genKeepLargest,
  'keep-smallest': genKeepSmallest,
  'size-parity-recolor': genSizeParityRecolor,
  'crop-content': genCropContent,
  'border-objects': genBorderObjects,
  'count-colors': genCountColors,
  'w2-trial': genW2Trial,
  'rotate-k': genRotateK,
  'flip-axis': genFlipAxis,
  transpose: genTranspose,
  'shift-dxdy': genShiftDxdy,
  'flip-then-rotate': genFlipThenRotate,
  'w3-trial': genW3Trial,
  'complete-h': genCompleteH,
  'complete-v': genCompleteV,
  'fix-symmetry': genFixSymmetry,
  'tile-2x2': genTile2x2,
  'tile-1x2': genTile1x2,
  'checker-complete': genCheckerComplete,
  'quad-complete': genQuadComplete,
  'extend-1d': genExtend1d,
  'stripes-complete': genStripesComplete,
  'w4-trial': genW4Trial,
  'cycle-colors': genCycleColors,
  'map-many': genMapMany,
  'adjacent-highlight': genAdjacentHighlight,
  'frequency-rank': genFrequencyRank,
  'row-gradient': genRowGradient,
  'mirror-diff': genMirrorDiff,
  'w5-trial': genW5Trial,
};

// re-exports used by world 6-10 generators
export { scatterObjects, drawObjects, findObjects, keepObjects, largestObject, smallestObject, cloneGrid, dims, makeGrid };
export { T };
export type { Color, Grid };
