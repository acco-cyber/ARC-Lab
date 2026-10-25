import { NextRequest, NextResponse } from 'next/server';
import { todayKey } from '@/lib/arc/curriculum';
import { computeBadges, computeStreak, computeUnlocks, playerLevel } from '@/lib/arc/progress';
import { db } from '@/lib/db';
import { ensurePlayer, serverError } from '@/lib/server/api';

/**
 * GET /api/progress?playerId=...
 * Full player profile: XP, level, badges, per-level progress, daily streak, unlocks.
 */
export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId');
    const pid = await ensurePlayer(playerId);
    if (!pid) {
      return NextResponse.json({
        xp: 0,
        levelInfo: playerLevel(0),
        badges: [],
        levels: [],
        dailies: [],
        streak: 0,
        unlocks: { levels: ['w1l1'], worlds: [1] },
      });
    }
    const player = await db.player.findUnique({
      where: { id: pid },
      include: { levels: true, dailies: true },
    });
    const xp = player?.xp ?? 0;
    const levels = (player?.levels ?? []).map((l) => ({
      puzzleId: l.puzzleId,
      solved: l.solved,
      attempts: l.attempts,
      wrongAttempts: l.wrongAttempts,
      hintsUsed: l.hintsUsed,
    }));
    const dailies = (player?.dailies ?? []).map((d) => ({ date: d.date, solved: d.solved }));
    const dateKey = todayKey();
    const badges = computeBadges(levels, dailies, xp, dateKey);
    const streak = computeStreak(dailies, dateKey);
    const unlocks = computeUnlocks(levels);
    return NextResponse.json({
      xp,
      levelInfo: playerLevel(xp),
      badges,
      levels,
      dailies,
      streak,
      unlocks: { levels: [...unlocks.unlockedLevels], worlds: [...unlocks.unlockedWorlds] },
    });
  } catch (err) {
    return serverError(err);
  }
}
