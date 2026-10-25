import { NextRequest, NextResponse } from 'next/server';
import type { Grid, Pair } from '@/lib/arc/types';
import { solveWithLlm } from '@/lib/arc/llm-solver';

export const maxDuration = 240;

interface Body {
  train?: Array<{ input: number[][]; output: number[][] }>;
  testInputs?: number[][][];
}

/**
 * POST /api/agent/direct
 * LLM direct reasoner: sends demonstration pairs and asks for the answer grid.
 * Two samples per test input for pass@2.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const steps: Array<{ kind: string; label: string; detail?: string; ok?: boolean }> = [];
  try {
    const body = (await req.json()) as Body;
    const train = body.train ?? [];
    const testInputs = body.testInputs ?? [];
    if (train.length === 0 || testInputs.length === 0) {
      return NextResponse.json({ error: 'train and testInputs are required' }, { status: 400 });
    }
    steps.push({ kind: 'observe', label: `Studied ${train.length} example pair${train.length === 1 ? '' : 's'}` });
    steps.push({ kind: 'think', label: 'Reasoning over the examples, then answering directly (2 samples)' });

    const attempts: Grid[][] = [];
    let note: string | undefined;
    for (const ti of testInputs) {
      const res = await solveWithLlm(train as Pair[], ti, 2);
      attempts.push(res.predictions.slice(0, 2));
      if (res.note) note = res.note;
    }
    steps.push({ kind: 'act', label: `Produced ${attempts.length} prediction set${attempts.length === 1 ? '' : 's'}`, detail: note });

    return NextResponse.json({
      ok: true,
      attempts,
      steps,
      elapsedMs: Date.now() - t0,
      engine: 'LLM direct reasoner (GLM via z-ai-web-dev-sdk)',
      note,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, attempts: [], steps, error: err instanceof Error ? err.message : 'server error', elapsedMs: Date.now() - t0 },
      { status: 200 },
    );
  }
}
