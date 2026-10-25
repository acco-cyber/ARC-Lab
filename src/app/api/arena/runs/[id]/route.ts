import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notFound, serverError } from '@/lib/server/api';

/** GET /api/arena/runs/[id] — full persisted run (config, summary, per-task). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = await db.arenaRun.findUnique({ where: { id } });
    if (!run) return notFound('Run not found');
    return NextResponse.json({
      id: run.id,
      createdAt: run.createdAt,
      config: JSON.parse(run.config),
      summary: JSON.parse(run.summary),
      perTask: JSON.parse(run.perTask),
    });
  } catch (err) {
    return serverError(err);
  }
}
