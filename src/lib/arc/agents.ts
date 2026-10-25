/**
 * ARC Lab — Agent Lab core (client-safe).
 *
 * An "agent" is anything that looks at demonstration pairs + a test input and
 * produces candidate output grids — the machine counterpart of the human
 * player. Agents come in four flavors:
 *
 *  - builtin : deterministic heuristics running fully client-side
 *  - engine  : the vendored acco-cyber/ARC-AGI-2 arc-jepa solver (Python engine, via API)
 *  - llm     : LLM-backed adapters (direct answer / verified program synthesis) via API
 *  - custom  * : user-supplied JavaScript (Web Worker) or an HTTP endpoint
 *
 * Every agent returns a step trace so the Agent Lab can *play* the solve
 * like a game replay: observe → think → verify → paint.
 */

import type { Grid, Pair } from './types';
import { gridsEqual } from './grid';
import { GEO_OPS } from './transforms';
import { recolor } from './transforms';
import { findObjects, keepObjects, largestObject } from './objects';
import { searchPrograms, applyProgram } from './dsl';

export type AgentKind = 'builtin' | 'engine' | 'llm' | 'custom';

export interface AgentStep {
  kind: 'observe' | 'think' | 'verify' | 'act';
  label: string;
  detail?: string;
  /** Optional structured payload for the UI (e.g. program text). */
  code?: string;
  ok?: boolean;
}

export interface AgentSolveInput {
  train: Pair[];
  testInputs: Grid[];
  /** Optional per-run knobs (engine seconds, samples, endpoint URL, custom code…). */
  config?: Record<string, unknown>;
  /** AbortSignal-ish: agents are awaited with an external deadline by the runner. */
}

export interface AgentRunResult {
  ok: boolean;
  /** Up to 2 candidate grids per test input, in test-input order. */
  attempts: Grid[][];
  steps: AgentStep[];
  program?: string;
  elapsedMs: number;
  engine?: string;
  note?: string;
  error?: string;
}

export interface AgentDef {
  id: string;
  name: string;
  emoji: string;
  kind: AgentKind;
  description: string;
  /** Honest provenance / limitations line shown under the agent card. */
  provenance?: string;
  /** true when the run can take >5s (UI shows a "working" state). */
  slow?: boolean;
  /** Does this agent need configuration before it can run? */
  needsConfig?: boolean;
  run: (input: AgentSolveInput) => Promise<AgentRunResult>;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function observeSteps(train: Pair[], testInputs: Grid[]): AgentStep[] {
  const colors = new Set<number>();
  for (const p of train) {
    for (const row of p.input) for (const c of row) colors.add(c);
    if (p.output) for (const row of p.output) for (const c of row) colors.add(c);
  }
  const outShape = train[0]?.output ? `${train[0].output.length}×${train[0].output[0].length}` : '?';
  return [
    {
      kind: 'observe',
      label: `Studied ${train.length} example pair${train.length === 1 ? '' : 's'}`,
      detail: `Output shape ${outShape}; ${colors.size} distinct colors in play; ${testInputs.length} test input${testInputs.length === 1 ? '' : 's'} to solve.`,
    },
  ];
}

function emptyResult(id: string, t0: number, error: string, steps: AgentStep[] = []): AgentRunResult {
  return { ok: false, attempts: [], steps, elapsedMs: Date.now() - t0, error, engine: id };
}

// ---------------------------------------------------------------------------
// built-in deterministic agents (client-side)
// ---------------------------------------------------------------------------

const copyBot: AgentDef = {
  id: 'copy-bot',
  name: 'Copy Bot',
  emoji: '🪞',
  kind: 'builtin',
  description: 'Echoes the test input back unchanged. The sanity agent.',
  provenance: 'Deterministic. Solves identity-style tasks by construction.',
  async run({ train, testInputs }) {
    const t0 = Date.now();
    const attempts = testInputs.map((g) => [g.map((r) => [...r])]);
    return {
      ok: true,
      attempts,
      steps: [
        ...observeSteps(train, testInputs),
        { kind: 'think', label: 'Hypothesis: output = input', detail: 'The simplest consistent rule. Useful to verify the scoring pipeline.' },
        { kind: 'act', label: 'Copied each test input as its prediction' },
      ],
      program: 'IDENTITY',
      elapsedMs: Date.now() - t0,
      engine: 'arc-lab builtin',
    };
  },
};

const ruleSniffer: AgentDef = {
  id: 'rule-sniffer',
  name: 'Rule Sniffer',
  emoji: '🔍',
  kind: 'builtin',
  description: 'Tries single geometric ops, recolors and keep-largest for a rule consistent with every example.',
  provenance: 'Deterministic. One-step rules only; no composition or shifting.',
  async run({ train, testInputs }) {
    const t0 = Date.now();
    const steps = observeSteps(train, testInputs);
    const tried: string[] = [];
    const attemptFor = (g: Grid): Grid | null => {
      for (const op of GEO_OPS) {
        if (train.every((p) => p.output && gridsEqual(op.fn(p.input), p.output))) return op.fn(g);
      }
      const colors = new Set<number>();
      for (const p of train) {
        for (const row of p.input) for (const c of row) colors.add(c);
        if (p.output) for (const row of p.output) for (const c of row) colors.add(c);
      }
      for (const a of colors) {
        for (const b of colors) {
          if (a === b) continue;
          if (train.every((p) => p.output && gridsEqual(recolor(p.input, { [a]: b }), p.output))) return recolor(g, { [a]: b });
        }
      }
      const largestFits = train.every((p) => {
        if (!p.output) return false;
        const det = findObjects(p.input);
        if (det.objects.length === 0) return false;
        return gridsEqual(keepObjects(p.input, [largestObject(det.objects)]), p.output);
      });
      if (largestFits) {
        const det = findObjects(g);
        if (det.objects.length > 0) return keepObjects(g, [largestObject(det.objects)]);
      }
      return null;
    };

    for (const op of GEO_OPS) {
      tried.push(op.label);
      if (train.every((p) => p.output && gridsEqual(op.fn(p.input), p.output))) {
        steps.push({ kind: 'think', label: `Hypothesis: ${op.label}`, detail: 'Consistent with every demonstration pair.' });
        steps.push({ kind: 'verify', label: `Verified on all ${train.length} examples`, ok: true });
        steps.push({ kind: 'act', label: `Applied ${op.label} to the test input${testInputs.length === 1 ? '' : 's'}` });
        return {
          ok: true,
          attempts: testInputs.map((g) => [op.fn(g)]),
          steps,
          program: op.label,
          elapsedMs: Date.now() - t0,
          engine: 'arc-lab builtin',
        };
      }
    }
    steps.push({ kind: 'think', label: `Tried ${tried.length} geometric ops — none fit`, detail: 'Falling back to recolor search…' });
    const colors = new Set<number>();
    for (const p of train) {
      for (const row of p.input) for (const c of row) colors.add(c);
      if (p.output) for (const row of p.output) for (const c of row) colors.add(c);
    }
    for (const a of colors) {
      for (const b of colors) {
        if (a === b) continue;
        if (train.every((p) => p.output && gridsEqual(recolor(p.input, { [a]: b }), p.output))) {
          steps.push({ kind: 'think', label: `Hypothesis: recolor ${a} → ${b}` });
          steps.push({ kind: 'verify', label: `Verified on all ${train.length} examples`, ok: true });
          steps.push({ kind: 'act', label: `Applied recolor ${a}→${b} to the test input${testInputs.length === 1 ? '' : 's'}` });
          return {
            ok: true,
            attempts: testInputs.map((g) => [recolor(g, { [a]: b })]),
            steps,
            program: `RECOLOR ${a}->${b}`,
            elapsedMs: Date.now() - t0,
            engine: 'arc-lab builtin',
          };
        }
      }
    }
    const det = findObjects(train[0].input);
    steps.push({ kind: 'think', label: 'No global rule fits — trying object heuristic (keep largest)' });
    const largestFits = train.every((p) => {
      if (!p.output) return false;
      const d2 = findObjects(p.input);
      if (d2.objects.length === 0) return false;
      return gridsEqual(keepObjects(p.input, [largestObject(d2.objects)]), p.output);
    });
    if (largestFits && det.objects.length >= 0) {
      const usable = testInputs.every((g) => findObjects(g).objects.length > 0);
      if (usable) {
        steps.push({ kind: 'verify', label: `Verified on all ${train.length} examples`, ok: true });
        steps.push({ kind: 'act', label: 'Kept the largest object of each test input' });
        return {
          ok: true,
          attempts: testInputs.map((g) => [keepObjects(g, [largestObject(findObjects(g).objects)])]),
          steps,
          program: 'KEEP_LARGEST',
          elapsedMs: Date.now() - t0,
          engine: 'arc-lab builtin',
        };
      }
    }
    steps.push({ kind: 'verify', label: 'No consistent rule found', ok: false });
    steps.push({ kind: 'act', label: 'Fallback: echoing the input (copy-input)' });
    return {
      ok: true,
      attempts: testInputs.map((g) => [g.map((r) => [...r])]),
      steps,
      program: 'FALLBACK_IDENTITY',
      elapsedMs: Date.now() - t0,
      note: 'No consistent one-step rule; copy-input fallback.',
      engine: 'arc-lab builtin',
    };
  },
};

const programSearcher: AgentDef = {
  id: 'program-searcher',
  name: 'Program Searcher',
  emoji: '🧩',
  kind: 'builtin',
  description: 'Bounded search over the 20-op ARC Lab DSL, ranked by consistency and simplicity.',
  provenance: 'Deterministic within its time budget. Depth ≤ 2 programs.',
  slow: true,
  async run({ train, testInputs }) {
    const t0 = Date.now();
    const steps = observeSteps(train, testInputs);
    steps.push({ kind: 'think', label: 'Enumerating DSL programs (depth ≤ 2)…', detail: 'Pruning on the first example, scoring consistency on the rest.' });
    const cands = searchPrograms(train, { maxOps: 2, timeBudgetMs: 3000, topK: 4 });
    if (cands.length === 0) {
      steps.push({ kind: 'verify', label: 'No consistent program within budget', ok: false });
      steps.push({ kind: 'act', label: 'Fallback: echoing the input (copy-input)' });
      return {
        ok: true,
        attempts: testInputs.map((g) => [g.map((r) => [...r])]),
        steps,
        elapsedMs: Date.now() - t0,
        note: 'No consistent program found within budget; copy-input fallback.',
        engine: 'arc-lab builtin',
      };
    }
    const best = cands[0];
    steps.push({
      kind: 'think',
      label: `Found ${cands.length} candidate program${cands.length === 1 ? '' : 's'}`,
      detail: `Best fits all examples: ${best.fitsAll ? 'yes' : 'partially'}.`,
      code: best.program.map((o) => o.op).join(' → '),
    });
    steps.push({ kind: 'verify', label: `Reproduces ${best.fitsAll ? 'all' : 'some'} demonstration outputs`, ok: best.fitsAll });
    steps.push({ kind: 'act', label: 'Applied the best program to each test input' });
    const attempts = testInputs.map((g) => {
      const pred = applyProgram(g, best.program);
      return [pred ?? g.map((r) => [...r])];
    });
    return {
      ok: true,
      attempts,
      steps,
      program: best.program.map((o) => o.op).join(' → '),
      elapsedMs: Date.now() - t0,
      engine: 'arc-lab builtin',
    };
  },
};

// ---------------------------------------------------------------------------
// server-backed agents (engine / llm)
// ---------------------------------------------------------------------------

async function postAgent<T>(url: string, body: unknown, timeoutMs = 120_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

interface ServerAgentResponse {
  ok: boolean;
  attempts: Grid[][];
  steps: AgentStep[];
  program?: string;
  elapsedMs: number;
  engine?: string;
  note?: string;
  error?: string;
}

function serverAgent(def: Omit<AgentDef, 'run'>, url: string, timeoutMs = 150_000): AgentDef {
  return {
    ...def,
    async run(input) {
      const t0 = Date.now();
      try {
        const data = await postAgent<ServerAgentResponse>(url, { ...input }, timeoutMs);
        return { ...data, elapsedMs: data.elapsedMs ?? Date.now() - t0, steps: data.steps ?? [] };
      } catch (err) {
        return emptyResult(def.id, t0, err instanceof Error ? err.message : 'request-failed', observeSteps(input.train, input.testInputs));
      }
    },
  };
}

const arcjepaAgent = serverAgent(
  {
    id: 'arcjepa-engine',
    name: 'arc-jepa Engine',
    emoji: '🧠',
    kind: 'engine',
    description: 'The real symbolic solver from acco-cyber/ARC-AGI-2: induction → DSL beam search → repair → A* → evolution.',
    provenance: 'Vendored from your ARC-AGI-2 repository (torch made optional). CPU-only, deterministic given a seed.',
    slow: true,
  },
  '/api/agent/arcjepa',
);

const apexAgent = serverAgent(
  {
    id: 'apex-synthesizer',
    name: 'APEX-style Synthesizer',
    emoji: '⚡',
    kind: 'llm',
    description: 'Replicates your Phase-B methodology: the LLM writes programs, every program must reproduce ALL examples, with repair rounds and a direct-grid fallback.',
    provenance: 'Methodology port of arc2-apex2-hybrid-final (verified program synthesis).',
    slow: true,
  },
  '/api/agent/apex',
);

const directAgent = serverAgent(
  {
    id: 'glm-direct',
    name: 'LLM Direct Reasoner',
    emoji: '💬',
    kind: 'llm',
    description: 'Sends the examples to the LLM and asks for the answer grid directly. Two samples for pass@2.',
    provenance: 'Network-dependent; may fail to parse; copy-input fallback.',
    slow: true,
  },
  '/api/agent/direct',
);

// ---------------------------------------------------------------------------
// custom agents
// ---------------------------------------------------------------------------

const WORKER_SRC = `
self.onmessage = function (e) {
  const { code, train, testInputs } = e.data;
  const results = [];
  const logs = [];
  try {
    const H = {
      dims: (g) => ({ h: g.length, w: g[0] ? g[0].length : 0 }),
      clone: (g) => g.map((r) => r.slice()),
      make: (h, w, fill) => Array.from({ length: h }, () => Array(w).fill(fill || 0)),
      rot90: (g) => { const h = g.length, w = g[0].length; const out = Array.from({ length: w }, () => Array(h).fill(0)); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[c][h - 1 - r] = g[r][c]; return out; },
      rot180: (g) => g.map((r) => r.slice().reverse()).reverse(),
      rot270: (g) => { const h = g.length, w = g[0].length; const out = Array.from({ length: w }, () => Array(h).fill(0)); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[w - 1 - c][r] = g[r][c]; return out; },
      flipH: (g) => g.map((r) => r.slice().reverse()),
      flipV: (g) => g.slice().reverse(),
      transpose: (g) => g[0].map((_, c) => g.map((r) => r[c])),
      recolor: (g, map) => g.map((r) => r.map((c) => (map[c] === undefined ? c : map[c]))),
      shift: (g, dr, dc) => { const h = g.length, w = g[0].length; const out = Array.from({ length: h }, () => Array(w).fill(0)); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < h && nc >= 0 && nc < w) out[nr][nc] = g[r][c]; } return out; },
      log: (...a) => { logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); },
    };
    // Extract the body if the user pasted a full function declaration.
    let body = code;
    const declMatch = code.match(/^\s*(?:async\s+)?function\s*[A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/);
    if (declMatch) {
      const open = code.indexOf('{', declMatch[0].length - 1);
      let depth = 0;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (depth === 0) { body = code.slice(open + 1, i); break; } }
      }
    }
    // factory can be used two ways:
    //  A) the code IS the body of solve(train, testInput) → call with real args
    //  B) the code RETURNS its own solver function → detect via a zero-arg probe
    const factory = new Function('train', 'testInput', 'H', '"use strict";\\n' + body);
    let solve;
    try {
      const maybe = factory(undefined, undefined, H);
      if (typeof maybe === 'function') {
        solve = maybe;
      } else {
        solve = (t, i) => factory(t, i, H);
      }
    } catch (probeErr) {
      solve = (t, i) => factory(t, i, H);
    }
    if (typeof solve !== 'function') throw new Error('Could not resolve a solver: return a grid (body style) or a function.');
    for (const testInput of testInputs) {
      const out = solve.call(H, train, testInput);
      results.push(out);
    }
    self.postMessage({ ok: true, results, logs });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err), logs });
  }
};
`;

function runCustomJs(code: string, train: Pair[], testInputs: Grid[], timeoutMs = 5000): Promise<{ ok: boolean; results?: unknown[]; error?: string; logs?: string[] }> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (err) {
      resolve({ ok: false, error: `worker-unavailable: ${String(err)}` });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: `Timed out after ${timeoutMs} ms (infinite loop or very slow code).` });
    }, timeoutMs);
    worker.onmessage = (ev: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(ev.data as { ok: boolean; results?: unknown[]; error?: string; logs?: string[] });
    };
    worker.onerror = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: ev.message || 'worker-error' });
    };
    worker.postMessage({ code, train, testInputs });
  });
}

function isValidGridShaped(g: unknown): g is Grid {
  if (!Array.isArray(g) || g.length === 0) return false;
  const w = (g[0] as unknown[])?.length;
  if (typeof w !== 'number' || w === 0) return false;
  return g.every((row) => Array.isArray(row) && row.length === w && row.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 9));
}

const customJsAgent: AgentDef = {
  id: 'custom-js',
  name: 'My Agent (JavaScript)',
  emoji: '🧑‍💻',
  kind: 'custom',
  description: 'Paste your own solver as a JS function body: solve(train, testInput) → grid. Runs sandboxed in a Web Worker; auto-verified on every example.',
  provenance: 'Runs locally in your browser. Helpers: H.rot90/flipH/recolor/shift…, plus train/testInput.',
  needsConfig: true,
  async run({ train, testInputs, config }) {
    const t0 = Date.now();
    const steps = observeSteps(train, testInputs);
    const code = String(config?.code ?? '').trim();
    if (!code) return emptyResult('custom-js', t0, 'Paste your solver code first (define a function returning the output grid).', steps);

    steps.push({ kind: 'think', label: 'Running your solver on the examples first (auto-verification)…' });
    const selfTest = await runCustomJs(code, train, train.map((p) => p.input), 5000);
    if (!selfTest.ok) {
      steps.push({ kind: 'verify', label: 'Your code failed on the examples', detail: selfTest.error, ok: false });
      return { ...emptyResult('custom-js', t0, selfTest.error ?? 'custom-code-error', steps), note: (selfTest.logs ?? []).join('\n') || undefined };
    }
    let fitCount = 0;
    train.forEach((p, i) => {
      const got = selfTest.results?.[i];
      const okFit = p.output && isValidGridShaped(got) && gridsEqual(got as Grid, p.output);
      if (okFit) fitCount++;
      steps.push({
        kind: 'verify',
        label: `Example ${i + 1}: ${okFit ? 'reproduced ✔' : 'mismatch ✘'}`,
        ok: !!okFit,
      });
    });
    if (fitCount === train.length) {
      steps.push({ kind: 'verify', label: `Your solver reproduces all ${train.length} examples ✔`, ok: true });
    } else {
      steps.push({ kind: 'verify', label: `${fitCount}/${train.length} examples reproduced — running on the test input anyway`, ok: false });
    }

    const run = await runCustomJs(code, train, testInputs, 8000);
    if (!run.ok) {
      steps.push({ kind: 'act', label: 'Test-input run failed', detail: run.error, ok: false });
      return { ...emptyResult('custom-js', t0, run.error ?? 'custom-code-error', steps), note: (run.logs ?? []).join('\n') || undefined };
    }
    const attempts: Grid[][] = [];
    for (const r of run.results ?? []) {
      if (isValidGridShaped(r)) attempts.push([r as Grid]);
      else attempts.push([testInputs[attempts.length].map((row) => [...row])]);
    }
    if ((run.logs ?? []).length > 0) {
      steps.push({ kind: 'act', label: 'Solver log', detail: run.logs!.slice(0, 8).join('\n') });
    }
    steps.push({ kind: 'act', label: `Produced ${attempts.length} prediction${attempts.length === 1 ? '' : 's'}` });
    return {
      ok: true,
      attempts,
      steps,
      program: code.slice(0, 400),
      elapsedMs: Date.now() - t0,
      engine: 'custom (browser worker)',
      note: fitCount === train.length ? 'All examples reproduced.' : `${fitCount}/${train.length} examples reproduced.`,
    };
  },
};

const endpointAgent: AgentDef = {
  id: 'custom-endpoint',
  name: 'My Agent (HTTP endpoint)',
  emoji: '🌐',
  kind: 'custom',
  description: 'Point ARC Lab at your own solver service. It receives {train, testInputs} JSON and returns {attempts: [[grid…]]} (or {prediction: grid}).',
  provenance: 'Bring your own backend — e.g. your ARC-AGI-2 vLLM server wrapped in a tiny HTTP shim.',
  needsConfig: true,
  slow: true,
  async run({ train, testInputs, config }) {
    const t0 = Date.now();
    const steps = observeSteps(train, testInputs);
    const url = String(config?.endpoint ?? '').trim();
    if (!url) return emptyResult('custom-endpoint', t0, 'Provide your agent endpoint URL first.', steps);
    try {
      const data = await postAgent<Record<string, unknown>>(url, { train, testInputs }, 90_000);
      let attempts: Grid[][] = [];
      if (Array.isArray(data.attempts)) {
        attempts = (data.attempts as unknown[][]).map((pair) => (Array.isArray(pair) ? (pair.filter(isValidGridShaped) as Grid[]) : []));
      } else if (data.prediction && isValidGridShaped(data.prediction)) {
        attempts = testInputs.map(() => [data.prediction as Grid]);
      } else if (Array.isArray(data) ) {
        attempts = (data as unknown[]).filter(isValidGridShaped).map((g) => [g as Grid]);
      }
      if (attempts.length === 0) return emptyResult('custom-endpoint', t0, 'Endpoint replied but no valid grid found (expect {attempts:[[grid]]} or {prediction:grid}).', steps);
      steps.push({ kind: 'think', label: 'Endpoint replied with a valid prediction' });
      steps.push({ kind: 'act', label: `Received ${attempts.length} candidate set${attempts.length === 1 ? '' : 's'}` });
      while (attempts.length < testInputs.length) attempts.push([]);
      return { ok: true, attempts, steps, elapsedMs: Date.now() - t0, engine: url };
    } catch (err) {
      return emptyResult('custom-endpoint', t0, err instanceof Error ? err.message : 'endpoint-error', steps);
    }
  },
};

// ---------------------------------------------------------------------------

export const AGENTS: AgentDef[] = [
  copyBot,
  ruleSniffer,
  programSearcher,
  arcjepaAgent,
  apexAgent,
  directAgent,
  customJsAgent,
  endpointAgent,
];

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

export interface AgentScoreEntry {
  taskId: string;
  agentId: string;
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  elapsedMs: number;
  at: string;
}

const SCORE_KEY = 'arc-lab-agent-scores-v1';

export function loadAgentScores(): AgentScoreEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(SCORE_KEY) ?? '[]') as AgentScoreEntry[];
  } catch {
    return [];
  }
}

export function saveAgentScore(entry: AgentScoreEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const all = loadAgentScores();
    all.push(entry);
    window.localStorage.setItem(SCORE_KEY, JSON.stringify(all.slice(-500)));
  } catch {
    /* storage full — ignore */
  }
}
