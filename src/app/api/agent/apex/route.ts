import { NextRequest, NextResponse } from 'next/server';
import type { Grid, Pair } from '@/lib/arc/types';
import { compileSolver, runSolver } from '@/lib/server/program-exec';
import { llmChat } from '@/lib/server/llm';

export const maxDuration = 240;

interface Body {
  train?: Array<{ input: number[][]; output: number[][] }>;
  testInputs?: number[][][];
  config?: { samples?: number; repairSamples?: number; perTaskSeconds?: number };
}

interface AgentStepOut {
  kind: 'observe' | 'think' | 'verify' | 'act';
  label: string;
  detail?: string;
  code?: string;
  ok?: boolean;
}

// ─────────────────────────────────────────────────────────── LLM plumbing

const SYSTEM = `You are an expert ARC program-synthesis engine (verified program synthesis, as in acco-cyber's ARC-AGI-2 Phase-B solver).
You write a JavaScript function BODY that transforms an input grid into the output grid, so that it reproduces EVERY example pair EXACTLY.
Contract:
- Your code is the BODY of: function solve(train, testInput, H) { ...your code... }
- train: array of {input: number[][], output: number[][]}; testInput: number[][] (values 0..9)
- H holds helpers: H.make(h,w,fill), H.clone(g), H.dims(g), H.rot90(g), H.rot180(g), H.rot270(g), H.flipH(g), H.flipV(g), H.transpose(g), H.recolor(g,{a:b,...}), H.shift(g,dr,dc), H.cropToContent(g)
- Generalize from the examples: derive the RULE, do not hardcode grids or colors that only appear in one example unless the rule requires it.
- No imports, no I/O, no console, no while(true) without a clear exit. Pure function.
Reply with ONLY the code, fenced as \`\`\`js ... \`\`\`.`;

const DIRECT_SYSTEM = `You are an ARC solver. Given example input/output grid pairs, infer the transformation and output the test grid.
Grids are rectangular arrays of integers 0-9. The output may differ in size from the input.
Reply with ONLY the output grid as a JSON array of arrays. No markdown, no commentary.`;

function gridToText(g: Grid): string {
  return JSON.stringify(g);
}

function pairsToPrompt(train: Pair[]): string {
  return train
    .map((p, i) => `Example ${i + 1}:\nINPUT: ${gridToText(p.input)}\nOUTPUT: ${gridToText(p.output as Grid)}`)
    .join('\n\n');
}

function extractCode(text: string): string | null {
  if (!text) return null;
  const fence = text.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  const code = (fence ? fence[1] : text).trim();
  return code.length > 10 ? code : null;
}

function parseGrid(text: string): Grid | null {
  if (!text) return null;
  const start = text.indexOf('[[');
  const end = text.lastIndexOf(']]');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 2));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const w = Array.isArray(parsed[0]) ? parsed[0].length : -1;
    if (w <= 0) return null;
    for (const row of parsed) {
      if (!Array.isArray(row) || row.length !== w) return null;
      for (const cell of row) {
        if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return null;
      }
    }
    return parsed as Grid;
  } catch {
    return null;
  }
}

async function llmCall(system: string, user: string, timeoutMs = 45_000): Promise<string> {
  return llmChat(system, user, timeoutMs);
}

// ─────────────────────────────────────────────────────────── verification

interface CandidateProgram {
  code: string;
  fits: boolean;         // reproduces ALL examples
  fitCount: number;
  firstError?: string;
  predictions?: Grid[];  // on test inputs, only when fits
}

function verifyProgram(code: string, train: Pair[], testInputs: Grid[]): CandidateProgram {
  const compiled = compileSolver(code);
  if (!compiled.ok) return { code, fits: false, fitCount: 0, firstError: compiled.error };
  let fitCount = 0;
  let firstError: string | undefined;
  for (let i = 0; i < train.length; i++) {
    const p = train[i];
    const out = runSolver(compiled.fn, [p], p.input, 2000);
    if (!out.ok) {
      firstError = firstError ?? `example ${i + 1}: ${out.error}`;
      continue;
    }
    const expected = p.output as Grid;
    const got = out.grid as Grid;
    const shapeOk = got.length === expected.length && got[0].length === expected[0].length;
    const eq = shapeOk && got.every((row, r) => row.every((c, ci) => c === expected[r][ci]));
    if (eq) fitCount++;
    else firstError = firstError ?? `example ${i + 1}: output mismatch (got ${got.length}×${got[0]?.length ?? 0}, expected ${expected.length}×${expected[0].length})`;
  }
  const fits = fitCount === train.length;
  let predictions: Grid[] | undefined;
  if (fits) {
    predictions = [];
    for (const ti of testInputs) {
      const out = runSolver(compiled.fn, train, ti, 3000);
      predictions.push(out.ok ? (out.grid as Grid) : ti.map((r) => [...r]));
    }
  }
  return { code, fits, fitCount, firstError, predictions };
}

// ─────────────────────────────────────────────────────────── route

/**
 * POST /api/agent/apex
 * Verified program synthesis in the style of acco-cyber/ARC-AGI-2 Phase-B:
 *   R1 fresh programs → verify against ALL examples → R2 repair with failing-pair
 *   feedback → R3 direct-grid fallback. A program is only accepted with external
 *   evidence (it reproduces every demonstration exactly).
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const steps: AgentStepOut[] = [];
  try {
    const body = (await req.json()) as Body;
    const train = body.train ?? [];
    const testInputs = body.testInputs ?? [];
    if (train.length === 0 || testInputs.length === 0) {
      return NextResponse.json({ error: 'train and testInputs are required' }, { status: 400 });
    }
    const K1 = Math.min(Math.max(body.config?.samples ?? 2, 1), 3);
    const K2 = Math.min(Math.max(body.config?.repairSamples ?? 2, 1), 3);

    steps.push({
      kind: 'observe',
      label: `Studied ${train.length} example pair${train.length === 1 ? '' : 's'}`,
      detail: 'Strategy: synthesize a program, accept it only if it reproduces every example exactly.',
    });

    const examples = pairsToPrompt(train);
    let best: CandidateProgram | null = null;

    // ── Round 1: fresh programs
    steps.push({ kind: 'think', label: `Round 1 — asking the LLM for ${K1} candidate program${K1 === 1 ? '' : 's'}` });
    for (let i = 0; i < K1; i++) {
      try {
        const text = await llmCall(SYSTEM, `${examples}\n\nWrite the program body for solve(train, testInput, H).`);
        const code = extractCode(text);
        if (!code) {
          steps.push({ kind: 'verify', label: `Program ${i + 1}: unparsable reply`, ok: false });
          continue;
        }
        const verdict = verifyProgram(code, train, testInputs);
        steps.push({
          kind: 'verify',
          label: `Program ${i + 1}: ${verdict.fitCount}/${train.length} examples reproduced`,
          detail: verdict.firstError,
          code,
          ok: verdict.fits,
        });
        if (!best || verdict.fitCount > best.fitCount) best = verdict;
        if (verdict.fits) break;
      } catch (err) {
        steps.push({ kind: 'verify', label: `Program ${i + 1}: LLM error`, detail: err instanceof Error ? err.message : 'error', ok: false });
      }
    }

    // ── Round 2: repair with failing-pair feedback
    if (!best?.fits && best) {
      steps.push({ kind: 'think', label: `Round 2 — repair: best program reproduced ${best.fitCount}/${train.length}; sending failing-pair feedback` });
      for (let i = 0; i < K2; i++) {
        try {
          const repairPrompt = `${examples}\n\nHere is a program that is WRONG:\n\`\`\`js\n${best.code}\n\`\`\`\nIts error: ${best.firstError ?? 'output mismatch'}.\nRewrite the program so it reproduces EVERY example exactly. Same contract, reply with only the corrected code.`;
          const text = await llmCall(SYSTEM, repairPrompt);
          const code = extractCode(text);
          if (!code) continue;
          const verdict = verifyProgram(code, train, testInputs);
          steps.push({
            kind: 'verify',
            label: `Repaired program ${i + 1}: ${verdict.fitCount}/${train.length} examples reproduced`,
            detail: verdict.firstError,
            code,
            ok: verdict.fits,
          });
          if (!best || verdict.fitCount > best.fitCount) best = verdict;
          if (verdict.fits) break;
        } catch (err) {
          steps.push({ kind: 'verify', label: `Repaired program ${i + 1}: LLM error`, detail: err instanceof Error ? err.message : 'error', ok: false });
        }
      }
    }

    // ── success path: verified program
    if (best?.fits && best.predictions) {
      steps.push({ kind: 'verify', label: `Program verified: reproduces all ${train.length} examples ✔`, ok: true });
      steps.push({ kind: 'act', label: 'Applied the verified program to each test input' });
      return NextResponse.json({
        ok: true,
        attempts: testInputs.map((_, i) => [best!.predictions![i]]),
        steps,
        program: best.code,
        elapsedMs: Date.now() - t0,
        engine: 'APEX-style verified program synthesis (methodology port of acco-cyber/ARC-AGI-2 Phase-B)',
        note: 'Accepted on external evidence: the program reproduces every demonstration exactly.',
      });
    }

    // ── Round 3: direct grid fallback (like solver_b.py R3)
    steps.push({ kind: 'think', label: 'No program fits all examples — Round 3: direct grid fallback', detail: best ? `best program: ${best.fitCount}/${train.length}` : 'no parsable program' });
    const attempts: Grid[][] = [];
    let note = '';
    for (const ti of testInputs) {
      const preds: Grid[] = [];
      for (let i = 0; i < 2 && preds.length < 2; i++) {
        try {
          const text = await llmCall(
            DIRECT_SYSTEM,
            `${examples}\n\nTest INPUT: ${gridToText(ti)}\n\nWhat is the Test OUTPUT? Reply with ONLY the output grid as a JSON array of arrays.`,
          );
          const grid = parseGrid(text);
          if (grid && !preds.some((p) => JSON.stringify(p) === JSON.stringify(grid))) preds.push(grid);
        } catch (err) {
          note = err instanceof Error ? err.message : 'llm-error';
        }
      }
      attempts.push(preds.length > 0 ? preds : [ti.map((r) => [...r])]);
      if (preds.length === 0) note = note || 'llm produced no parsable grid; copy-input fallback';
    }
    steps.push({ kind: 'act', label: 'Direct fallback produced candidate grids (unverified — no program evidence)', ok: false });

    return NextResponse.json({
      ok: true,
      attempts,
      steps,
      program: best?.code,
      elapsedMs: Date.now() - t0,
      engine: 'APEX-style verified program synthesis (methodology port of acco-cyber/ARC-AGI-2 Phase-B)',
      note: note || 'Direct-grid fallback: candidates are NOT externally verified.',
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, attempts: [], steps, error: err instanceof Error ? err.message : 'server error', elapsedMs: Date.now() - t0 },
      { status: err instanceof Error && err.message.includes('required') ? 400 : 200 },
    );
  }
}
