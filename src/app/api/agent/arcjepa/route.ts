import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export const maxDuration = 180;

interface Body {
  train?: Array<{ input: number[][]; output: number[][] }>;
  testInputs?: number[][][];
  config?: { perTaskSeconds?: number; seed?: number };
}

interface EngineResult {
  ok: boolean;
  predictions?: number[][][];
  attempts?: number[][][][];
  program?: string;
  difficulty?: { score: number; bucket: number } | null;
  diagnostics?: Record<string, unknown>;
  elapsed_ms?: number;
  error?: string;
}

function runEngine(payload: string, timeoutMs: number): Promise<EngineResult> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), 'engine', 'arcjepa_agent.py');
    if (!fs.existsSync(script)) {
      resolve({ ok: false, error: 'engine script not found (engine/arcjepa_agent.py missing)' });
      return;
    }
    const proc = spawn('python3', [script], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({ ok: false, error: `engine timeout after ${Math.round(timeoutMs / 1000)}s` });
      }
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `python3 unavailable: ${err.message}` });
    });
    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const lines = stdout.trim().split('\n');
        const parsed = JSON.parse(lines[lines.length - 1]) as EngineResult;
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: `engine returned non-JSON output${stderr ? `: ${stderr.slice(-300)}` : ''}` });
      }
    });
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/**
 * POST /api/agent/arcjepa
 * Runs the vendored acco-cyber/ARC-AGI-2 symbolic engine (engine/arcjepa_agent.py)
 * on one task. The engine only ever receives train pairs + test inputs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const train = body.train ?? [];
    const testInputs = body.testInputs ?? [];
    if (train.length === 0 || testInputs.length === 0) {
      return NextResponse.json({ error: 'train and testInputs are required' }, { status: 400 });
    }
    const seconds = Math.min(Math.max(body.config?.perTaskSeconds ?? 15, 3), 45);
    const payload = JSON.stringify({
      train,
      test: testInputs.map((input) => ({ input })),
      config: { per_task_seconds: seconds, seed: body.config?.seed ?? 0 },
    });

    const t0 = Date.now();
    const result = await runEngine(payload, (seconds + 20) * 1000);
    const elapsedMs = Date.now() - t0;

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          attempts: testInputs.map((g) => [g]),
          steps: [],
          error: result.error ?? 'engine failed',
          elapsedMs,
          engine: 'arcjepa (acco-cyber/ARC-AGI-2)',
        },
        { status: 200 },
      );
    }

    const attempts = (result.attempts ?? []).map((pair) => pair.map((g) => g as number[][]));
    const diag = result.diagnostics ?? {};
    const num = (v: unknown, dflt = 0) => (typeof v === 'number' ? v : dflt);
    const steps = [
      {
        kind: 'observe',
        label: `Parsed the task — difficulty score ${typeof diag.difficulty === 'number' ? diag.difficulty.toFixed(2) : '?'}`,
        detail: `bucket ${num(diag.bucket, num(result.difficulty?.bucket))} · objects/grid ≈ ${num(diag.objects).toFixed(2)}`,
      },
      {
        kind: 'think',
        label: `Beam search: ${num(diag.beam_expansions).toLocaleString()} expansions → ${num(diag.n_candidates)} candidates`,
        detail: `stages (ms): ${JSON.stringify(diag.stages ?? {})}`,
      },
      {
        kind: 'verify',
        label: `Exact fits on examples: ${num(diag.n_exact)}`,
        ok: num(diag.n_exact) > 0,
        code: result.program || undefined,
      },
      {
        kind: 'act',
        label: `Selected attempt 1 from "${diag.best_source ?? 'search'}"`,
        detail: diag.selection ? JSON.stringify(diag.selection).slice(0, 180) : undefined,
      },
    ];

    return NextResponse.json({
      ok: true,
      attempts,
      steps,
      program: result.program,
      elapsedMs,
      engine: 'arcjepa (acco-cyber/ARC-AGI-2), symbolic mode',
      note: result.difficulty ? `difficulty score ${result.difficulty.score} (bucket ${result.difficulty.bucket})` : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'server error' }, { status: 500 });
  }
}
