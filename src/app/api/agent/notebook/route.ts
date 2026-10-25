import { NextRequest, NextResponse } from 'next/server';
import { badRequest, ensurePlayer } from '@/lib/server/api';
import {
  analyzeNotebook,
  fetchNotebook,
  notebookAgentId,
  runNotebookOnTask,
} from '@/lib/server/notebook';
import { isOfficialDataset, loadOfficialTask, markServed, pickUnseenTask, recordRun, scoreAttempts } from '@/lib/server/official';
import type { Grid } from '@/lib/arc/types';

export const maxDuration = 800;

interface Body {
  action?: 'analyze' | 'run';
  source?: { url?: string; content?: string };
  playerId?: string;
  dataset?: string;
  /** how many fresh puzzles to test (1..5) */
  count?: number;
  samples?: number;
  repairSamples?: number;
}

interface TaskResult {
  dataset: string;
  taskId: string;
  freshNumber: number;
  seen: number;
  total: number;
  testInput: Grid;
  attempts: Grid[][];
  expected: Grid[];
  score: ReturnType<typeof scoreAttempts>;
  steps: unknown[];
  execLog: unknown[];
  entrypoint?: string;
  program?: string;
  engine: string;
  note?: string;
  elapsedMs: number;
  ok: boolean;
  error?: string;
}

/**
 * POST /api/agent/notebook
 *  action=analyze → parse + verdict only (no puzzles consumed)
 *  action=run     → analyze, then run the notebook on N FRESH official puzzles
 *                   (never-repeat queue per notebook hash), score server-side,
 *                   record runs, reveal expected grids post-commit.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = (await req.json()) as Body;
    let raw: string | null = null;
    if (body.source?.content && body.source.content.trim().startsWith('{')) {
      raw = body.source.content;
    } else if (body.source?.url) {
      raw = await fetchNotebook(body.source.url.trim());
    }
    if (!raw) return badRequest('Provide source.url (a raw .ipynb URL) or source.content (notebook JSON).');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return badRequest('The file is not valid JSON — is it really a .ipynb notebook?');
    }
    const nbObj = parsed as { cells?: unknown };
    if (!nbObj || !Array.isArray(nbObj.cells)) return badRequest('Not a Jupyter notebook (no "cells" array).');

    const analysis = analyzeNotebook(raw);
    const agentId = notebookAgentId(raw);

    if (body.action === 'analyze') {
      return NextResponse.json({ ok: true, analysis, agentId });
    }

    // ── action=run
    const playerId = await ensurePlayer(body.playerId);
    if (!playerId) return badRequest('valid playerId required');
    const ds = body.dataset;
    if (!isOfficialDataset(ds)) return badRequest('dataset must be training or evaluation');

    const count = Math.min(Math.max(body.count ?? 1, 1), 5);
    const results: TaskResult[] = [];

    for (let i = 0; i < count; i++) {
      const pick = await pickUnseenTask(playerId, agentId, ds);
      if (!pick.taskId) {
        if (i === 0) {
          return NextResponse.json({
            ok: false,
            analysis,
            agentId,
            exhausted: true,
            message: `All ${pick.total} ${ds} puzzles have already been served to this notebook. Reset its history to run again.`,
          });
        }
        break;
      }
      const payload = loadOfficialTask(ds, pick.taskId, false);
      if (!payload) continue;
      // count the hand-out immediately (never-repeat guarantee even on failure)
      await markServed(playerId, agentId, ds, pick.taskId);
      const trainWithOut = payload.task.train.map((p) => ({ input: p.input, output: p.output ?? undefined }));
      const testInputs = payload.task.test.map((p) => p.input);

      const res = await runNotebookOnTask({
        train: trainWithOut,
        testInputs,
        rawNotebook: raw,
        samples: body.samples,
        repairSamples: body.repairSamples,
      });

      const score = scoreAttempts(payload.expected, res.attempts);
      await recordRun({
        playerId,
        agentId,
        dataset: ds,
        taskId: pick.taskId,
        score,
        elapsedMs: res.elapsedMs,
        engine: res.engine,
      });

      results.push({
        dataset: ds,
        taskId: pick.taskId,
        freshNumber: pick.seen + 1,
        seen: pick.seen + 1,
        total: pick.total,
        testInput: testInputs[0] ?? [],
        attempts: res.attempts,
        expected: payload.expected,
        score,
        steps: res.steps,
        execLog: res.execLog,
        entrypoint: res.entrypoint,
        program: res.program,
        engine: res.engine,
        note: res.note,
        elapsedMs: res.elapsedMs,
        ok: res.ok,
        error: res.error,
      });
    }

    if (results.length === 0) {
      return badRequest('No puzzle could be served — is the dataset vendored?');
    }

    const solved = results.filter((r) => r.score.exact === true).length;
    return NextResponse.json({
      ok: true,
      analysis,
      agentId,
      engine: results[0]?.engine,
      summary: {
        tested: results.length,
        solved,
        pass2: results.filter((r) => r.score.pass2 === true).length,
        avgPixel: results.reduce((s, r) => s + (r.score.pixelAcc ?? 0), 0) / results.length,
        totalMs: Date.now() - t0,
      },
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'notebook run failed';
    return NextResponse.json({ ok: false, error: message, elapsedMs: Date.now() - t0 }, { status: message.startsWith('Only https') || message.includes('required') || message.includes('must be') || message.includes('not valid') || message.includes('not a Jupyter') ? 400 : 500 });
  }
}
