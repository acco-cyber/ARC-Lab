/**
 * ARC Lab — static client-side demo (HuggingFace Space).
 * Bundled with the REAL arc core (src/lib/arc/**) — same generators, DSL,
 * search and solver logic as the full app, but running fully in the browser.
 * Progress is kept in localStorage. This is a demo: the full experience
 * (server-side answer hiding, arena persistence, LLM adapter) lives in the
 * GitHub repository.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  LEVELS,
  WORLDS,
  generateLevel,
  dailyLevelForDate,
  todayKey,
  type LevelDef,
} from '../src/lib/arc/curriculum';
import { colorHex, colorName, patternFor } from '../src/lib/arc/colors';
import { gridsEqual, makeGrid, diffGrids, colorHistogram } from '../src/lib/arc/grid';
import * as T from '../src/lib/arc/transforms';
import { GEO_OPS } from '../src/lib/arc/transforms';
import { findObjects, keepObjects, largestObject, gravityDown } from '../src/lib/arc/objects';
import { searchPrograms, applyProgram, describeProgram, type Program } from '../src/lib/arc/dsl';
import { exactMatch, pixelAccuracy } from '../src/lib/arc/metrics';
import type { Grid, Pair } from '../src/lib/arc/types';

// ---------------------------------------------------------------------------
// tiny solver registry (client-safe subset of solvers.ts)
// ---------------------------------------------------------------------------

function ruleBased(train: Array<{ input: Grid; output: Grid }>, testInput: Grid): Grid {
  for (const op of GEO_OPS) {
    if (train.every((p) => gridsEqual(op.fn(p.input), p.output))) return op.fn(testInput);
  }
  const colors = new Set<number>();
  for (const p of train) {
    for (const row of p.input) for (const c of row) colors.add(c);
    for (const row of p.output) for (const c of row) colors.add(c);
  }
  for (const a of colors) {
    for (const b of colors) {
      if (a === b) continue;
      if (train.every((p) => gridsEqual(T.recolor(p.input, { [a]: b }), p.output))) {
        return T.recolor(testInput, { [a]: b });
      }
    }
  }
  const largestFits = train.every((p) => {
    const det = findObjects(p.input);
    if (det.objects.length === 0) return false;
    return gridsEqual(keepObjects(p.input, [largestObject(det.objects)]), p.output);
  });
  if (largestFits) {
    const det = findObjects(testInput);
    if (det.objects.length > 0) return keepObjects(testInput, [largestObject(det.objects)]);
  }
  return testInput.map((r) => [...r]);
}

function majorityFill(train: Array<{ input: Grid; output: Grid }>): Grid {
  const shapes = new Map<string, number>();
  for (const p of train) {
    const key = `${p.output.length}x${p.output[0].length}`;
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, n] of shapes) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  const [h, w] = best.split('x').map(Number);
  const ref = train.find((p) => p.output.length === h && p.output[0].length === w)!.output;
  const hist = colorHistogram(ref);
  let color = 0;
  let maxN = -1;
  for (const [c, n] of hist) {
    if (c !== 0 && n > maxN) {
      color = c;
      maxN = n;
    }
  }
  return makeGrid(h, w, color);
}

function nearestTrain(train: Array<{ input: Grid; output: Grid }>, testInput: Grid): Grid {
  let bestP = train[0];
  let bestD = Infinity;
  for (const p of train) {
    const d = diffGrids(p.input, testInput);
    const dist = d.shapeEqual ? d.diffCells : 999;
    if (dist < bestD) {
      bestD = dist;
      bestP = p;
    }
  }
  return bestP.output;
}

function programSearchSolve(train: Array<{ input: Grid; output: Grid }>, testInput: Grid): Grid {
  const cands = searchPrograms(train as Pair[], { maxOps: 2, timeBudgetMs: 2000, topK: 2 });
  if (cands.length === 0) return testInput.map((r) => [...r]);
  const pred = applyProgram(testInput, cands[0].program);
  return pred ?? testInput.map((r) => [...r]);
}

// ---------------------------------------------------------------------------
// localStorage XP
// ---------------------------------------------------------------------------

const XP_KEY = 'arc-lab-demo-xp';
const SOLVED_KEY = 'arc-lab-demo-solved';
function loadXp(): number {
  return Number(localStorage.getItem(XP_KEY) ?? 0);
}
function addXp(n: number): number {
  const xp = loadXp() + n;
  localStorage.setItem(XP_KEY, String(xp));
  return xp;
}
function loadSolved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function markSolved(id: string): string[] {
  const s = [...new Set([...loadSolved(), id])];
  localStorage.setItem(SOLVED_KEY, JSON.stringify(s));
  return s;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

type Tab = 'play' | 'agents' | 'search' | 'arena' | 'about';

function GridBox({ grid, cell = 16, highlight = [], onCell, title }: {
  grid: Grid;
  cell?: number;
  highlight?: Array<[number, number]>;
  onCell?: (r: number, c: number) => void;
  title?: string;
}) {
  const hi = new Set(highlight.map(([r, c]) => `${r}:${c}`));
  return (
    <div>
      {title && <div className="mini-label">{title}</div>}
      <div className="arcgrid" style={{ gridTemplateColumns: `repeat(${grid[0]?.length ?? 0}, ${cell}px)` }}>
        {grid.map((row, r) =>
          row.map((c, ci) => {
            const isHi = hi.has(`${r}:${ci}`);
            return (
              <div
                key={`${r}-${ci}`}
                className={onCell ? 'cell clickable' : 'cell'}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: colorHex(c),
                  backgroundImage: patternFor(c) || undefined,
                  backgroundSize: '8px 8px',
                  outline: isHi ? '2px solid #10b981' : undefined,
                  outlineOffset: -1,
                }}
                onPointerDown={onCell ? () => onCell(r, ci) : undefined}
                onPointerEnter={onCell ? (e) => { if (e.buttons === 1) onCell(r, ci); } : undefined}
                title={`r${r + 1}c${ci + 1} ${colorName(c)}`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

function PairCard({ pair, idx }: { pair: { input: Grid; output: Grid }; idx: number }) {
  return (
    <div className="pair">
      <span className="pair-num">{idx + 1}</span>
      <GridBox grid={pair.input} title="Input" />
      <span className="arrow">→</span>
      <GridBox grid={pair.output} title="Output" />
    </div>
  );
}

function App() {
  const [tab, setTab] = React.useState<Tab>('play');
  const [xp, setXp] = React.useState(0);
  const [solved, setSolved] = React.useState<string[]>([]);
  React.useEffect(() => {
    setXp(loadXp());
    setSolved(loadSolved());
  }, []);

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <div className="logo">
            <span style={{ background: '#FF4136' }} /><span style={{ background: '#2ECC40' }} />
            <span style={{ background: '#FFDC00' }} /><span style={{ background: '#F012BE' }} />
          </div>
          <div>
            <strong>ARC Lab</strong>
            <span className="tagline"> · static demo</span>
          </div>
        </div>
        <nav>
          {(['play', 'agents', 'search', 'arena', 'about'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'navlink active' : 'navlink'} onClick={() => setTab(t)}>
              {t === 'play' ? 'Academy' : t === 'agents' ? 'Agent Lab' : t === 'search' ? 'Workbench' : t === 'arena' ? 'Arena' : 'About'}
            </button>
          ))}
        </nav>
        <div className="xp">⚡ {xp} XP</div>
      </header>
      <main>
        {tab === 'play' && <PlayTab xp={xp} setXp={setXp} solved={solved} setSolved={setSolved} />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'search' && <SearchTab />}
        {tab === 'arena' && <ArenaTab />}
        {tab === 'about' && <AboutTab />}
      </main>
      <footer className="foot">
        Static client-side demo powered by the real <code>arc-core</code>. Full app (server-validated answers, arena persistence, LLM adapter) on{' '}
        <a href="https://github.com/acco-cyber/ARC-Lab" target="_blank" rel="noreferrer">GitHub</a>.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Lab tab — watch AI agents play the game
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
    let body = code;
    const declMatch = code.match(/^\\s*(?:async\\s+)?function\\s*[A-Za-z0-9_$]*\\s*\\([^)]*\\)\\s*\\{/);
    if (declMatch) {
      const open = code.indexOf('{', declMatch[0].length - 1);
      let depth = 0;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (depth === 0) { body = code.slice(open + 1, i); break; } }
      }
    }
    const factory = new Function('train', 'testInput', 'H', '"use strict";' + body);
    let solve;
    try {
      const maybe = factory(undefined, undefined, H);
      if (typeof maybe === 'function') solve = maybe;
      else solve = (t, i) => factory(t, i, H);
    } catch (probeErr) {
      solve = (t, i) => factory(t, i, H);
    }
    for (const testInput of testInputs) results.push(solve.call(H, train, testInput));
    self.postMessage({ ok: true, results, logs });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err), logs });
  }
};
`;

function runCustomWorker(code: string, train: Array<{ input: Grid; output: Grid }>, testInputs: Grid[], timeoutMs = 5000): Promise<{ ok: boolean; results?: unknown[]; error?: string; logs?: string[] }> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (err) {
      resolve({ ok: false, error: 'worker-unavailable: ' + String(err) });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: 'Timed out after ' + timeoutMs + ' ms (infinite loop?).' });
    }, timeoutMs);
    worker.onmessage = (ev: MessageEvent) => { clearTimeout(timer); worker.terminate(); resolve(ev.data); };
    worker.onerror = (ev) => { clearTimeout(timer); worker.terminate(); resolve({ ok: false, error: ev.message || 'worker-error' }); };
    worker.postMessage({ code, train, testInputs });
  });
}

const AGENT_DEFS = [
  { id: 'copy-bot', name: 'Copy Bot', emoji: '🪞', desc: 'Echoes the input back — the sanity agent.' },
  { id: 'rule-sniffer', name: 'Rule Sniffer', emoji: '🔍', desc: 'Single geometric ops → recolors → keep-largest.' },
  { id: 'program-searcher', name: 'Program Searcher', emoji: '🧩', desc: 'Bounded DSL program search (depth ≤ 2).' },
  { id: 'custom-js', name: 'My Agent (JS)', emoji: '🧑‍💻', desc: 'Your own solver, sandboxed + auto-verified.' },
] as const;

type AgentStep = { kind: 'observe' | 'think' | 'verify' | 'act'; label: string; ok?: boolean };

function AgentsTab() {
  const [agentId, setAgentId] = React.useState<string>('rule-sniffer');
  const [world, setWorld] = React.useState(1);
  const [levelN, setLevelN] = React.useState(1);
  const [customCode, setCustomCode] = React.useState('return testInput.map(r => r.slice());');
  const [phase, setPhase] = React.useState<'idle' | 'running' | 'playing' | 'painting' | 'scored'>('idle');
  const [steps, setSteps] = React.useState<AgentStep[]>([]);
  const [visible, setVisible] = React.useState(0);
  const [paintGrid, setPaintGrid] = React.useState<Grid | null>(null);
  const [current, setCurrent] = React.useState<[number, number] | undefined>(undefined);
  const [score, setScore] = React.useState<{ exact: boolean; pixel: number; ms: number; program: string } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const interval = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const levelId = 'w' + world + 'l' + levelN;
  const draft = React.useMemo(() => {
    try { return generateLevel(levelId); } catch { return generateLevel('w1l1'); }
  }, [levelId]);

  React.useEffect(() => () => { timers.current.forEach(clearTimeout); if (interval.current) clearInterval(interval.current); }, []);
  React.useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = [];
    if (interval.current) { clearInterval(interval.current); interval.current = null; }
    setPhase('idle'); setSteps([]); setVisible(0); setPaintGrid(null); setScore(null); setErrorMsg(null); setCurrent(undefined);
  }, [levelId, agentId]);

  const finishScore = (pred: Grid, ms: number, program: string) => {
    const d = diffGrids(pred, draft.testOutput);
    const pixel = d.shapeEqual ? 1 - d.diffCells / Math.max(1, d.totalCells) : 0;
    setScore({ exact: d.shapeEqual && d.diffCells === 0, pixel, ms, program });
    setPhase('scored');
  };

  const run = async () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    if (interval.current) { clearInterval(interval.current); interval.current = null; }
    setPhase('running'); setSteps([]); setVisible(0); setPaintGrid(null); setScore(null); setErrorMsg(null);
    const train = draft.train;
    const testInput = draft.testInput;
    const t0 = performance.now();
    const localSteps: AgentStep[] = [];
    const push = (s: AgentStep) => { localSteps.push(s); setSteps((prev) => [...prev, s]); };

    push({ kind: 'observe', label: 'Studied ' + train.length + ' example pairs (' + testInput.length + '×' + testInput[0].length + ' test input).' });

    let pred: Grid | null = null;
    let program = '';
    try {
      if (agentId === 'copy-bot') {
        push({ kind: 'think', label: 'Hypothesis: output = input.' });
        pred = testInput.map((r) => [...r]);
        program = 'IDENTITY';
      } else if (agentId === 'rule-sniffer') {
        push({ kind: 'think', label: 'Trying single geometric ops…' });
        let found: Grid | null = null;
        for (const op of GEO_OPS) {
          if (train.every((p) => gridsEqual(op.fn(p.input), p.output))) {
            push({ kind: 'verify', label: 'Rule consistent on all examples: ' + op.label, ok: true });
            found = op.fn(testInput);
            program = op.label;
            break;
          }
        }
        if (!found) {
          push({ kind: 'think', label: 'No geometric op fits — trying recolors…' });
          const colors = new Set<number>();
          for (const p of train) { for (const row of p.input) for (const c of row) colors.add(c); for (const row of p.output) for (const c of row) colors.add(c); }
          for (const a of colors) {
            for (const b of colors) {
              if (a === b) continue;
              if (train.every((p) => gridsEqual(T.recolor(p.input, { [a]: b }), p.output))) {
                push({ kind: 'verify', label: 'Recolor ' + a + ' → ' + b + ' fits all examples.', ok: true });
                found = T.recolor(testInput, { [a]: b });
                program = 'RECOLOR ' + a + '→' + b;
                break;
              }
            }
            if (found) break;
          }
        }
        if (!found) {
          push({ kind: 'think', label: 'Trying object heuristic: keep largest…' });
          const fits = train.every((p) => {
            const det = findObjects(p.input);
            if (det.objects.length === 0) return false;
            return gridsEqual(keepObjects(p.input, [largestObject(det.objects)]), p.output);
          });
          if (fits) {
            push({ kind: 'verify', label: 'Keep-largest fits all examples.', ok: true });
            found = keepObjects(testInput, [largestObject(findObjects(testInput).objects)]);
            program = 'KEEP_LARGEST';
          }
        }
        if (!found) { push({ kind: 'verify', label: 'No consistent rule — copy-input fallback.', ok: false }); found = testInput.map((r) => [...r]); }
        pred = found;
      } else if (agentId === 'program-searcher') {
        push({ kind: 'think', label: 'Enumerating DSL programs (depth ≤ 2, 2s budget)…' });
        const cands = searchPrograms(train as Pair[], { maxOps: 2, timeBudgetMs: 2000, topK: 2 });
        if (cands.length === 0) {
          push({ kind: 'verify', label: 'No consistent program within budget.', ok: false });
          pred = testInput.map((r) => [...r]);
        } else {
          const best = cands[0];
          program = describeProgram(best.program);
          push({ kind: 'think', label: 'Best program: ' + program });
          push({ kind: 'verify', label: 'Program applied to the test input.', ok: true });
          pred = applyProgram(testInput, best.program) ?? testInput.map((r) => [...r]);
        }
      } else {
        // custom-js
        push({ kind: 'think', label: 'Running your solver on the examples (auto-verification)…' });
        const selfTest = await runCustomWorker(customCode, train, train.map((p) => p.input));
        if (!selfTest.ok) {
          push({ kind: 'verify', label: 'Your code failed on the examples.', ok: false });
          setErrorMsg(selfTest.error ?? 'custom code error');
          setPhase('scored');
          return;
        }
        let fit = 0;
        train.forEach((p, i) => {
          const got = selfTest.results?.[i];
          const okFit = Array.isArray(got) && gridsEqual(got as Grid, p.output);
          if (okFit) fit++;
          push({ kind: 'verify', label: 'Example ' + (i + 1) + ': ' + (okFit ? 'reproduced ✔' : 'mismatch ✘'), ok: okFit });
        });
        const run2 = await runCustomWorker(customCode, train, [testInput], 8000);
        if (!run2.ok) { push({ kind: 'act', label: 'Test-input run failed.', ok: false }); setErrorMsg(run2.error ?? 'custom code error'); setPhase('scored'); return; }
        const got = run2.results?.[0];
        if (!Array.isArray(got)) { push({ kind: 'act', label: 'Solver did not return a grid.', ok: false }); setErrorMsg('Not a valid grid.'); setPhase('scored'); return; }
        push({ kind: 'act', label: fit === train.length ? 'All ' + fit + ' examples reproduced — applying to test input.' : fit + '/' + train.length + ' examples reproduced — applying anyway.', ok: fit === train.length });
        pred = got as Grid;
      }
    } catch (err) {
      setErrorMsg(String(err instanceof Error ? err.message : err));
      setPhase('scored');
      return;
    }

    const ms = Math.round(performance.now() - t0);
    // animate steps then paint (use the locally tracked steps — state is async)
    const shown = localSteps.length;
    for (let i = 1; i <= shown + 2; i++) timers.current.push(setTimeout(() => setVisible(i), i * 500));
    timers.current.push(setTimeout(() => {
      if (!pred) { finishScore(testInput, ms, program); return; }
      const changes: Array<[number, number]> = [];
      const draws: Array<[number, number]> = [];
      const clears: Array<[number, number]> = [];
      for (let r = 0; r < pred.length; r++) for (let c = 0; c < (pred[r]?.length ?? 0); c++) {
        const inB = r < testInput.length && c < (testInput[r]?.length ?? 0);
        if (!inB || testInput[r][c] !== pred[r][c]) { if (pred[r][c] !== 0) changes.push([r, c]); else clears.push([r, c]); }
        else if (pred[r][c] !== 0) draws.push([r, c]);
      }
      const order = [...changes, ...draws, ...clears];
      const working: Grid = testInput.map((row) => [...row]);
      setPaintGrid(working.map((r) => [...r]));
      setPhase('painting');
      let i = 0;
      const per = Math.max(1, Math.round(order.length / 80));
      interval.current = setInterval(() => {
        const next = Math.min(i + per, order.length);
        for (let k = i; k < next; k++) { const [r, c] = order[k]; if (working[r] && c < working[r].length) working[r][c] = pred[r][c]; }
        i = next;
        setPaintGrid(working.map((r) => [...r]));
        const last = order[Math.max(0, i - 1)];
        setCurrent(last ? [last[0], last[1]] : undefined);
        if (i >= order.length) {
          if (interval.current) clearInterval(interval.current);
          interval.current = null;
          setCurrent(undefined);
          finishScore(pred, ms, program);
        }
      }, 22);
    }, (shown + 2) * 500 + 200));
  };

  const agent = AGENT_DEFS.find((a) => a.id === agentId)!;
  const shownSteps = steps.slice(0, phase === 'scored' ? undefined : visible);
  const mismatch: Array<[number, number]> = React.useMemo(() => {
    if (!score || !paintGrid) return [];
    const cells: Array<[number, number]> = [];
    for (let r = 0; r < draft.testOutput.length; r++) for (let c = 0; c < draft.testOutput[r].length; c++) if (paintGrid[r]?.[c] !== draft.testOutput[r][c]) cells.push([r, c]);
    return cells;
  }, [score, paintGrid, draft]);

  return (
    <div className="play">
      <section className="panel">
        <div className="levelhead">
          <h2>🤖 Agent Lab <span className="badge">watch agents play</span></h2>
        </div>
        <p className="muted small">
          Pick a puzzle and an agent, then watch it reason step by step and paint its answer. Bring your own agent as JavaScript — it runs sandboxed and is
          auto-verified against every example. Agents never see the expected output before predicting. (The full app also runs the real
          acco-cyber/ARC-AGI-2 engine and LLM synthesizers server-side.)
        </p>
      </section>
      <div className="content">
        <aside className="side">
          <div className="side-block">
            <div className="mini-label">1 · Choose an agent</div>
            <div className="chips">
              {AGENT_DEFS.map((a) => (
                <button key={a.id} className={agentId === a.id ? 'chip wide on' : 'chip wide'} onClick={() => setAgentId(a.id)}>
                  {a.emoji} {a.name}
                </button>
              ))}
            </div>
            <p className="muted small">{agent.desc}</p>
            {agentId === 'custom-js' && (
              <div className="field">
                <div className="mini-label">Your solver — function body</div>
                <textarea className="mono" rows={6} value={customCode} onChange={(e) => setCustomCode(e.target.value)} spellCheck={false} />
                <p className="muted small">Body of <code>solve(train, testInput)</code>. Helpers: <code>H.rot90/flipH/recolor/shift…</code></p>
              </div>
            )}
          </div>
          <div className="side-block">
            <div className="mini-label">2 · Choose a puzzle</div>
            <select className="select" value={world} onChange={(e) => { setWorld(Number(e.target.value)); setLevelN(1); }}>
              {WORLDS.map((w) => <option key={w.id} value={w.id}>{String(w.id).padStart(2, '0')} · {w.name}</option>)}
            </select>
            <div className="lvlist" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} className={n === levelN ? 'chip on' : 'chip'} onClick={() => setLevelN(n)}>{n}</button>
              ))}
            </div>
          </div>
          <button className="btn primary wide" onClick={run} disabled={phase === 'running' || phase === 'playing' || phase === 'painting'}>
            ▶ Run agent
          </button>
        </aside>
        <div className="content">
          <section className="panel">
            <div className="tracectl"><strong>Agent trace</strong><span className="muted small">{phase === 'idle' ? 'ready' : phase}</span></div>
            <div className="hints">
              {phase === 'idle' && <p className="muted">Press “Run agent”.</p>}
              {shownSteps.map((s, i) => (
                <div key={i} className="small" style={{ color: s.ok === false ? '#ef4444' : undefined }}>
                  {s.ok === true ? '✔ ' : s.ok === false ? '✘ ' : '· '}{s.label}
                </div>
              ))}
              {errorMsg && <div className="small" style={{ color: '#ef4444' }}>Error: {errorMsg}</div>}
            </div>
          </section>
          <section className="panel">
            <div className="tracectl"><strong>The play field</strong></div>
            <div className="pairs">
              <div className="pair">
                <GridBox grid={draft.testInput} title="Test input" />
                <span className="arrow">→</span>
                {paintGrid ? (
                  <GridBox grid={paintGrid} title="Agent prediction" highlight={phase === 'painting' && current ? [current] : mismatch} />
                ) : (
                  <div className="muted small" style={{ alignSelf: 'center', padding: '0 24px' }}>not run yet</div>
                )}
              </div>
            </div>
            {score && (
              <div className="result" style={{ borderColor: score.exact ? '#10b981' : undefined }}>
                {score.exact ? '✅ Solved — exact match' : '❌ Not solved'} · pixel accuracy {(score.pixel * 100).toFixed(1)}% · agent time {(score.ms / 1000).toFixed(2)}s
                {score.program && <span className="mono"> · {score.program.slice(0, 60)}</span>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Play tab
// ---------------------------------------------------------------------------

function PlayTab({ xp, setXp, solved, setSolved }: { xp: number; setXp: (n: number) => void; solved: string[]; setSolved: (s: string[]) => void }) {
  const daily = React.useMemo(() => dailyLevelForDate(todayKey()), []);
  const [selectedId, setSelectedId] = React.useState<string>(daily.id);
  const [world, setWorld] = React.useState<number>(1);

  const isDaily = selectedId.startsWith('daily-');
  const def: LevelDef | undefined = isDaily ? undefined : LEVELS.find((l) => l.id === selectedId);
  const draft = React.useMemo(() => {
    if (isDaily) return daily.draft;
    try {
      return generateLevel(selectedId);
    } catch {
      return generateLevel('w1l1');
    }
  }, [selectedId, isDaily, daily]);

  const [answer, setAnswer] = React.useState<Grid>(() => makeGrid(draft.testInput.length, draft.testInput[0].length, 0));
  const [color, setColor] = React.useState(1);
  const [hintTier, setHintTier] = React.useState(0);
  const [status, setStatus] = React.useState<'playing' | 'solved' | 'wrong'>('playing');
  const [expanded, setExpanded] = React.useState<number | null>(1);

  React.useEffect(() => {
    setAnswer(makeGrid(draft.testInput.length, draft.testInput[0].length, 0));
    setHintTier(0);
    setStatus(solved.includes(selectedId) ? 'solved' : 'playing');
  }, [draft, selectedId, solved]);

  const paint = (r: number, c: number) => {
    if (status === 'solved') return;
    setAnswer((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = color;
      return next;
    });
  };

  const submit = () => {
    if (gridsEqual(answer, draft.testOutput)) {
      if (!solved.includes(selectedId)) {
        const bonus = isDaily ? 150 : 100;
        setXp(addXp(bonus));
        setSolved(markSolved(selectedId));
      }
      setStatus('solved');
    } else {
      setStatus('wrong');
    }
  };

  const nextLevel = () => {
    if (isDaily) return;
    if (!def) return;
    const next = def.level < 10 ? `w${def.world}l${def.level + 1}` : def.world < 10 ? `w${def.world + 1}l1` : null;
    if (next) setSelectedId(next);
  };

  return (
    <div className="play">
      <aside className="side">
        <div className="side-block">
          <div className="mini-label">Today's challenge</div>
          <button
            className={selectedId === daily.id ? 'lvlbtn solved' : 'lvlbtn'}
            onClick={() => setSelectedId(daily.id)}
          >
            📅 Daily · {todayKey()} {solved.includes(daily.id) ? '✓' : ''}
          </button>
        </div>
        {WORLDS.map((w) => (
          <div key={w.id} className="side-block">
            <button className="worldhead" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
              <span className="wnum" style={{ background: colorHex([7, 3, 2, 4, 6, 1, 8, 5, 9, 0][w.id - 1]) }}>{w.id}</span>
              <span>
                {w.name}
                <small className="dcount">
                  {' '}
                  {w.id <= 2 ? '· open' : '· demo'}
                </small>
              </span>
            </button>
            {(expanded === w.id || w.id <= 1) && (
              <div className="lvlist">
                {LEVELS.filter((l) => l.world === w.id).map((l) => (
                  <button
                    key={l.id}
                    className={selectedId === l.id ? 'lvlbtn active' : solved.includes(l.id) ? 'lvlbtn solved' : 'lvlbtn'}
                    onClick={() => setSelectedId(l.id)}
                  >
                    <span className="mono">{l.id}</span> {l.title} {solved.includes(l.id) ? '✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </aside>

      <section className="content">
        <div className="levelhead">
          <h2>{isDaily ? `Daily Challenge — ${daily.template}` : `${def?.world}.${def?.level} ${def?.title}`}</h2>
          <span className="badge">{isDaily ? 'daily' : def?.worldDifficulty}</span>
        </div>
        <p className="muted">Study the examples, infer the rule, paint the output grid.</p>

        <div className="pairs">
          {draft.train.map((p, i) => (
            <PairCard key={i} pair={p} idx={i} />
          ))}
        </div>

        <div className="challenge">
          <div>
            <GridBox grid={draft.testInput} title="Test input" cell={20} />
          </div>
          <span className="arrow big">→</span>
          <div>
            <GridBox grid={answer} title="Your answer" cell={20} onCell={paint} />
            <div className="palette">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => (
                <button
                  key={c}
                  className={color === c ? 'swatch selected' : 'swatch'}
                  style={{ backgroundColor: colorHex(c), backgroundImage: patternFor(c) || undefined, backgroundSize: '8px 8px' }}
                  onClick={() => setColor(c)}
                  title={colorName(c)}
                />
              ))}
            </div>
            <div className="tools">
              <button className="btn" onClick={() => setAnswer(draft.testInput.map((r) => [...r]))}>Copy input</button>
              <button className="btn" onClick={() => setAnswer(makeGrid(draft.testInput.length, draft.testInput[0].length, 0))}>Clear</button>
              <button className="btn" onClick={() => setAnswer(makeGrid(draft.testInput.length, draft.testInput[0].length, color))}>Fill all</button>
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="btn primary" onClick={submit}>Submit</button>
          {hintTier < 3 && (
            <button className="btn" onClick={() => setHintTier(hintTier + 1)}>
              💡 Hint ({hintTier + 1}/3)
            </button>
          )}
          {status === 'solved' && !isDaily && (
            <button className="btn" onClick={nextLevel}>Next level →</button>
          )}
        </div>

        {hintTier > 0 && (
          <div className="hints">
            {draft.hints.slice(0, hintTier).map((h, i) => (
              <p key={i}><strong>Hint {i + 1}:</strong> {h}</p>
            ))}
          </div>
        )}

        {status === 'solved' && (
          <div className="result ok">
            <strong>Solved! ⚡</strong> {draft.explanation}
          </div>
        )}
        {status === 'wrong' && (
          <div className="result bad">Not quite — compare your grid with the examples cell by cell, or take a hint.</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search (workbench-lite) tab
// ---------------------------------------------------------------------------

function SearchTab() {
  const [levelId, setLevelId] = React.useState('w3l1');
  const draft = React.useMemo(() => {
    try {
      return generateLevel(levelId);
    } catch {
      return generateLevel('w3l1');
    }
  }, [levelId]);
  const [results, setResults] = React.useState<Array<{ program: Program; fitsAll: boolean; acc: number }> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [traceStep, setTraceStep] = React.useState(0);
  const [program, setProgram] = React.useState<Program | null>(null);

  const runSearch = () => {
    setBusy(true);
    setResults(null);
    setProgram(null);
    setTraceStep(0);
    setTimeout(() => {
      const cands = searchPrograms(draft.train as Pair[], { maxOps: 2, timeBudgetMs: 2500, topK: 5 });
      setResults(cands.map((c) => ({ program: c.program, fitsAll: c.fitsAll, acc: c.trainPixelAcc })));
      setBusy(false);
    }, 30);
  };

  const states = React.useMemo(() => {
    if (!program) return [];
    const out: Array<{ grid: Grid; desc: string }> = [{ grid: draft.testInput, desc: 'Input (test)' }];
    let cur = draft.testInput;
    program.forEach((op) => {
      const next = applyProgram(cur, [op]);
      if (next) {
        cur = next;
        out.push({ grid: cur, desc: describeProgram([op])[0] });
      }
    });
    return out;
  }, [program, draft]);

  return (
    <div className="content">
      <div className="row">
        <select value={levelId} onChange={(e) => { setLevelId(e.target.value); setResults(null); setProgram(null); }} className="select">
          {LEVELS.map((l) => (
            <option key={l.id} value={l.id}>{l.id} — {l.title}</option>
          ))}
        </select>
        <button className="btn primary" onClick={runSearch} disabled={busy}>
          {busy ? 'Searching… (≤2.5s)' : '🔍 Search programs'}
        </button>
      </div>
      <p className="muted">
        Bounded iterative-deepening search over the 20-op DSL, pruned on the first demonstration. Deterministic and blind to the test output.
      </p>

      <div className="pairs">
        {draft.train.map((p, i) => (
          <PairCard key={i} pair={p} idx={i} />
        ))}
      </div>

      {results && results.length > 0 && (
        <div className="panel">
          <h3>Candidates ({results.length})</h3>
          {results.map((r, i) => (
            <div key={i} className="cand">
              <span className={r.fitsAll ? 'pill ok' : 'pill'}>{r.fitsAll ? 'Fits all' : `${Math.round(r.acc * 100)}% pixels`}</span>
              <code>{describeProgram(r.program).join(' → ')}</code>
              <button className="btn" onClick={() => { setProgram(r.program); setTraceStep(0); }}>Trace on test</button>
            </div>
          ))}
          <p className="muted small">
            Fitting the demonstrations does not guarantee the intended rule — verify by applying to the held-out test input.
          </p>
        </div>
      )}
      {results && results.length === 0 && (
        <div className="panel">
          <p className="muted">No consistent program found within the bounded op space for this task (expected for object-motion and multi-step rules).</p>
        </div>
      )}

      {program && states.length > 0 && (
        <div className="panel">
          <h3>Execution trace — test input</h3>
          <div className="tracectl">
            {states.map((_, i) => (
              <button key={i} className={traceStep === i ? 'stepbtn active' : 'stepbtn'} onClick={() => setTraceStep(i)}>
                {i === 0 ? 'in' : i}
              </button>
            ))}
            <span className="muted small">{traceStep}/{states.length - 1}</span>
          </div>
          <p><strong>{states[traceStep].desc}</strong></p>
          <GridBox grid={states[traceStep].grid} cell={20} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arena tab
// ---------------------------------------------------------------------------

function ArenaTab() {
  const [worlds, setWorlds] = React.useState<number[]>([1, 2, 3]);
  const [count, setCount] = React.useState(6);
  const [solvers, setSolvers] = React.useState<string[]>(['copy-input', 'rule-based', 'program-search']);
  const [running, setRunning] = React.useState(false);
  const [table, setTable] = React.useState<Array<{ solver: string; solved: number; total: number; pass2: number; pixel: number; ms: number; failures: Record<string, number> }> | null>(null);

  const ALL = ['copy-input', 'majority-fill', 'nearest-train', 'rule-based', 'program-search'];
  const LABELS: Record<string, string> = {
    'copy-input': 'Copy-Input',
    'majority-fill': 'Majority Fill',
    'nearest-train': 'Nearest Train',
    'rule-based': 'Rule-Based',
    'program-search': 'Program Search',
  };

  const run = () => {
    setRunning(true);
    setTable(null);
    setTimeout(() => {
      const pool = LEVELS.filter((l) => worlds.length === 0 || worlds.includes(l.world));
      const step = Math.max(1, Math.floor(pool.length / count));
      const chosen: LevelDef[] = [];
      for (let i = 0; i < pool.length && chosen.length < count; i += step) chosen.push(pool[i]);
      const rows: typeof table = [];
      for (const sid of solvers) {
        let solvedN = 0;
        let pass2N = 0;
        let accSum = 0;
        let msSum = 0;
        const failures: Record<string, number> = {};
        for (const lv of chosen) {
          const d = generateLevel(lv.id);
          const t0 = performance.now();
          let preds: Grid[] = [];
          if (sid === 'copy-input') preds = [d.testInput.map((r) => [...r])];
          else if (sid === 'majority-fill') preds = [majorityFill(d.train)];
          else if (sid === 'nearest-train') preds = [nearestTrain(d.train, d.testInput)];
          else if (sid === 'rule-based') preds = [ruleBased(d.train, d.testInput)];
          else if (sid === 'program-search') {
            const cands = searchPrograms(d.train as Pair[], { maxOps: 2, timeBudgetMs: 2000, topK: 2 });
            preds = cands
              .map((c) => applyProgram(d.testInput, c.program))
              .filter((g): g is Grid => !!g)
              .slice(0, 2);
            if (preds.length === 0) preds = [d.testInput.map((r) => [...r])];
          }
          const ms = performance.now() - t0;
          msSum += ms;
          const e0 = exactMatch(preds[0], d.testOutput);
          const p2 = preds.some((p) => exactMatch(p, d.testOutput));
          if (e0) solvedN++;
          if (p2) pass2N++;
          accSum += pixelAccuracy(preds[0], d.testOutput);
          let fail = 'solved';
          if (!e0) {
            const dd = diffGrids(preds[0], d.testOutput);
            fail = !dd.shapeEqual ? 'shape' : 'cells';
          }
          failures[fail] = (failures[fail] ?? 0) + 1;
        }
        rows.push({
          solver: LABELS[sid],
          solved: solvedN,
          total: chosen.length,
          pass2: pass2N,
          pixel: accSum / chosen.length,
          ms: msSum / chosen.length,
          failures,
        });
      }
      setTable(rows);
      setRunning(false);
    }, 50);
  };

  return (
    <div className="content">
      <div className="row wraprow">
        <div className="field">
          <span className="mini-label">Worlds</span>
          <div className="chips">
            {WORLDS.map((w) => (
              <button
                key={w.id}
                className={worlds.includes(w.id) ? 'chip on' : 'chip'}
                onClick={() => setWorlds((prev) => (prev.includes(w.id) ? prev.filter((x) => x !== w.id) : [...prev, w.id]))}
              >
                {w.id}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="mini-label">Tasks</span>
          <input type="number" min={2} max={12} value={count} onChange={(e) => setCount(Math.max(2, Math.min(12, Number(e.target.value) || 6)))} className="select num" />
        </div>
        <div className="field">
          <span className="mini-label">Solvers</span>
          <div className="chips">
            {ALL.map((s) => (
              <button
                key={s}
                className={solvers.includes(s) ? 'chip wide on' : 'chip wide'}
                onClick={() => setSolvers((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
              >
                {LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary" onClick={run} disabled={running || solvers.length === 0}>
          {running ? 'Evaluating…' : '▶ Run evaluation'}
        </button>
      </div>
      <p className="muted">Solvers never see the expected outputs. Exact match is the primary metric; pixel accuracy is diagnostic.</p>

      {table && (
        <div className="panel">
          <table className="mtable">
            <thead>
              <tr>
                <th>Solver</th>
                <th>Exact</th>
                <th>Pass@2</th>
                <th>Pixel acc</th>
                <th>Avg ms</th>
                <th>Failures</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.solver}>
                  <td>{r.solver}</td>
                  <td className={r.solved === Math.max(...table.map((x) => x.solved)) ? 'best' : ''}>
                    {r.solved}/{r.total} ({Math.round((r.solved / r.total) * 100)}%)
                  </td>
                  <td>{r.pass2}/{r.total}</td>
                  <td>{Math.round(r.pixel * 100)}%</td>
                  <td>{r.ms.toFixed(1)}</td>
                  <td className="small">
                    {Object.entries(r.failures).map(([k, v]) => `${k === 'solved' ? '✓' : k} ${v}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AboutTab() {
  return (
    <div className="content about">
      <h2>ARC Lab</h2>
      <p>
        An interactive laboratory for the Abstraction and Reasoning Corpus with three integrated experiences:
      </p>
      <ul>
        <li><strong>ARC Academy</strong> — a 100-level puzzle game teaching real ARC skills (this demo's Academy tab runs the same deterministic generator core).</li>
        <li><strong>ARC Workbench</strong> — visual reasoning debugger with a 20-op DSL, consistency checking and bounded program search (the Search tab above is the real search code).</li>
        <li><strong>ARC Arena</strong> — reproducible solver evaluation with exact / pass@2 / pixel / runtime metrics and a failure taxonomy (the Arena tab runs the client-safe baselines).</li>
      </ul>
      <p>
        The full application adds server-side answer validation, persistent progress (SQLite), run history with reproducibility manifests, an LLM
        adapter and ARC JSON import/export.
      </p>
      <p>
        <a className="btn primary" href="https://github.com/acco-cyber/ARC-Lab" target="_blank" rel="noreferrer">GitHub repository →</a>
      </p>
      <p className="muted small">
        Dataset policy: the curriculum is fully original &amp; synthetic (arc-lab-curriculum-v1) and deterministic per seed. No official ARC
        evaluation tasks are redistributed. ARC-AGI-1/2 JSON imports are supported in the full app; schema is ARC-3 tolerant.
      </p>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
