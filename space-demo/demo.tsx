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

type Tab = 'play' | 'search' | 'arena' | 'about';

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
          {(['play', 'search', 'arena', 'about'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'navlink active' : 'navlink'} onClick={() => setTab(t)}>
              {t === 'play' ? 'Academy' : t === 'search' ? 'Workbench' : t === 'arena' ? 'Arena' : 'About'}
            </button>
          ))}
        </nav>
        <div className="xp">⚡ {xp} XP</div>
      </header>
      <main>
        {tab === 'play' && <PlayTab xp={xp} setXp={setXp} solved={solved} setSolved={setSolved} />}
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
