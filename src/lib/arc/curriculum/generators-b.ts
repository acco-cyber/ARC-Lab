/**
 * ARC Lab — curriculum generators, Worlds 6–10.
 */

import { cloneGrid, dims, makeGrid } from '../grid';
import { colorName } from '../colors';
import * as T from '../transforms';
import { bboxOf, findObjects, frameEachObject, gravityDown, keepObjects, largestObject, mirrorObjectsInPlace } from '../objects';
import { chance, genPairs, pick, randInt, sampleColors, scatterObjects, drawObjects, makeTrain, distinctTest, assemble, keyEq, rampDim, type PairD, type PuzzleDraft } from './gen-helpers';
import type { Color, Grid } from '../types';
import type { Rng } from '../rng';

const GEO_ALTS = [T.rotate90, T.rotate180, T.rotate270, T.flipH, T.flipV, T.transpose];

// ---------------------------------------------------------------------------
// World 6 — Object Engineer
// ---------------------------------------------------------------------------

function genGravity(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 2, 4);
    const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 4, margin: 0 });
    const g = drawObjects(h, w, objs);
    const out = gravityDown(g);
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The shapes are identical — only their positions changed. In which direction, and what stopped them?',
      'Every object falls straight down until it lands on the floor or on top of another object.',
      'The rule is gravity: each object slides down as far as possible without overlapping others or leaving the grid. Columns are independent.',
    ],
    'Gravity: every object drops to the lowest position it can occupy, stacking on top of other objects.',
  );
}

function genMoveToMarker(rng: Rng, d: number): PuzzleDraft {
  const markerColor = 6;
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 11);
    const objColor = pick(rng, sampleColors(rng, 2, [markerColor]));
    // build single object (small blob/line)
    const objCells: Array<[number, number]> = [];
    const size = randInt(rng, 2, 4);
    const r0 = randInt(rng, 0, Math.max(0, Math.floor(h / 2) - 1));
    const c0 = randInt(rng, 0, Math.max(0, Math.floor(w / 2) - 1));
    for (let i = 0; i < size; i++) objCells.push([r0, Math.min(w - 1, c0 + i)]);
    // marker below-right of object, with room for the object to fit
    const bbox = bboxOf(objCells);
    const oh = bbox.maxR - bbox.minR + 1;
    const ow = bbox.maxC - bbox.minC + 1;
    const mr = randInt(rng, 0, h - oh);
    const mc = randInt(rng, 0, w - ow);
    const g = makeGrid(h, w, 0);
    for (const [r, c] of objCells) g[r][c] = objColor;
    g[mr][mc] = markerColor;
    // output: clear everything, draw object with bbox top-left at marker
    const out = makeGrid(h, w, 0);
    for (const [r, c] of objCells) {
      out[r - bbox.minR + mr][c - bbox.minC + mc] = objColor;
    }
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'One object ends up somewhere new — and one cell disappears from the output. What is the marker cell doing?',
      `The single ${colorName(markerColor)} (6) cell is the destination: the object's top-left corner moves exactly onto it, and the marker is consumed.`,
      `The rule: translate the non-marker object so its bounding-box top-left lands on the ${colorName(markerColor)} cell. The marker itself does not appear in the output.`,
    ],
    'Marker-directed translation: the magenta (6) cell marks where the object\'s top-left corner must go. The marker is removed after the move.',
  );
}

function genFrameObjects(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 1, 3);
    const objColors = sampleColors(rng, k);
    const [f] = sampleColors(rng, 1, objColors);
    const objs = scatterObjects(rng, h, w, k, { colorPool: objColors, minSize: 1, maxSize: 3, margin: 1 });
    const g = drawObjects(h, w, objs);
    const out = frameEachObject(g, f);
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Every shape gained a border. What color and what shape is it?',
      'A 1-cell rectangle of one new color is drawn tightly around each object\'s bounding box.',
      'The rule: draw a rectangular frame (1 cell thick) of the frame color around each object\'s bounding box, only on background cells.',
    ],
    'Object framing: each object gets a 1-cell rectangular border of a single frame color around its bounding box.',
  );
}

function genMirrorInPlace(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 2, 3);
    let objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 2, maxSize: 4, margin: 0 });
    // keep only asymmetric objects
    objs = objs.filter((o) => {
      const set = new Set(o.cells.map(([r, c]) => `${r},${c}`));
      const bb = bboxOf(o.cells);
      return !o.cells.every(([r, c]) => set.has(`${r},${bb.minC + bb.maxC - c}`));
    });
    if (objs.length < 1) return { input: [[0]], output: [[1]] };
    const g = drawObjects(h, w, objs);
    const out = mirrorObjectsInPlace(g);
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'Each object flipped — but the grid border stayed put. How?',
      'Every object is mirrored left-right inside its own bounding box, without moving.',
      'The rule: mirror each object horizontally in place — reflect the object\'s cells across the vertical center of its own bounding box.',
    ],
    'In-place mirroring: every object is flipped horizontally within its own bounding box; objects keep their position and color.',
  );
}

function genAlignLeft(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 12);
    const k = randInt(rng, 2, 3);
    // objects in distinct row bands, none touching the left edge
    const bands = Math.floor(h / 3);
    if (bands < k) return { input: [[0]], output: [[1]] };
    const objs: Array<{ cells: Array<[number, number]>; color: Color }> = [];
    const colors = sampleColors(rng, k);
    const bandIdx = [...Array(bands).keys()].sort(() => rng() - 0.5).slice(0, k);
    for (let i = 0; i < k; i++) {
      const rBase = bandIdx[i] * 3;
      const len = randInt(rng, 2, 3);
      const r = rBase + randInt(rng, 0, 2);
      const c = randInt(rng, 1, w - len - 1);
      if (c < 1 || c + len > w) return { input: [[0]], output: [[1]] };
      const cells: Array<[number, number]> = [];
      for (let j = 0; j < len; j++) cells.push([r, c + j]);
      objs.push({ cells, color: colors[i] });
    }
    const g = drawObjects(h, w, objs);
    const det = findObjects(g);
    const out = makeGrid(h, w, 0);
    for (const o of det.objects) {
      const bb = bboxOf(o.cells);
      for (const [r, c] of o.cells) out[r][c - bb.minC] = o.color;
    }
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The objects slid sideways. Where do they stop?',
      'Each object moves left until it touches the left edge of the grid.',
      'The rule: translate every object horizontally so its leftmost cell is in column 0, keeping its rows unchanged.',
    ],
    'Left alignment: each object is shifted horizontally until it hugs the left wall, preserving its vertical position.',
  );
}

function genScaleObject(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const s = randInt(rng, 2, Math.max(2, Math.round(3 + d * 2)));
    const objColor = pick(rng, sampleColors(rng, 1));
    const shape = pick(rng, ['rect', 'line', 'any'] as const);
    const objs = scatterObjects(rng, s, s, 1, { colorPool: [objColor], minSize: Math.max(2, s - 1), maxSize: s * s, shapes: shape, margin: 0 });
    if (objs.length === 0) return { input: [[0]], output: [[1]] };
    const g = drawObjects(s, s, objs);
    const cropped = T.cropContent(g);
    return { input: g, output: T.scale(cropped, 2) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  const test = distinctTest(make, train);
  return assemble(
    train,
    test,
    [
      'The shape came back bigger. How much bigger, and where does it sit?',
      'Every cell of the shape becomes a 2×2 block — the object is magnified 2×, anchored at the top-left of the output.',
      'The rule: crop the object to its bounding box, then scale it ×2 (each cell becomes a 2×2 square). Output dims = 2 × cropped dims.',
    ],
    'Magnification: the single object is cropped and scaled ×2 — every cell expands into a 2×2 block.',
  );
}

function genW6Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genGravity, genFrameObjects, genMirrorInPlace, genAlignLeft]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 7 — Rule Composer
// ---------------------------------------------------------------------------

function genGeoThenColor(rng: Rng, d: number): PuzzleDraft {
  const geo = pick(rng, [T.rotate90, T.rotate180, T.rotate270, T.flipH, T.flipV, T.transpose]);
  const mode = pick(rng, ['map', 'swap', 'keep'] as const);
  const [a, b, o] = sampleColors(rng, 3);
  let colorFn: (g: Grid) => Grid;
  let colorDesc: string;
  if (mode === 'map') {
    colorFn = (g) => T.recolor(g, { [a]: b });
    colorDesc = `${colorName(a)} (${a}) → ${colorName(b)} (${b})`;
  } else if (mode === 'swap') {
    colorFn = (g) => T.recolor(g, { [a]: b, [b]: a });
    colorDesc = `swap ${colorName(a)} (${a}) ↔ ${colorName(b)} (${b})`;
  } else {
    colorFn = (g) => T.recolor(g, { [o]: 0, [b]: 0 });
    colorDesc = `erase everything except ${colorName(a)} (${a})`;
  }
  const Tfn = (g: Grid): Grid => colorFn(geo(g));
  // Note: recolor commutes with geometry, so "which geometry + which color rule"
  // is the identifiable content of the lesson — disambiguate the geometry only.
  const alts = GEO_ALTS.filter((f) => f !== geo).map((f) => (g: Grid) => colorFn(f(g)));
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    const colors = mode === 'map' ? [a, o] : mode === 'swap' ? [a, b, o] : [a, o, b];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  const geoLabel = describeGeo(geo);
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'This rule has two steps. Find both, and their order.',
      `Step 1 is geometric (${geoLabel}); step 2 is a color rule (${colorDesc}). Geometry happens FIRST.`,
      `The rule: apply the geometric transform (${geoLabel}) to the input, then apply the color rule (${colorDesc}) to the result.`,
    ],
    `A composition: geometry first (${geoLabel}), then color (${colorDesc}). Verify the order on the examples before submitting.`,
  );
}

function describeGeo(fn: (g: Grid) => Grid): string {
  if (fn === T.rotate90) return 'rotate 90° clockwise';
  if (fn === T.rotate180) return 'rotate 180°';
  if (fn === T.rotate270) return 'rotate 270° clockwise';
  if (fn === T.flipH) return 'flip left-right';
  if (fn === T.flipV) return 'flip top-bottom';
  return 'transpose';
}

function genShiftThenFrame(rng: Rng, d: number): PuzzleDraft {
  const dr = pick(rng, [0, 1]);
  const dc = randInt(rng, 1, 2);
  const [f] = sampleColors(rng, 1);
  const Tfn = (g: Grid): Grid => T.wrapFrame(T.shift(g, dr, dc), f);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 8);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h - 1; r++) for (let c = 0; c < w - dc; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: Tfn(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'The drawing moved AND gained a border. Find both steps.',
      `The content shifts ${dr === 0 ? '' : `down ${dr} and `}right ${dc}; then a 1-cell frame of one color wraps the whole grid.`,
      `The rule: shift the content by (${dr}, ${dc}), then wrap the result in a 1-cell border of color ${f}. Output dims are +2 in both directions.`,
    ],
    `Composition: translate by (${dr}, ${dc}), then add a ${colorName(f)} (${f}) border around the entire grid.`,
  );
}

function genShiftThenColor(rng: Rng, d: number): PuzzleDraft {
  const dr = pick(rng, [0, 1]);
  const dc = randInt(rng, 1, 2);
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(T.shift(g, dr, dc), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 9);
    const g = makeGrid(h, w, 0);
    const colors = [a, ...sampleColors(rng, 1, [a, b])];
    for (let r = 0; r < h - 1; r++) for (let c = 0; c < w - dc; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'Two changes again: position and color.',
      `Content shifts (down ${dr}, right ${dc}) and ${colorName(a)} (${a}) becomes ${colorName(b)} (${b}).`,
      `The rule: first translate by (${dr}, ${dc}), then recolor ${a} → ${b}.`,
    ],
    `Composition: shift by (${dr}, ${dc}), then substitute color ${colorName(a)} → ${colorName(b)}.`,
  );
}

function genGravityThenColor(rng: Rng, d: number): PuzzleDraft {
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(gravityDown(g), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 11);
    const k = randInt(rng, 2, 3);
    const objs = scatterObjects(rng, h, w, k, { colorPool: [a, ...sampleColors(rng, 1, [a, b])], minSize: 1, maxSize: 3, margin: 0 });
    const g = drawObjects(h, w, objs);
    return { input: g, output: Tfn(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'Objects fall AND colors change. Order the two steps.',
      'Gravity acts first; the color substitution is applied to the settled result.',
      `The rule: let every object fall to the bottom, then recolor ${colorName(a)} (${a}) → ${colorName(b)} (${b}).`,
    ],
    `Composition: gravity first, then the color mapping ${a} → ${b}.`,
  );
}

function genCropThenGeo(rng: Rng, d: number): PuzzleDraft {
  const geo = pick(rng, [T.flipH, T.rotate90] as const);
  const Tfn = (g: Grid): Grid => geo(T.cropContent(g));
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 10);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    const top = randInt(rng, 1, 2);
    const left = randInt(rng, 1, 2);
    const ih = randInt(rng, 3, h - top - 1);
    const iw = randInt(rng, 3, w - left - 1);
    for (let r = top; r < top + ih; r++) for (let c = left; c < left + iw; c++) if (chance(rng, 0.5)) g[r][c] = pick(rng, colors);
    return { input: g, output: Tfn(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'The result is cropped AND flipped or turned. Which comes first?',
      'Crop to the content box first, then apply the geometric transform to the crop.',
      `The rule: crop the input to its non-zero bounding box, then ${geo === T.flipH ? 'flip it left-right' : 'rotate it 90° clockwise'}.`,
    ],
    `Composition: crop to content, then ${geo === T.flipH ? 'horizontal flip' : '90° rotation'}.`,
  );
}

function genW7Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genGeoThenColor, genShiftThenFrame, genGravityThenColor, genCropThenGeo]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 8 — Context Master
// ---------------------------------------------------------------------------

function genByColorPresence(rng: Rng, d: number): PuzzleDraft {
  const [a, o] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => (g.flat().includes(a) ? T.rotate90(g) : T.flipH(g));
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    const withA = chance(rng, 0.5);
    const colors = withA ? [a, o] : [o];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    if (withA && !g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 4, make, {
    reject: (p) => keyEq(T.rotate90(p.input), T.flipH(p.input)),
  });
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'The geometric move is different from example to example. What signals the change?',
      `If color ${colorName(a)} (${a}) is present the grid rotates 90° cw; otherwise it mirrors left-right.`,
      `The rule is conditional on content: ${colorName(a)} present → rotate 90° clockwise; absent → flip horizontally.`,
    ],
    `Context rule: the presence of color ${colorName(a)} selects the transformation (rotation vs mirror).`,
  );
}

function genByObjectCount(rng: Rng, d: number): PuzzleDraft {
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => {
    const det = findObjects(g);
    if (det.objects.length >= 2) return keepObjects(g, [largestObject(det.objects)]);
    return T.recolor(g, { [a]: b });
  };
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 6, 10);
    if (chance(rng, 0.5)) {
      const k = randInt(rng, 2, 3);
      const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 4, margin: 0 });
      const sizes = objs.map((o) => o.cells.length);
      if (new Set(sizes).size !== sizes.length) return { input: [[0]], output: [[1]] };
      return { input: drawObjects(h, w, objs), output: [[0]] };
    }
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [a]);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = makeTrain(4, make, (p, acc) => {
    if (!p.input.flat().some((v) => v !== 0)) return false;
    const det = findObjects(p.input);
    return !acc.some((t) => keyEq(t.input, p.input)) && (det.objects.length >= 2 || det.objects.length === 1);
  }).map((p) => ({ input: p.input, output: findObjects(p.input).objects.length >= 2 ? keepObjects(p.input, [largestObject(findObjects(p.input).objects)]) : T.recolor(p.input, { [a]: b }) }));
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Sometimes the small shapes vanish, sometimes colors change. What decides?',
      'Count the objects: 2 or more → keep only the largest; exactly 1 → recolor it.',
      `The rule depends on the object count: ≥2 objects → keep the largest; 1 object → recolor ${colorName(a)} (${a}) → ${colorName(b)} (${b}).`,
    ],
    'Context rule on object count: multiple objects trigger size selection; a single object triggers recoloring.',
  );
}

function genByParity(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 9);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: h % 2 === 0 ? T.flipV(g) : T.flipH(g) };
  };
  const pairs = genPairs(rng, 4, make, {
    reject: (p) => {
      const hh = p.input.length;
      const t = hh % 2 === 0 ? T.flipV(p.input) : T.flipH(p.input);
      return keyEq(t, p.input) || keyEq(T.flipH(p.input), T.flipV(p.input));
    },
  });
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Some grids mirror top-bottom, others left-right. What property of the GRID decides?',
      'The parity of the height: even height → vertical flip; odd height → horizontal flip.',
      'The rule: if the number of rows is even, flip top-bottom; if odd, flip left-right.',
    ],
    'Context rule on grid parity: height even → flipV, height odd → flipH.',
  );
}

function genRegionRule(rng: Rng, d: number): PuzzleDraft {
  const [a, b, c] = sampleColors(rng, 3);
  const Tfn = (g: Grid): Grid => {
    const half = Math.floor(g.length / 2);
    return g.map((row, r) => row.map((v) => (v === a ? (r < half ? b : c) : v)));
  };
  const make = (): PairD => {
    const h = randInt(rng, 6, 10);
    const w = randInt(rng, 5, 9);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) {
      for (let col = 0; col < w; col++) {
        if (chance(rng, 0.4)) g[r][col] = pick(rng, [a, ...sampleColors(rng, 0), pick(rng, [0, 0, pick(rng, sampleColors(rng, 1, [a, b, c]))])]);
      }
    }
    for (let i = 0; i < 4; i++) {
      const r = i < 2 ? randInt(rng, 0, Math.floor(h / 2) - 1) : randInt(rng, Math.floor(h / 2), h - 1);
      g[r][randInt(rng, 0, w - 1)] = a;
    }
    return { input: g, output: Tfn(g) };
  };
  const pairs = makeTrain(3, make, (p, acc) => {
    const half = Math.floor(p.input.length / 2);
    const topHas = p.input.slice(0, half).flat().includes(a);
    const botHas = p.input.slice(half).flat().includes(a);
    return topHas && botHas && !acc.some((t) => keyEq(t.input, p.input));
  }).map((p) => ({ input: p.input, output: Tfn(p.input) }));
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      `One source color becomes TWO different colors. What distinguishes the two cases?`,
      `Rows matter: ${colorName(a)} (${a}) becomes ${colorName(b)} (${b}) in the top half and ${colorName(c)} (${c}) in the bottom half.`,
      `The rule is region-based: in the top half of the grid recolor ${a} → ${b}; in the bottom half recolor ${a} → ${c}.`,
    ],
    `Region-dependent recoloring of ${colorName(a)}: top half → ${colorName(b)}, bottom half → ${colorName(c)}.`,
  );
}

function genBySize(rng: Rng, d: number): PuzzleDraft {
  const s = 4;
  const Tfn = (g: Grid): Grid => {
    const det = findObjects(g);
    if (det.objects.length === 0) return g;
    const largest = largestObject(det.objects);
    return largest.size >= s ? keepObjects(g, [largest]) : makeGrid(dims(g).h, dims(g).w, 0);
  };
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 11);
    const big = chance(rng, 0.5);
    const k = big ? randInt(rng, 2, 3) : randInt(rng, 2, 4);
    const maxSize = big ? 6 : 3;
    const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize, margin: 0 });
    const g = drawObjects(h, w, objs);
    return { input: g, output: Tfn(g) };
  };
  const pairs = makeTrain(4, make, (p, acc) => {
    const det = findObjects(p.input);
    if (det.objects.length === 0) return false;
    const big = largestObject(det.objects).size >= s;
    // ensure both cases appear
    const seenBig = acc.some((t) => largestObject(findObjects(t.input).objects).size >= s);
    return big !== seenBig || acc.length === 0 ? !acc.some((t) => keyEq(t.input, p.input)) : false;
  }).map((p) => ({ input: p.input, output: Tfn(p.input) }));
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Sometimes one shape survives, sometimes the grid empties completely. Why?',
      'It depends on size: if the biggest object has 4 or more cells it is kept; otherwise everything is erased.',
      'The rule: keep the largest object only when its size ≥ 4; otherwise output an all-black grid of the same size.',
    ],
    'Threshold rule on object size: largest object ≥ 4 cells → keep it; smaller → the output is empty (all zeros).',
  );
}

function genByShape(rng: Rng, d: number): PuzzleDraft {
  const [f, a, b] = sampleColors(rng, 3);
  const isSquareObj = (cells: Array<[number, number]>): boolean => {
    const bb = bboxOf(cells);
    const hh = bb.maxR - bb.minR + 1;
    const ww = bb.maxC - bb.minC + 1;
    if (hh !== ww) return false;
    const set = new Set(cells.map(([r, c]) => `${r},${c}`));
    for (let r = bb.minR; r <= bb.maxR; r++) for (let c = bb.minC; c <= bb.maxC; c++) if (!set.has(`${r},${c}`)) return false;
    return true;
  };
  const Tfn = (g: Grid): Grid => {
    const det = findObjects(g);
    const hasSquare = det.objects.some((o) => isSquareObj(o.cells));
    if (hasSquare) return frameEachObject(g, f);
    return T.recolor(g, { [a]: b });
  };
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 11);
    const withSquare = chance(rng, 0.5);
    const objs = scatterObjects(rng, h, w, randInt(rng, 1, 2), {
      colorPool: sampleColors(rng, 2, [f]),
      minSize: 1,
      maxSize: 3,
      margin: 1,
      shapes: 'rect',
    });
    if (withSquare) {
      const s = randInt(rng, 2, 3);
      const sq: Array<[number, number]> = [];
      const r0 = randInt(rng, 1, Math.max(1, h - s - 1));
      const c0 = randInt(rng, 1, Math.max(1, w - s - 1));
      for (let r = r0; r < r0 + s; r++) for (let c = c0; c < c0 + s; c++) sq.push([r, c]);
      objs.push({ cells: sq, color: pick(rng, sampleColors(rng, 1, [f])) });
    }
    const g = drawObjects(h, w, objs);
    if (!g.flat().includes(a)) {
      const cells: Array<[number, number]> = [[0, 0]];
      for (const [r, c] of cells) g[r][c] = a;
    }
    return { input: g, output: Tfn(g) };
  };
  const pairs = makeTrain(4, make, (p, acc) => {
    const det = findObjects(p.input);
    if (det.objects.length === 0) return false;
    const hasSquare = det.objects.some((o) => isSquareObj(o.cells));
    const seenSquare = acc.some((t) => findObjects(t.input).objects.some((o) => isSquareObj(o.cells)));
    return (hasSquare !== seenSquare || acc.length === 0) && !acc.some((t) => keyEq(t.input, p.input));
  }).map((p) => ({ input: p.input, output: Tfn(p.input) }));
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Square shapes trigger something different than non-square drawings.',
      'If ANY object is a perfect square, every object gets a frame; otherwise the color substitution applies.',
      `The rule: a perfect square object present → frame every object with color ${colorName(f)} (${f}); no square → recolor ${colorName(a)} (${a}) → ${colorName(b)} (${b}).`,
    ],
    'Shape-conditional rule: the presence of a square object selects framing over recoloring.',
  );
}

function genW8Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genByColorPresence, genByObjectCount, genByParity, genRegionRule, genBySize]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 9 — Program Detective
// ---------------------------------------------------------------------------

function genTwoOp(rng: Rng, d: number): PuzzleDraft {
  const geo = pick(rng, [T.transpose, T.rotate270, T.flipV, T.rotate180]);
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(geo(g), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [a, ...sampleColors(rng, 0), 0]);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 2, make, {
    alts: GEO_ALTS.filter((f) => f !== geo).map((f) => (g: Grid) => T.recolor(f(g), { [a]: b })),
  });
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Only two examples — make them count. Two operations are composed here.',
      `Geometry (${describeGeo(geo)}) first, then recolor ${colorName(a)} (${a}) → ${colorName(b)} (${b}).`,
      `Program: [${describeGeo(geo)}, recolor ${a}→${b}]. Apply the geometry, then substitute the color.`,
    ],
    `Two-op program: ${describeGeo(geo)} → recolor ${a}→${b}.`,
  );
}

function genThreeOp(rng: Rng, d: number): PuzzleDraft {
  const geo1 = pick(rng, [T.rotate90, T.flipH, T.transpose]);
  const dr = pick(rng, [0, 1]);
  const dc = pick(rng, [1, 2]);
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(T.shift(geo1(g), dr, dc), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 8);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h - 2; r++) for (let c = 0; c < w - dc; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [a]);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 2, make, {});
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Three operations, two examples. Work step by step from one example, verify on the other.',
      `Transform (${describeGeo(geo1)}), then shift (down ${dr}, right ${dc}), then recolor ${a}→${b}.`,
      `Program: [${describeGeo(geo1)}, shift (${dr},${dc}), recolor ${a}→${b}]. Order matters.`,
    ],
    `Three-op program: ${describeGeo(geo1)} → shift (${dr}, ${dc}) → recolor ${a}→${b}.`,
  );
}

function genParamRotate(rng: Rng, d: number): PuzzleDraft {
  const k = pick(rng, [1, 2, 3]);
  const fn = [T.rotate90, T.rotate180, T.rotate270][k - 1];
  const alts = GEO_ALTS.filter((f) => f !== fn);
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: fn(g) };
  };
  const pairs = genPairs(rng, 3, make, { alts });
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'The rotation angle is not told to you. Infer it from the examples.',
      'Compare where a distinctive corner cell ends up — that pins the rotation amount.',
      `The hidden parameter is ${k * 90}° clockwise: every example rotates by the same k = ${k}.`,
    ],
    `Parameter inference: the program is rotate(${k * 90}° cw) — consistent across every example.`,
  );
}

function genSelectThenOp(rng: Rng, d: number): PuzzleDraft {
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => {
    const det = findObjects(g);
    if (det.objects.length === 0) return g;
    const sizes = det.objects.map((o) => o.size);
    if (new Set(sizes).size !== sizes.length) return g;
    return T.recolor(keepObjects(g, [largestObject(det.objects)]), { [a]: b });
  };
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 7, 11);
    const k = randInt(rng, 2, 3);
    const objs = scatterObjects(rng, h, w, k, { colorPool: sampleColors(rng, k), minSize: 1, maxSize: 5, margin: 0 });
    const sizes = objs.map((o) => o.cells.length);
    if (new Set(sizes).size !== sizes.length) return { input: [[0]], output: [[1]] };
    const g = drawObjects(h, w, objs);
    return { input: g, output: Tfn(g) };
  };
  const pairs = makeTrain(2, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)) && !keyEq(p.input, Tfn(p.input)) && p.input.length > 1).map((p) => ({ input: p.input, output: Tfn(p.input) }));
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'A selection happens before the color change.',
      'First keep only the largest object, then apply the color substitution to it.',
      `Program: [keep-largest, recolor ${colorName(a)} (${a}) → ${colorName(b)} (${b})].`,
    ],
    'Two-stage program: object selection (largest) followed by a color substitution.',
  );
}

function genOneExample(rng: Rng, d: number): PuzzleDraft {
  const geo = pick(rng, [T.flipH, T.rotate180]);
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(geo(g), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 4, 8);
    const g = makeGrid(h, w, 0);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, [a]);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 1, make, {});
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'A single example. Look for the simplest two-step story that explains it.',
      `One geometric op (${describeGeo(geo)}) and one color op (${a}→${b}) — in that order.`,
      `Program: [${describeGeo(geo)}, recolor ${a}→${b}].`,
    ],
    `Minimal program: ${describeGeo(geo)} then recolor ${a}→${b}.`,
  );
}

function genGeneralizeSize(rng: Rng, d: number): PuzzleDraft {
  const rule = pick(rng, ['tile', 'crop', 'largest'] as const);
  const Tfn = (g: Grid): Grid => (rule === 'tile' ? T.tile(g, 2, 2) : rule === 'crop' ? T.cropContent(g) : (() => {
    const det = findObjects(g);
    return det.objects.length ? keepObjects(g, [largestObject(det.objects)]) : g;
  })());
  const make = (): PairD => {
    const h = randInt(rng, 4, 9);
    const w = randInt(rng, 4, 9);
    const g = makeGrid(h, w, 0);
    const colors = sampleColors(rng, 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 3, make, {});
  // ensure size variety across pairs
  const seenSizes = new Set(pairs.map((p) => `${p.input.length}x${p.input[0].length}`));
  if (seenSizes.size < 2 && pairs.length >= 2) {
    // regenerate a couple with different sizes
    const extra = genPairs(rng, 2, make, {});
    for (const e of extra) {
      const sz = `${e.input.length}x${e.input[0].length}`;
      if (!seenSizes.has(sz)) {
        pairs.push(e);
        seenSizes.add(sz);
      }
    }
  }
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'The examples come in different sizes. Find the rule that works for ALL of them.',
      rule === 'tile'
        ? 'Every grid is tiled 2×2, whatever its size.'
        : rule === 'crop'
          ? 'Every grid is cropped to its content box.'
          : 'In every grid only the largest object survives.',
      rule === 'tile'
        ? 'The size-independent program: tile the grid 2×2.'
        : rule === 'crop'
          ? 'The size-independent program: crop to the non-zero bounding box.'
          : 'The size-independent program: keep the largest object, erase the rest.',
    ],
    'The same program applies at every grid size — the rule is scale-independent.',
  );
}

function genW9Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genTwoOp, genThreeOp, genParamRotate, genSelectThenOp]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------
// World 10 — ARC Grandmaster
// ---------------------------------------------------------------------------

function genTripleOp(rng: Rng, d: number): PuzzleDraft {
  const geo1 = pick(rng, [T.rotate90, T.flipH, T.transpose]);
  const geo2 = pick(rng, [T.flipV, T.rotate90, T.flipH].filter((f) => f !== geo1));
  const [a, b] = sampleColors(rng, 2);
  const Tfn = (g: Grid): Grid => T.recolor(geo2(geo1(g)), { [a]: b });
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 5, 9);
    const g = makeGrid(h, w, 0);
    const colors = [a, ...sampleColors(rng, 1, [a, b])];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (chance(rng, 0.4)) g[r][c] = pick(rng, colors);
    if (!g.flat().includes(a)) g[0][0] = a;
    return { input: g, output: Tfn(g) };
  };
  const pairs = genPairs(rng, 3, make, {});
  return assemble(
    pairs,
    distinctTest(make, pairs),
    [
      'Three composed operations. Decompose one example fully, then check the other two.',
      `Geometric ops compose first (${describeGeo(geo1)} then ${describeGeo(geo2)}), then the color map ${a}→${b}.`,
      `Program: [${describeGeo(geo1)}, ${describeGeo(geo2)}, recolor ${a}→${b}].`,
    ],
    `Triple composition: ${describeGeo(geo1)} → ${describeGeo(geo2)} → recolor ${a}→${b}.`,
  );
}

function genDistractorColor(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 8, 12);
    const [a, distractor] = sampleColors(rng, 2);
    const aObjs: Array<{ cells: Array<[number, number]>; color: Color }> = [];
    // a-objects in distinct column bands, lower half, so moving to top is collision-free
    const nA = randInt(rng, 1, 2);
    const bandW = Math.floor(w / (nA + 1));
    for (let i = 0; i < nA; i++) {
      const len = randInt(rng, 2, 3);
      const r = randInt(rng, Math.floor(h / 2), h - 1);
      const c0 = i * bandW + randInt(rng, 0, Math.max(0, bandW - len - 1));
      const cells: Array<[number, number]> = [];
      for (let j = 0; j < len; j++) cells.push([r, c0 + j]);
      aObjs.push({ cells, color: a });
    }
    // distractors anywhere in the top half, other columns
    const dObjs = scatterObjects(rng, Math.floor(h / 2), w, randInt(rng, 1, 2), {
      colorPool: [distractor],
      minSize: 2,
      maxSize: 3,
      margin: 0,
    });
    const g = makeGrid(h, w, 0);
    for (const o of [...aObjs, ...dObjs]) for (const [r, c] of o.cells) g[r][c] = o.color;
    const out = cloneGrid(g);
    for (const o of aObjs) {
      const bb = bboxOf(o.cells);
      for (const [r, c] of o.cells) {
        out[r][c] = 0;
        out[r - bb.minR][c] = a;
      }
    }
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'Some objects move, identical-looking others do not. What distinguishes the movers?',
      'Only objects of ONE specific color travel to the top edge; every other color is a distractor that stays.',
      'The rule: select objects by color, translate each so it touches the top edge (column preserved); ignore all other colors.',
    ],
    'Selective motion: objects of the target color move to the top; distractor objects are irrelevant to the rule.',
  );
}

function genMultiRule(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 8, 12);
    const [a, b, c] = sampleColors(rng, 3);
    // a-objects in own bands (for gravity move), b-objects anywhere
    const bands = 3;
    const aObj: Array<[number, number]> = [];
    const band = randInt(rng, 0, bands - 1);
    const len = randInt(rng, 2, 3);
    const r0 = randInt(rng, 0, Math.max(0, h - 4));
    const c0 = band * Math.floor(w / bands) + randInt(rng, 0, Math.max(0, Math.floor(w / bands) - len - 1));
    for (let j = 0; j < len; j++) aObj.push([r0, c0 + j]);
    const bObj: Array<[number, number]> = [];
    const blen = randInt(rng, 2, 3);
    const br = randInt(rng, 0, Math.max(0, h - 4));
    const bc = randInt(rng, 0, w - blen - 1);
    for (let j = 0; j < blen; j++) bObj.push([br, bc + j]);
    if (bc >= c0 - 1 && bc <= c0 + len) return { input: [[0]], output: [[1]] };
    const g = makeGrid(h, w, 0);
    for (const [r, cc] of aObj) g[r][cc] = a;
    for (const [r, cc] of bObj) g[r][cc] = b;
    const out = cloneGrid(g);
    for (const [r, cc] of aObj) out[r][cc] = c; // a → c
    const bb = bboxOf(bObj);
    const drop = h - 1 - bb.maxR; // move b object to bottom edge
    for (const [r, cc] of bObj) {
      out[r][cc] = 0;
      out[r + drop][cc] = b;
    }
    return { input: g, output: out };
  };
  const train = makeTrain(3, make, (p, acc) => !keyEq(p.input, p.output) && !acc.some((t) => keyEq(t.input, p.input)));
  return assemble(
    train,
    distinctTest(make, train),
    [
      'Two colors, two different laws, in the same grid.',
      'Color A objects are simply recolored; color B objects drop to the bottom edge.',
      'The rule is per-color: objects of color A → recolor to C; objects of color B → translate to the bottom edge (columns preserved).',
    ],
    'Per-color laws: one color class is recolored in place; the other is moved to the bottom boundary.',
  );
}

function genNoiseFilter(rng: Rng, d: number): PuzzleDraft {
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 8, 12);
    const [n] = sampleColors(rng, 1);
    const baseColors = sampleColors(rng, randInt(rng, 1, 2), [n]);
    const objs = scatterObjects(rng, h, w, randInt(rng, 1, 3), { colorPool: baseColors, minSize: 2, maxSize: 4, margin: 1 });
    const g = drawObjects(h, w, objs);
    // add noise single cells (not adjacent to objects)
    let placed = 0;
    let guard = 0;
    const target = randInt(rng, 3, 6);
    while (placed < target && guard++ < 200) {
      const r = randInt(rng, 1, h - 2);
      const c = randInt(rng, 1, w - 2);
      if (g[r][c] !== 0) continue;
      const nearObj = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dr, dc]) => g[r + dr][c + dc] !== 0);
      if (nearObj) continue;
      g[r][c] = n;
      placed++;
    }
    const out = T.cropContent(g, 0);
    // remove noise manually then crop — recompute without noise
    const clean = cloneGrid(g);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (clean[r][c] === n) clean[r][c] = 0;
    return { input: g, output: T.cropContent(clean) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)) && p.input.length > 1);
  return assemble(
    train,
    distinctTest(make, train),
    [
      'The drawing is polluted by stray single cells. What happens to them?',
      'The isolated single cells (a color never used by real objects) are deleted — and the rest is cropped tight.',
      'The rule: remove every isolated single-cell object of the noise color, then crop to the remaining content box.',
    ],
    'Denoising + crop: delete the scattered single-cell noise, then crop to the bounding box of what remains.',
  );
}

function genCapstone(rng: Rng, d: number): PuzzleDraft {
  const finalOp = pick(rng, ['rotate', 'recolor'] as const);
  const [a, b] = sampleColors(rng, 2);
  const [n] = sampleColors(rng, 1, [a, b]);
  const Tfn = (g: Grid): Grid => {
    const clean = cloneGrid(g);
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (clean[r][c] === n) clean[r][c] = 0;
    const cropped = T.cropContent(clean);
    return finalOp === 'rotate' ? T.rotate90(cropped) : T.recolor(cropped, { [a]: b });
  };
  const make = (): PairD => {
    const { h, w } = rampDim(rng, d, 8, 12);
    const baseColors = [a, ...sampleColors(rng, 1, [a, b, n])];
    const objs = scatterObjects(rng, h, w, randInt(rng, 1, 2), { colorPool: baseColors, minSize: 2, maxSize: 4, margin: 1 });
    const g = drawObjects(h, w, objs);
    let placed = 0;
    let guard = 0;
    while (placed < 4 && guard++ < 200) {
      const r = randInt(rng, 1, h - 2);
      const c = randInt(rng, 1, w - 2);
      if (g[r][c] !== 0) continue;
      const nearObj = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dr, dc]) => g[r + dr][c + dc] !== 0);
      if (nearObj) continue;
      g[r][c] = n;
      placed++;
    }
    return { input: g, output: Tfn(g) };
  };
  const train = makeTrain(3, make, (p, acc) => !acc.some((t) => keyEq(t.input, p.input)) && p.input.length > 1);
  return assemble(
    train,
    distinctTest(make, train),
    [
      'A three-stage pipeline: clean, crop, and one more step. Find the last step.',
      finalOp === 'rotate'
        ? 'After denoising and cropping, the result is rotated 90° clockwise.'
        : 'After denoising and cropping, one color is substituted.',
      finalOp === 'rotate'
        ? `Program: [remove-noise (${n}), crop, rotate 90° cw].`
        : `Program: [remove-noise (${n}), crop, recolor ${a}→${b}].`,
    ],
    finalOp === 'rotate'
      ? 'Pipeline: denoise → crop → rotate 90° clockwise.'
      : 'Pipeline: denoise → crop → recolor.',
  );
}

function genW10Trial(rng: Rng, d: number): PuzzleDraft {
  const variant = pick(rng, [genTripleOp, genDistractorColor, genMultiRule, genNoiseFilter, genCapstone]);
  return variant(rng, d);
}

// ---------------------------------------------------------------------------

export const GENERATORS_B: Record<string, (rng: Rng, d: number) => PuzzleDraft> = {
  gravity: genGravity,
  'move-to-marker': genMoveToMarker,
  'frame-objects': genFrameObjects,
  'mirror-in-place': genMirrorInPlace,
  'align-left': genAlignLeft,
  'scale-object': genScaleObject,
  'w6-trial': genW6Trial,
  'geo-then-color': genGeoThenColor,
  'shift-then-frame': genShiftThenFrame,
  'shift-then-color': genShiftThenColor,
  'gravity-then-color': genGravityThenColor,
  'crop-then-geo': genCropThenGeo,
  'w7-trial': genW7Trial,
  'by-color-presence': genByColorPresence,
  'by-object-count': genByObjectCount,
  'by-parity': genByParity,
  'region-rule': genRegionRule,
  'by-size': genBySize,
  'by-shape': genByShape,
  'w8-trial': genW8Trial,
  'two-op': genTwoOp,
  'three-op': genThreeOp,
  'param-rotate': genParamRotate,
  'select-then-op': genSelectThenOp,
  'one-example': genOneExample,
  'generalize-size': genGeneralizeSize,
  'w9-trial': genW9Trial,
  'triple-op': genTripleOp,
  'distractor-color': genDistractorColor,
  'multi-rule': genMultiRule,
  'noise-filter': genNoiseFilter,
  capstone: genCapstone,
  'w10-trial': genW10Trial,
};

export { bboxOf };
