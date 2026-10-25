import { NextRequest, NextResponse } from 'next/server';
import { badRequest, ensurePlayer } from '@/lib/server/api';
import { isOfficialDataset, loadOfficialTask, recordRun, scoreAttempts } from '@/lib/server/official';
import type { Grid } from '@/lib/arc/types';

interface Body {
  playerId?: string;
  agentId?: string;
  dataset?: string;
  taskId?: string;
  /** attempts[i] = candidate grids for test input i (first = primary answer). */
  attempts?: Grid[][];
  elapsedMs?: number;
  engine?: string;
}

/**
 * POST /api/official/score — commit an agent's predictions for an official task.
 * Scores server-side against the withheld expected outputs, records the run in
 * AgentPuzzleRun (which powers the never-repeat queue), and reveals the expected
 * grids for the result view (only after the prediction is committed).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const playerId = await ensurePlayer(body.playerId);
  if (!playerId) return badRequest('valid playerId required');
  if (!body.agentId) return badRequest('agentId required');
  if (!isOfficialDataset(body.dataset)) return badRequest('dataset must be training or evaluation');
  if (!body.taskId || !/^[0-9a-f]{8}$/.test(body.taskId)) return badRequest('valid taskId required');
  const payload = loadOfficialTask(body.dataset, body.taskId, true);
  if (!payload) return badRequest('unknown taskId for this dataset');

  const attempts = Array.isArray(body.attempts) ? body.attempts : [];
  const score = scoreAttempts(payload.expected, attempts);
  await recordRun({
    playerId,
    agentId: body.agentId,
    dataset: body.dataset,
    taskId: body.taskId,
    score,
    elapsedMs: typeof body.elapsedMs === 'number' ? Math.round(body.elapsedMs) : undefined,
    engine: typeof body.engine === 'string' ? body.engine.slice(0, 200) : undefined,
  });

  return NextResponse.json({
    ok: true,
    score,
    expected: payload.expected,
  });
}
