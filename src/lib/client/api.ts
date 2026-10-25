'use client';

/**
 * ARC Lab — typed client fetchers for the API routes.
 */

import type { Task } from '@/lib/arc/types';
import type { ProgressData } from '@/lib/store/arc-lab';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface PuzzleManifest {
  worlds: Array<{ id: number; name: string; tagline: string; difficulty: string; skills: string[] }>;
  levels: Array<{ id: string; world: number; level: number; title: string; difficulty: string; skills: string[] }>;
  dailyId: string;
  datasetVersion: string;
}

export interface PuzzleResponse {
  task: Task;
  progress: { solved: boolean; attempts: number; wrongAttempts: number; hintsUsed: number } | null;
  dailySolved: boolean | null;
}

export interface SubmitResponse {
  correct: boolean;
  attempts: number;
  wrongAttempts: number;
  failed: boolean;
  firstSolve: boolean;
  xpAwarded: number;
  expected: number[][] | null;
  explanation: string | null;
  mode: 'practice' | 'challenge';
}

export interface HintResponse {
  tier: number;
  hint: string;
  hintsUsed: number | null;
}

export interface DailyResponse {
  id: string;
  dateKey: string;
  solved: boolean;
  task: Task;
}

export interface PerSolverSummary {
  solverId: string;
  total: number;
  solved: number;
  exactRate: number;
  pass2Solved: number;
  pass2Rate: number;
  avgPixelAcc: number | null;
  avgRuntimeMs: number;
  totalRuntimeMs: number;
  failures: Record<string, number>;
}

export interface ArenaRunResponse {
  runId: string | null;
  createdAt: string;
  config: Record<string, unknown>;
  summary: PerSolverSummary[];
  perTask: Array<{
    taskId: string;
    solverId: string;
    runtimeMs: number;
    predictions: number[][][];
    expected: number[][] | null;
    exact: boolean | null;
    pass2: boolean | null;
    pixelAcc: number | null;
    failure: string;
    note?: string;
  }>;
  solverCatalog: Array<{ id: string; name: string; kind: string; description: string; limitations: string; slow: boolean }>;
}

export interface ArenaRunHistoryItem {
  id: string;
  createdAt: string;
  config: { solvers: string[]; scope: { type?: string; worlds?: number[]; ids?: string[]; limit?: number; tasks?: unknown[] }; datasetVersion: string; appVersion: string };
  summary: PerSolverSummary[];
}

export const api = {
  manifest: () => getJson<PuzzleManifest>('/api/puzzles'),
  puzzle: (id: string, playerId: string) => getJson<PuzzleResponse>(`/api/puzzles/${id}?playerId=${encodeURIComponent(playerId)}`),
  submit: (id: string, body: { playerId: string; grid: number[][]; mode: 'practice' | 'challenge'; revealIfWrong?: boolean }) =>
    postJson<SubmitResponse>(`/api/puzzles/${id}/submit`, body),
  hint: (id: string, body: { playerId: string; tier: number }) => postJson<HintResponse>(`/api/puzzles/${id}/hint`, body),
  progress: (playerId: string) => getJson<ProgressData>(`/api/progress?playerId=${encodeURIComponent(playerId)}`),
  daily: (playerId: string) => getJson<DailyResponse>(`/api/daily?playerId=${encodeURIComponent(playerId)}`),
  arenaRun: (body: { playerId?: string; solvers: string[]; scope: Record<string, unknown> }) => postJson<ArenaRunResponse>('/api/arena/run', body),
  arenaRuns: (playerId: string) => getJson<{ runs: ArenaRunHistoryItem[] }>(`/api/arena/runs?playerId=${encodeURIComponent(playerId)}`),
};
