/**
 * Batch test: run the vendored acco-cyber/ARC-AGI-2 arc-jepa engine over a
 * deterministic sample of ARC Lab curriculum tasks and report honest metrics.
 *
 * Usage: bun run scripts/batch-engine-test.ts [taskCount] [secondsPerTask]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { LEVELS, levelTask } from '../src/lib/arc/curriculum/index';
import type { Grid } from '../src/lib/arc/types';

const COUNT = Number(process.argv[2] ?? 10);
const SECONDS = Number(process.argv[3] ?? 15);

interface EngineOut {
  ok: boolean;
  attempts?: number[][][][];
  program?: string;
  difficulty?: { score: number; bucket: number } | null;
  diagnostics?: Record<string, unknown>;
  error?: string;
}

function runEngine(taskJson: unknown, seconds: number): Promise<EngineOut> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), 'engine', 'arcjepa_agent.py');
    const proc = spawn('python3', [script], { cwd: process.cwd() });
    let stdout = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ ok: false, error: 'timeout' });
    }, (seconds + 15) * 1000);
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const lines = stdout.trim().split('\n');
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch {
        resolve({ ok: false, error: 'bad engine output' });
      }
    });
    proc.stdin.write(JSON.stringify(taskJson));
    proc.stdin.end();
  });
}

function pixelAcc(pred: Grid, exp: Grid): number {
  if (pred.length !== exp.length || pred[0]?.length !== exp[0]?.length) return 0;
  let diff = 0;
  for (let r = 0; r < exp.length; r++) for (let c = 0; c < exp[r].length; c++) if (pred[r][c] !== exp[r][c]) diff++;
  return 1 - diff / (exp.length * exp[0].length);
}

async function main() {
  const step = Math.max(1, Math.floor(LEVELS.length / COUNT));
  const chosen: string[] = [];
  for (let i = 0; i < LEVELS.length && chosen.length < COUNT; i += step) chosen.push(LEVELS[i].id);

  const rows: Array<{ id: string; exact: boolean; pass2: boolean; pixel: number; ms: number; program: string; bucket: number | null }> = [];
  console.log(`Testing the acco-cyber/ARC-AGI-2 arcjepa engine on ${chosen.length} curriculum tasks (${SECONDS}s budget each)…\n`);

  for (const id of chosen) {
    const task = levelTask(id, { reveal: true });
    const payload = {
      train: task.train.map((p) => ({ input: p.input, output: p.output })),
      test: task.test.map((p) => ({ input: p.input })),
      config: { per_task_seconds: SECONDS, seed: 0 },
    };
    const t0 = Date.now();
    const out = await runEngine(payload, SECONDS);
    const ms = Date.now() - t0;
    const expected = task.test[0].output ?? null;
    const attempts = out.attempts ?? [];
    const a1 = attempts[0]?.[0] as Grid | undefined;
    const a2 = attempts[0]?.[1] as Grid | undefined;
    const exact = !!(expected && a1 && a1.length === expected.length && a1[0]?.length === expected[0]?.length && a1.every((row, r) => row.every((c, ci) => c === expected[r][ci])));
    const pass2 = exact || !!(expected && [a1, a2].some((a) => a && a.length === expected.length && a[0]?.length === expected[0]?.length && a.every((row, r) => row.every((c, ci) => c === expected[r][ci]))));
    const pixel = expected && a1 ? pixelAcc(a1, expected) : 0;
    const prog = (out.program ?? '').slice(0, 60);
    const bucket = out.difficulty?.bucket ?? null;
    rows.push({ id, exact, pass2, pixel, ms, program: prog, bucket });
    console.log(`${exact ? '✔' : pass2 ? '◐' : '✘'} ${id.padEnd(8)} exact=${exact ? 1 : 0} pass2=${pass2 ? 1 : 0} pixel=${(pixel * 100).toFixed(0)}%  ${ms}ms  bucket=${bucket}  ${prog}`);
  }

  const solved = rows.filter((r) => r.exact).length;
  const p2 = rows.filter((r) => r.pass2).length;
  const avgPixel = rows.reduce((s, r) => s + r.pixel, 0) / rows.length;
  const avgMs = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
  console.log('\n=== SUMMARY (engine: arcjepa from acco-cyber/ARC-AGI-2, symbolic mode) ===');
  console.log(`tasks: ${rows.length} · exact: ${solved} (${((solved / rows.length) * 100).toFixed(0)}%) · pass@2: ${p2} (${((p2 / rows.length) * 100).toFixed(0)}%) · avg pixel: ${(avgPixel * 100).toFixed(1)}% · avg time: ${(avgMs / 1000).toFixed(2)}s`);
  console.log('\nNote: later worlds are deliberately harder mixes; low exact rates there are expected for a depth-bounded CPU symbolic search.');
}

main();
