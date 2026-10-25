import { NextRequest, NextResponse } from 'next/server';
import { badRequest, ensurePlayer } from '@/lib/server/api';
import { isOfficialDataset, loadOfficialTask, markServed, pickUnseenTask } from '@/lib/server/official';

/**
 * GET /api/official/next?playerId&agentId&dataset=training|evaluation
 *
 * Serves a FRESH puzzle: the picker excludes every task already recorded for
 * (playerId, agentId, dataset), so the same puzzle is never served twice.
 * The expected output is withheld — scoring happens server-side on commit.
 */
export async function GET(req: NextRequest) {
  const playerId = await ensurePlayer(req.nextUrl.searchParams.get('playerId'));
  if (!playerId) return badRequest('valid playerId required');
  const agentId = req.nextUrl.searchParams.get('agentId') ?? '';
  const ds = req.nextUrl.searchParams.get('dataset');
  if (!agentId) return badRequest('agentId required');
  if (!isOfficialDataset(ds)) return badRequest('dataset must be training or evaluation');

  const pick = await pickUnseenTask(playerId, agentId, ds);
  if (!pick.taskId) {
    return NextResponse.json({
      exhausted: true,
      seen: pick.seen,
      total: pick.total,
      message: `All ${pick.total} ${ds} puzzles have already been served to this agent. Reset the history to run them again.`,
    });
  }
  const payload = loadOfficialTask(ds, pick.taskId, false);
  if (!payload) return NextResponse.json({ error: 'task file missing' }, { status: 500 });
  // record the hand-out immediately so this puzzle can never be served again
  await markServed(playerId, agentId, ds, pick.taskId);
  return NextResponse.json({
    exhausted: false,
    dataset: ds,
    taskId: pick.taskId,
    seen: pick.seen,
    total: pick.total,
    freshNumber: pick.seen + 1,
    task: payload.task,
  });
}
