import { NextRequest, NextResponse } from 'next/server';
import { taskForId, isDailyId } from '@/lib/arc/curriculum';
import { gridsEqual } from '@/lib/arc/grid';
import { computeXpAward } from '@/lib/arc/progress';
import { db } from '@/lib/db';
import { ensurePlayer, badRequest, notFound, serverError } from '@/lib/server/api';

interface SubmitBody {
  playerId?: string;
  grid?: number[][];
  mode?: 'practice' | 'challenge';
  revealIfWrong?: boolean;
}

function isValidGridShape(g: unknown): g is number[][] {
  if (!Array.isArray(g) || g.length === 0 || g.length > 40) return false;
  const w = g[0]?.length;
  if (typeof w !== 'number' || w === 0 || w > 40) return false;
  return g.every((row) => Array.isArray(row) && row.length === w && row.every((c) => Number.isInteger(c) && c >= 0 && c <= 9));
}

/**
 * POST /api/puzzles/[id]/submit
 * Validates the submitted grid against the hidden expected output.
 * Challenge mode: 2 attempts max, then the answer is revealed (no XP).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as SubmitBody;
    const playerId = await ensurePlayer(body.playerId);
    const mode = body.mode === 'challenge' ? 'challenge' : 'practice';
    if (!isValidGridShape(body.grid)) return badRequest('grid must be a rectangular array of ints 0..9 (max 40×40)');

    let task;
    try {
      task = taskForId(id, { reveal: true });
    } catch {
      return notFound(`Unknown puzzle: ${id}`);
    }
    const expected = task.test[0].output!;
    const correct = gridsEqual(body.grid!, expected);

    let xpAwarded = 0;
    let attempts = 1;
    let wrongAttempts = 0;
    let firstSolve = false;
    let failed = false;

    if (playerId) {
      if (isDailyId(id)) {
        const dateKey = id.slice('daily-'.length);
        const row = await db.dailyResult.upsert({
          where: { playerId_date: { playerId, date: dateKey } },
          create: { playerId, date: dateKey },
          update: {},
        });
        attempts = (row.solved ? 1 : 0) + 1;
        if (correct && !row.solved) {
          const xpRow = await db.player.findUnique({ where: { id: playerId } });
          const hintsUsed = row.hintsUsed;
          xpAwarded = computeXpAward({ puzzleId: id, mode, wrongAttempts: 0, hintsUsed, isDaily: true });
          await db.$transaction([
            db.dailyResult.update({ where: { id: row.id }, data: { solved: true } }),
            db.player.update({ where: { id: playerId }, data: { xp: (xpRow?.xp ?? 0) + xpAwarded } }),
          ]);
          firstSolve = true;
        } else if (!correct) {
          if (!row.solved) {
            await db.player.update({ where: { id: playerId }, data: { xp: { increment: 5 } } });
            xpAwarded = 5;
          }
        }
      } else {
        const row = await db.levelProgress.upsert({
          where: { playerId_puzzleId: { playerId, puzzleId: id } },
          create: { playerId, puzzleId: id },
          update: {},
        });
        attempts = row.attempts + 1;
        wrongAttempts = row.wrongAttempts + (correct ? 0 : 1);
        if (correct && !row.solved) {
          const xpRow = await db.player.findUnique({ where: { id: playerId } });
          xpAwarded = computeXpAward({ puzzleId: id, mode, wrongAttempts: row.wrongAttempts, hintsUsed: row.hintsUsed });
          await db.$transaction([
            db.levelProgress.update({ where: { id: row.id }, data: { solved: true, attempts, wrongAttempts } }),
            db.player.update({ where: { id: playerId }, data: { xp: (xpRow?.xp ?? 0) + xpAwarded } }),
          ]);
          firstSolve = true;
        } else if (!correct) {
          await db.levelProgress.update({ where: { id: row.id }, data: { attempts, wrongAttempts } });
          if (mode === 'practice') {
            await db.player.update({ where: { id: playerId }, data: { xp: { increment: 5 } } });
            xpAwarded = 5;
          }
        } else {
          await db.levelProgress.update({ where: { id: row.id }, data: { attempts, wrongAttempts } });
        }
        failed = !correct && mode === 'challenge' && wrongAttempts >= 2 && !row.solved;
      }
    }

    const reveal = correct || failed || (mode === 'practice' && body.revealIfWrong === true);
    return NextResponse.json({
      correct,
      attempts,
      wrongAttempts,
      failed,
      firstSolve,
      xpAwarded,
      expected: reveal ? expected : null,
      explanation: reveal ? task.metadata.explanation : null,
      mode,
    });
  } catch (err) {
    return serverError(err);
  }
}
