import { NextRequest, NextResponse } from 'next/server';
import { taskForId, isDailyId } from '@/lib/arc/curriculum';
import { db } from '@/lib/db';
import { ensurePlayer, notFound, serverError } from '@/lib/server/api';

/**
 * GET /api/puzzles/[id]?playerId=...
 * Returns the task with the test output HIDDEN (answers stay server-side).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const playerId = req.nextUrl.searchParams.get('playerId');
    let task;
    try {
      task = taskForId(id, { reveal: false });
    } catch {
      return notFound(`Unknown puzzle: ${id}`);
    }
    const { explanation, hints, ...metaSafe } = task.metadata;
    void explanation;
    let progress: { solved: boolean; attempts: number; wrongAttempts: number; hintsUsed: number } | null = null;
    if (playerId && !isDailyId(id)) {
      const row = await db.levelProgress.findUnique({ where: { playerId_puzzleId: { playerId, puzzleId: id } } });
      if (row) {
        progress = { solved: row.solved, attempts: row.attempts, wrongAttempts: row.wrongAttempts, hintsUsed: row.hintsUsed };
      }
    }
    let dailySolved: boolean | null = null;
    if (playerId && isDailyId(id)) {
      const row = await db.dailyResult.findUnique({ where: { playerId_date: { playerId, date: id.slice('daily-'.length) } } });
      dailySolved = row?.solved ?? false;
    }
    return NextResponse.json({
      task: { ...task, metadata: { ...metaSafe, hintsCount: hints?.length ?? 0 } },
      progress,
      dailySolved,
    });
  } catch (err) {
    return serverError(err);
  }
}
