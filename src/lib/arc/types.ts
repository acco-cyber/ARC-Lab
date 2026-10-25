/**
 * ARC Lab — Core task & grid types.
 *
 * A `Grid` is a rectangular matrix of integers 0..9 (the 10 ARC colors).
 * This schema is compatible with the public ARC-AGI JSON format
 * ({ train: [{input, output}], test: [{input, output?}] }) and is tolerant of
 * additional/unknown fields (ARC-AGI-2 / future ARC-AGI-3 forward compatibility).
 */

export type Color = number; // 0..9
export type Grid = Color[][]; // row-major: grid[row][col]

export interface Pair {
  input: Grid;
  output?: Grid | null;
}

export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert';

export const DIFFICULTY_ORDER: Difficulty[] = ['beginner', 'easy', 'intermediate', 'advanced', 'expert'];

export interface TaskMetadata {
  title?: string;
  world?: number;
  level?: number;
  skills: string[];
  difficulty?: Difficulty;
  source: 'arc-lab-synthetic' | 'user-import' | 'arc-official';
  license?: string;
  datasetVersion?: string;
  /** Worked explanation (learning mode / post-submission). */
  explanation?: string;
  /** Tiered hints: [what changed?, transformation clue, worked explanation]. */
  hints?: string[];
}

export interface Task {
  id: string;
  /** e.g. "arc-agi_1.0", "arc-agi-2", "arc-lab-1" — preserved on import. */
  schemaVersion: string;
  train: Pair[];
  test: Pair[];
  metadata: TaskMetadata;
}

export const ARC_LAB_SCHEMA_VERSION = 'arc-lab-1';
export const ARC_LAB_DATASET_VERSION = 'arc-lab-curriculum-v1';
export const APP_VERSION = '0.1.0';

export function makeTask(
  id: string,
  train: Pair[],
  test: Pair[],
  metadata: Partial<TaskMetadata> & { skills: string[]; source: TaskMetadata['source'] },
): Task {
  return {
    id,
    schemaVersion: ARC_LAB_SCHEMA_VERSION,
    train,
    test,
    metadata: { ...metadata },
  };
}

// ---------------------------------------------------------------------------
// Validation of arbitrary ARC-style JSON (used by import in Workbench).
// Accepts unknown extra fields; only structure of train/test + grids is checked.
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  task?: Task;
  errors: string[];
}

function isValidGrid(g: unknown): g is Grid {
  if (!Array.isArray(g) || g.length === 0) return false;
  const w = (g[0] as unknown[])?.length;
  if (typeof w !== 'number' || w === 0) return false;
  for (const row of g) {
    if (!Array.isArray(row) || row.length !== w) return false;
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return false;
    }
  }
  return true;
}

export function validateArcJson(data: unknown, id = 'imported'): ValidationResult {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errors: ['JSON must be an object'] };
  }
  const obj = data as Record<string, unknown>;

  const trainPairs: Pair[] = [];
  const testPairs: Pair[] = [];

  const trainArr = obj.train;
  const testArr = obj.test;
  if (!Array.isArray(trainArr) || trainArr.length === 0) {
    errors.push('"train" must be a non-empty array of pairs');
  }
  if (!Array.isArray(testArr) || testArr.length === 0) {
    errors.push('"test" must be a non-empty array of pairs');
  }
  if (errors.length > 0) return { ok: false, errors };

  (trainArr as unknown[]).forEach((p, i) => {
    if (typeof p !== 'object' || p === null) {
      errors.push(`train[${i}] must be an object`);
      return;
    }
    const pair = p as Record<string, unknown>;
    if (!isValidGrid(pair.input)) {
      errors.push(`train[${i}].input is not a valid grid (rectangular, values 0..9)`);
      return;
    }
    if (!isValidGrid(pair.output)) {
      errors.push(`train[${i}].output is required and must be a valid grid`);
      return;
    }
    trainPairs.push({ input: pair.input as Grid, output: pair.output as Grid });
  });

  (testArr as unknown[]).forEach((p, i) => {
    if (typeof p !== 'object' || p === null) {
      errors.push(`test[${i}] must be an object`);
      return;
    }
    const pair = p as Record<string, unknown>;
    if (!isValidGrid(pair.input)) {
      errors.push(`test[${i}].input is not a valid grid`);
      return;
    }
    const output = pair.output === undefined || pair.output === null ? null : isValidGrid(pair.output) ? (pair.output as Grid) : undefined;
    if (output === undefined) {
      errors.push(`test[${i}].output is not a valid grid`);
      return;
    }
    testPairs.push({ input: pair.input as Grid, output });
  });

  if (errors.length > 0) return { ok: false, errors };

  // Schema version passthrough for ARC-AGI-1/2/3-era files.
  const sv =
    typeof obj.schema_version === 'string'
      ? (obj.schema_version as string)
      : typeof obj.schemaVersion === 'string'
        ? (obj.schemaVersion as string)
        : 'arc-agi-unknown';

  const task: Task = {
    id,
    schemaVersion: sv,
    train: trainPairs,
    test: testPairs,
    metadata: {
      title: typeof obj.title === 'string' ? (obj.title as string) : undefined,
      skills: [],
      source: 'user-import',
    },
  };
  return { ok: true, task, errors: [] };
}
