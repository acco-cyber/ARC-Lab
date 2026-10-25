/**
 * ARC Lab — curriculum definition: 10 worlds × 10 levels = 100 levels.
 * Organized by the skill being taught (not arbitrary difficulty).
 *
 * Generator names in LEVELS are contracts: every name must exist in
 * `generators.ts` GENERATORS registry. Seeds are deterministic.
 */

import { hashSeed } from '../rng';

export type WorldDifficulty = 'Beginner' | 'Easy' | 'Intermediate' | 'Advanced' | 'Expert';

export interface WorldDef {
  id: number;
  name: string;
  tagline: string;
  difficulty: WorldDifficulty;
  skills: string[];
  /** Short lesson titles for the 10 levels. */
  lessons: [string, string, string, string, string, string, string, string, string, string];
  /** Generator template per level (must exist in GENERATORS). */
  templates: [string, string, string, string, string, string, string, string, string, string];
}

export const WORLDS: WorldDef[] = [
  {
    id: 1,
    name: 'Grid Explorer',
    tagline: 'Colors, dimensions, copying grids, and exact-match answers.',
    difficulty: 'Beginner',
    skills: ['colors', 'dimensions', 'copying'],
    lessons: [
      'Copy the Pattern',
      'Paint It All',
      'One Color Changes',
      'Two Colors Change',
      'Color Swap',
      'Keep One Color',
      'Count the Cells',
      'Name the Colors',
      'Flip Foreground',
      'Explorer Trial',
    ],
    templates: [
      'identity',
      'fill-constant',
      'map-one',
      'map-two',
      'swap-two',
      'keep-one',
      'count-cells',
      'unique-colors',
      'invert-fg',
      'w1-trial',
    ],
  },
  {
    id: 2,
    name: 'Shape Detective',
    tagline: 'Connected components, object counting, size, and position.',
    difficulty: 'Beginner',
    skills: ['objects', 'counting', 'size', 'position'],
    lessons: [
      'How Many Objects?',
      'The Biggest One',
      'Bigger of a Kind',
      'The Smallest One',
      'Size Tells Color',
      'Crop to Content',
      'Give It Room',
      'Touching the Edge',
      'Count the Colors',
      'Detective Trial',
    ],
    templates: [
      'count-objects',
      'keep-largest',
      'keep-largest',
      'keep-smallest',
      'size-parity-recolor',
      'crop-content',
      'crop-content',
      'border-objects',
      'count-colors',
      'w2-trial',
    ],
  },
  {
    id: 3,
    name: 'Spatial Wizard',
    tagline: 'Rotation, reflection, translation, and alignment.',
    difficulty: 'Beginner',
    skills: ['rotation', 'reflection', 'translation'],
    lessons: [
      'Quarter Turn',
      'Left-Right Mirror',
      'Up-Down Mirror',
      'Half Turn',
      'Across the Diagonal',
      'Three-Quarter Turn',
      'Step to the Right',
      'Step Downstairs',
      'Mirror Then Turn',
      'Wizard Trial',
    ],
    templates: [
      'rotate-k',
      'flip-axis',
      'flip-axis',
      'rotate-k',
      'transpose',
      'rotate-k',
      'shift-dxdy',
      'shift-dxdy',
      'flip-then-rotate',
      'w3-trial',
    ],
  },
  {
    id: 4,
    name: 'Pattern Hunter',
    tagline: 'Repeating patterns, symmetry, continuation, and completion.',
    difficulty: 'Easy',
    skills: ['symmetry', 'tiling', 'completion'],
    lessons: [
      'Finish the Mirror',
      'Mirror Up and Down',
      'Repair the Symmetry',
      'Tile It Twice',
      'Tile in a Row',
      'Fix the Checkerboard',
      'Four-Way Mirror',
      'Extend the Rhythm',
      'Stripe by Stripe',
      'Hunter Trial',
    ],
    templates: [
      'complete-h',
      'complete-v',
      'fix-symmetry',
      'tile-2x2',
      'tile-1x2',
      'checker-complete',
      'quad-complete',
      'extend-1d',
      'stripes-complete',
      'w4-trial',
    ],
  },
  {
    id: 5,
    name: 'Color Logic',
    tagline: 'Color substitution, recoloring, and color-dependent rules.',
    difficulty: 'Easy',
    skills: ['color-mapping', 'logic', 'neighborhoods'],
    lessons: [
      'The Color Cycle',
      'A Longer Cycle',
      'The Big Map',
      'Touch of Color',
      'Rank by Frequency',
      'Row by Row',
      'The Odd Mirror',
      'Neighborhood Rules',
      'The Grand Map',
      'Logic Trial',
    ],
    templates: [
      'cycle-colors',
      'cycle-colors',
      'map-many',
      'adjacent-highlight',
      'frequency-rank',
      'row-gradient',
      'mirror-diff',
      'adjacent-highlight',
      'map-many',
      'w5-trial',
    ],
  },
  {
    id: 6,
    name: 'Object Engineer',
    tagline: 'Object movement, collision, containment, and construction.',
    difficulty: 'Intermediate',
    skills: ['object-motion', 'gravity', 'framing'],
    lessons: [
      'Everything Falls',
      'Mark My Spot',
      'Fence Every Shape',
      'Mirror Inside the Box',
      'Hug the Left Wall',
      'Double the Size',
      'Falling Colors',
      'Grand Fences',
      'Precise Delivery',
      'Engineer Trial',
    ],
    templates: [
      'gravity',
      'move-to-marker',
      'frame-objects',
      'mirror-in-place',
      'align-left',
      'scale-object',
      'gravity',
      'frame-objects',
      'move-to-marker',
      'w6-trial',
    ],
  },
  {
    id: 7,
    name: 'Rule Composer',
    tagline: 'Combine two or more transformations in the right order.',
    difficulty: 'Intermediate',
    skills: ['composition', 'ordering'],
    lessons: [
      'Turn Then Paint',
      'Mirror Then Swap',
      'Slide Then Fence',
      'Diagonal Then Paint',
      'Mirror Then Keep',
      'Turn Then Swap',
      'Slide Then Paint',
      'Fall Then Paint',
      'Crop Then Mirror',
      'Composer Trial',
    ],
    templates: [
      'geo-then-color',
      'geo-then-color',
      'shift-then-frame',
      'geo-then-color',
      'geo-then-color',
      'geo-then-color',
      'shift-then-color',
      'gravity-then-color',
      'crop-then-geo',
      'w7-trial',
    ],
  },
  {
    id: 8,
    name: 'Context Master',
    tagline: 'Choose different rules depending on object or grid context.',
    difficulty: 'Advanced',
    skills: ['conditionals', 'context', 'regions'],
    lessons: [
      'The Color Signal',
      'Counting Decides',
      'Even or Odd',
      'Two Halves, Two Rules',
      'Size Matters',
      'Square or Not',
      'Signal, Harder',
      'Counting, Harder',
      'Halves, Harder',
      'Master Trial',
    ],
    templates: [
      'by-color-presence',
      'by-object-count',
      'by-parity',
      'region-rule',
      'by-size',
      'by-shape',
      'by-color-presence',
      'by-object-count',
      'region-rule',
      'w8-trial',
    ],
  },
  {
    id: 9,
    name: 'Program Detective',
    tagline: 'Infer a compact transformation program from demonstrations.',
    difficulty: 'Advanced',
    skills: ['program-inference', 'few-shot'],
    lessons: [
      'Two Steps, Two Clues',
      'Three Steps, Three Clues',
      'The Hidden Number',
      'Select Then Act',
      'One Clue Only',
      'Any Size Will Do',
      'Two Steps, Harder',
      'Three Steps, Harder',
      'The Hidden Number II',
      'Detective Trial',
    ],
    templates: [
      'two-op',
      'three-op',
      'param-rotate',
      'select-then-op',
      'one-example',
      'generalize-size',
      'two-op',
      'three-op',
      'param-rotate',
      'w9-trial',
    ],
  },
  {
    id: 10,
    name: 'ARC Grandmaster',
    tagline: 'Unfamiliar puzzles, limited hints, and mixed reasoning skills.',
    difficulty: 'Expert',
    skills: ['mixed', 'noise-filtering', 'composition'],
    lessons: [
      'The Triple Step',
      'Ignore the Impostor',
      'Two Laws at Once',
      'Static on the Line',
      'The Capstone',
      'Grandmaster I',
      'The Triple Step II',
      'Impostors Everywhere',
      'The Storm',
      'Final Trial',
    ],
    templates: [
      'triple-op',
      'distractor-color',
      'multi-rule',
      'noise-filter',
      'capstone',
      'capstone',
      'triple-op',
      'distractor-color',
      'noise-filter',
      'w10-trial',
    ],
  },
];

export interface LevelDef {
  id: string; // e.g. "w1l3"
  world: number;
  level: number;
  title: string;
  template: string;
  seed: number;
  /** difficulty ramp inside the world: 0..1 */
  d: number;
  skills: string[];
  worldDifficulty: WorldDifficulty;
}

export function levelId(world: number, level: number): string {
  return `w${world}l${level}`;
}

export function buildLevels(): LevelDef[] {
  const levels: LevelDef[] = [];
  for (const world of WORLDS) {
    for (let l = 1; l <= 10; l++) {
      levels.push({
        id: levelId(world.id, l),
        world: world.id,
        level: l,
        title: world.lessons[l - 1],
        template: world.templates[l - 1],
        seed: hashSeed('arc-lab-curriculum-v1', world.id, l),
        d: (l - 1) / 9,
        skills: world.skills,
        worldDifficulty: world.difficulty,
      });
    }
  }
  return levels;
}

export const LEVELS: LevelDef[] = buildLevels();

export function getLevelDef(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export interface LevelManifestEntry {
  id: string;
  world: number;
  level: number;
  title: string;
  difficulty: WorldDifficulty;
  skills: string[];
}

export function listManifest(): LevelManifestEntry[] {
  return LEVELS.map((l) => ({
    id: l.id,
    world: l.world,
    level: l.level,
    title: l.title,
    difficulty: l.worldDifficulty,
    skills: l.skills,
  }));
}
