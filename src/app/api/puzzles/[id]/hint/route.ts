import { NextRequest, NextResponse } from 'next/server';
import { taskForId, isDailyId } from '@/lib/arc/curriculum';
import { db } from '@/lib/db';
import { ensurePlayer, badRequest, notFound, serverError } from '@/lib/server/api';

/**
 * POST /api/puzzles/[id]/hint  { playerId, tier }
 * Tiered hints: 1 = "what changed?", 2 = transformation clue, 3 = worked explanation.
 * The max tier used is recorded and reduces XP at solve time.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { playerId?: string; tier?: number };
    const playerId = await ensurePlayer(body.playerId);
    const tier = Math.max(1, Math.min(3, Number(body.tier ?? 1)));
    let task;
    try {
      task = taskForId(id, { reveal: false });
    } catch {
      return notFound(`Unknown puzzle: ${id}`);
    }
    const hints = task.metadata.hints ?? [];
    const hint = hints[tier - 1];
    if (!hint) return badRequest('Hint not available for this tier');

    let hintsUsed: number | null = null;
    if (playerId) {
      if (isDailyId(id)) {
        const dateKey = id.slice('daily-'.length);
        const row = await db.dailyResult.upsert({
          where: { playerId_date: { playerId, date: dateKey } },
          create: { playerId, date: dateKey, hintsUsed: tier },
          update: { hintsUsed: Math.max(tier, 0) },
        });
        hintsUsed = row.hintsUsed;
        if (tier > row.hintsUsed) {
          await db.dailyResult.update({ where: { id: row.id }, data: { hintsUsed: tier } });
          hintsUsed = tier;
        }
      } else {
        const row = await db.levelProgress.upsert({
          where: { playerId_puzzleId: { playerId, puzzleId: id } },
          create: { playerId, puzzleId: id, hintsUsed: tier },
          update: {},
        });
        if (tier > row.hintsUsed) {
          await db.levelProgress.update({ where: { id: row.id }, data: { hintsUsed: tier } });
          hintsUsed = tier;
        } else {
          hintsUsed = row.hintsUsed;
        }
      }
    }
    return NextResponse.json({ tier, hint, hintsUsed });
  } catch (err) {
    return serverError(err);
  }
}
