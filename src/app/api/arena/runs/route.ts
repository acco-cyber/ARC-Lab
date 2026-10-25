import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensurePlayer, serverError } from '@/lib/server/api';

/** GET /api/arena/runs?playerId=&limit= — recent run history (summaries only). */
export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId');
    const pid = await ensurePlayer(playerId);
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 15), 50);
    const runs = await db.arenaRun.findMany({
      where: pid ? { playerId: pid } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, createdAt: true, config: true, summary: true },
    });
    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        config: JSON.parse(r.config),
        summary: JSON.parse(r.summary),
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
