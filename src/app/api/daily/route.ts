import { NextRequest, NextResponse } from 'next/server';
import { dailyIdForDate, dailyTask, todayKey } from '@/lib/arc/curriculum';
import { db } from '@/lib/db';
import { ensurePlayer, serverError } from '@/lib/server/api';

/**
 * GET /api/daily?playerId=...
 * Today's deterministic daily challenge (Asia/Dhaka calendar day).
 */
export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId');
    const pid = await ensurePlayer(playerId);
    const dateKey = todayKey();
    const id = dailyIdForDate(dateKey);
    const task = dailyTask(dateKey);
    const { explanation, hints, ...metaSafe } = task.metadata;
    void explanation;
    let solved = false;
    if (pid) {
      const row = await db.dailyResult.findUnique({ where: { playerId_date: { playerId: pid, date: dateKey } } });
      solved = row?.solved ?? false;
    }
    return NextResponse.json({
      id,
      dateKey,
      solved,
      task: { ...task, metadata: { ...metaSafe, hintsCount: hints?.length ?? 0 } },
    });
  } catch (err) {
    return serverError(err);
  }
}
