import { NextRequest, NextResponse } from 'next/server';
import { taskForId, LEVELS } from '@/lib/arc/curriculum';
import { validateArcJson, ARC_LAB_DATASET_VERSION, APP_VERSION, type Grid, type Task } from '@/lib/arc/types';
import { SOLVERS, getSolver, sanitizeTaskForSolver } from '@/lib/arc/solvers';
import { classifyFailure, exactMatch, pixelAccuracy, summarize, type PerTaskResult } from '@/lib/arc/metrics';
import { db } from '@/lib/db';
import { ensurePlayer, badRequest, serverError } from '@/lib/server/api';

export const maxDuration = 300;

interface RunBody {
  playerId?: string;
  solvers?: string[];
  scope?:
    | { type: 'curriculum'; worlds?: number[]; ids?: string[]; limit?: number }
    | { type: 'inline'; tasks?: unknown[] };
}

/**
 * POST /api/arena/run
 * Runs selected solvers against a task subset and returns full metrics +
 * a reproducibility manifest. Never exposes solvers to expected outputs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunBody;
    const playerId = await ensurePlayer(body.playerId);

    const solverIds = (body.solvers ?? []).filter((id) => getSolver(id));
    if (solverIds.length === 0) return badRequest('Select at least one valid solver');
    const useLlm = solverIds.includes('llm-glm');

    // ---- resolve tasks ----
    const tasks: Task[] = [];
    const scope = body.scope;
    if (!scope || scope.type === 'curriculum') {
      const cur = scope && 'worlds' in scope ? scope : ({} as { worlds?: number[]; ids?: string[]; limit?: number });
      let pool = LEVELS;
      if (cur.worlds && cur.worlds.length > 0) pool = pool.filter((l) => cur.worlds!.includes(l.world));
      if (cur.ids && cur.ids.length > 0) pool = pool.filter((l) => cur.ids!.includes(l.id));
      const limit = Math.min(Math.max(cur.limit ?? 10, 1), useLlm ? 5 : 30);
      const step = Math.max(1, Math.floor(pool.length / limit));
      const chosen: typeof pool = [];
      for (let i = 0; i < pool.length && chosen.length < limit; i += step) chosen.push(pool[i]);
      for (const lv of chosen) tasks.push(taskForId(lv.id, { reveal: true }));
    } else {
      const inline = (scope as { tasks?: unknown[] }).tasks ?? [];
      if (!Array.isArray(inline) || inline.length === 0) return badRequest('inline scope requires tasks array');
      const capped = inline.slice(0, useLlm ? 5 : 20);
      capped.forEach((raw, i) => {
        const res = validateArcJson(raw, `inline-${i + 1}`);
        if (res.ok && res.task) tasks.push(res.task);
      });
      if (tasks.length === 0) return badRequest('No valid tasks in inline scope');
    }

    // ---- run solvers ----
    const perTask: PerTaskResult[] = [];
    for (const solverId of solverIds) {
      const solver = getSolver(solverId)!;
      for (const task of tasks) {
        const { train, testInput } = sanitizeTaskForSolver(task);
        const expected: Grid | null = task.test[0].output ?? null;
        const t0 = Date.now();
        let predictions: Grid[] = [];
        let note: string | undefined;
        try {
          const out = await solver.run(train, testInput);
          predictions = out.predictions ?? [];
          note = out.note;
        } catch (err) {
          note = err instanceof Error ? err.message : 'solver-error';
        }
        const runtimeMs = Date.now() - t0;
        const pred = predictions[0] ?? null;
        perTask.push({
          taskId: task.id,
          solverId: solver.id,
          runtimeMs,
          predictions: predictions.slice(0, 2),
          expected,
          exact: expected ? exactMatch(pred, expected) : null,
          pass2: expected ? predictions.some((p) => exactMatch(p, expected)) : null,
          pixelAcc: expected ? pixelAccuracy(pred, expected) : null,
          failure: classifyFailure(pred, expected),
          note,
        });
      }
    }

    const summary = solverIds.map((id) => summarize(perTask.filter((r) => r.solverId === id)));

    // ---- persist ----
    const config = {
      solvers: solverIds,
      scope,
      datasetVersion: ARC_LAB_DATASET_VERSION,
      appVersion: APP_VERSION,
      seed: null,
      taskIds: tasks.map((t) => t.id),
    };
    let runId: string | null = null;
    try {
      const run = await db.arenaRun.create({
        data: {
          playerId,
          config: JSON.stringify(config),
          summary: JSON.stringify(summary),
          perTask: JSON.stringify(
            perTask.map((r) => ({ ...r, predictions: r.predictions.map((p) => p) })),
          ),
        },
      });
      runId = run.id;
    } catch (err) {
      console.error('[arena] persist failed', err);
    }

    return NextResponse.json({
      runId,
      createdAt: new Date().toISOString(),
      config,
      summary,
      perTask,
      solverCatalog: SOLVERS.map((s) => ({ id: s.id, name: s.name, kind: s.kind, description: s.description, limitations: s.limitations, slow: !!s.slow })),
    });
  } catch (err) {
    return serverError(err);
  }
}
