import { NextRequest, NextResponse } from 'next/server';
import { badRequest, ensurePlayer } from '@/lib/server/api';
import { agentHistory, isOfficialDataset, recentRuns, resetHistory } from '@/lib/server/official';

/**
 * GET /api/official/history?playerId&agentId[&runs=1]
 * Per-dataset fresh-puzzle counters (seen / solved / total) + recent runs.
 *
 * DELETE /api/official/history?playerId&agentId[&dataset=…]
 * Reset the never-repeat history so puzzles can be served again.
 */
export async function GET(req: NextRequest) {
  const playerId = await ensurePlayer(req.nextUrl.searchParams.get('playerId'));
  if (!playerId) return badRequest('valid playerId required');
  const agentId = req.nextUrl.searchParams.get('agentId') ?? '';
  if (!agentId) return badRequest('agentId required');
  const history = await agentHistory(playerId, agentId);
  const runs = req.nextUrl.searchParams.get('runs') === '1' ? await recentRuns(playerId, agentId) : [];
  return NextResponse.json({ history, runs });
}

export async function DELETE(req: NextRequest) {
  const playerId = await ensurePlayer(req.nextUrl.searchParams.get('playerId'));
  if (!playerId) return badRequest('valid playerId required');
  const agentId = req.nextUrl.searchParams.get('agentId') ?? '';
  if (!agentId) return badRequest('agentId required');
  const dsParam = req.nextUrl.searchParams.get('dataset');
  const ds = isOfficialDataset(dsParam) ? dsParam : undefined;
  const deleted = await resetHistory(playerId, agentId, ds);
  return NextResponse.json({ ok: true, deleted });
}
