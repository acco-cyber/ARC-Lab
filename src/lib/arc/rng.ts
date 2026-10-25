/**
 * ARC Lab — deterministic RNG utilities.
 * All curriculum generation and daily puzzles are fully deterministic per seed,
 * which keeps puzzle generation reproducible across server restarts.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randInt(rng: Rng, minIncl: number, maxIncl: number): number {
  return minIncl + Math.floor(rng() * (maxIncl - minIncl + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Regenerate until predicate holds (bounded). */
export function until<T>(fn: () => T, pred: (t: T) => boolean, tries = 300): T {
  let last = fn();
  for (let i = 0; i < tries; i++) {
    last = fn();
    if (pred(last)) return last;
  }
  return last;
}
