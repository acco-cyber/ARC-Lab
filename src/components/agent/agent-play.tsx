'use client';

/**
 * ARC Lab — Agent Play view.
 *
 * Runs a selected agent on a puzzle and plays the solve back like a game
 * replay: the agent's step trace (observe → think → verify → act) animates in,
 * then the prediction is painted cell by cell, then it is scored against the
 * held-out answer (if the task has one).
 */

import React from 'react';
import { Bot, CheckCircle2, ChevronRight, Circle, Loader2, Play, SkipForward, XCircle } from 'lucide-react';
import type { Grid, Task } from '@/lib/arc/types';
import type { AgentDef, AgentRunResult } from '@/lib/arc/agents';
import { dims, diffGrids } from '@/lib/arc/grid';
import { GridView } from '@/components/arc/grid-view';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'running' | 'playing' | 'painting' | 'scored';

interface ScoreInfo {
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  shapeOk: boolean;
  diffCells: number;
}

interface AgentPlayProps {
  task: Task;
  agent: AgentDef;
  config: Record<string, unknown>;
  patterns: boolean;
  onScored?: (score: ScoreInfo & { agentId: string; taskId: string; elapsedMs: number }) => void;
}

function stepIcon(kind: string, ok?: boolean) {
  if (kind === 'verify' && ok === true) return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
  if (kind === 'verify' && ok === false) return <XCircle className="h-4 w-4 text-red-500" aria-hidden />;
  if (kind === 'observe') return <Circle className="h-4 w-4 text-sky-600" aria-hidden />;
  if (kind === 'think') return <Bot className="h-4 w-4 text-violet-600" aria-hidden />;
  return <ChevronRight className="h-4 w-4 text-amber-600" aria-hidden />;
}

export default function AgentPlay({ task, agent, config, patterns, onScored }: AgentPlayProps) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [result, setResult] = React.useState<AgentRunResult | null>(null);
  const [visibleSteps, setVisibleSteps] = React.useState(0);
  const [paintGrid, setPaintGrid] = React.useState<Grid | null>(null);
  const [paintProgress, setPaintProgress] = React.useState(0);
  const [currentCell, setCurrentCell] = React.useState<[number, number] | undefined>(undefined);
  const [score, setScore] = React.useState<ScoreInfo | null>(null);
  const timersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = React.useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  // reset everything when the task or agent changes
  React.useEffect(() => {
    clearTimers();
    setPhase('idle');
    setResult(null);
    setVisibleSteps(0);
    setPaintGrid(null);
    setPaintProgress(0);
    setCurrentCell(undefined);
    setScore(null);
  }, [task.id, agent.id, clearTimers]);

  const testInput = task.test[0]?.input ?? [];
  const expected = task.test[0]?.output ?? null;

  function computeScore(res: AgentRunResult): ScoreInfo | null {
    if (!expected) return null;
    const pred = res.attempts[0]?.[0] ?? null;
    if (!pred) return { exact: false, pass2: false, pixelAcc: 0, shapeOk: false, diffCells: expected.length * expected[0].length };
    const shapeOk = pred.length === expected.length && pred[0]?.length === expected[0]?.length;
    const d = diffGrids(pred, expected);
    const diffCells = shapeOk ? d.diffCells : expected.length * (expected[0]?.length ?? 0);
    const pixelAcc = shapeOk ? 1 - diffCells / Math.max(1, d.totalCells) : 0;
    const pass2 = res.attempts[0]?.some((p) => p && p.length === expected.length && p[0]?.length === expected[0]?.length && p.every((row, r) => row.every((c, ci) => c === expected[r][ci]))) ?? false;
    return { exact: shapeOk && diffCells === 0, pass2, pixelAcc, shapeOk, diffCells };
  }

  async function runAgent() {
    clearTimers();
    setPhase('running');
    setResult(null);
    setVisibleSteps(0);
    setPaintGrid(null);
    setPaintProgress(0);
    setScore(null);

    const payload = {
      train: task.train.map((p) => ({ input: p.input, output: p.output ?? undefined })),
      testInputs: task.test.map((p) => p.input),
      config,
    };
    let res: AgentRunResult;
    try {
      res = await agent.run(payload);
    } catch (err) {
      res = {
        ok: false,
        attempts: [],
        steps: [{ kind: 'act', label: 'Agent crashed', detail: err instanceof Error ? err.message : 'unknown error', ok: false }],
        elapsedMs: 0,
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
    setResult(res);
    setPhase('playing');

    // ── animate the step trace
    const stepCount = res.steps.length;
    for (let i = 1; i <= stepCount; i++) {
      timersRef.current.push(setTimeout(() => setVisibleSteps(i), i * 650));
    }

    // ── then paint the first prediction cell by cell
    const pred = res.attempts[0]?.[0];
    timersRef.current.push(
      setTimeout(
        () => {
          if (!pred) {
            setPhase('scored');
            return;
          }
          // painting order: changed cells first, then new non-zero, then clearing
          const changes: Array<[number, number]> = [];
          const draws: Array<[number, number]> = [];
          const clears: Array<[number, number]> = [];
          for (let r = 0; r < pred.length; r++) {
            for (let c = 0; c < (pred[r]?.length ?? 0); c++) {
              const inBounds = r < testInput.length && c < (testInput[r]?.length ?? 0);
              if (!inBounds || testInput[r][c] !== pred[r][c]) {
                if (pred[r][c] !== 0) changes.push([r, c]);
                else clears.push([r, c]);
              } else if (pred[r][c] !== 0) {
                draws.push([r, c]);
              }
            }
          }
          const order = [...changes, ...draws, ...clears];
          const working: Grid = testInput.map((row, r) => Array.from({ length: pred[r]?.length ?? row.length }, (_, c) => (r < testInput.length && c < (testInput[r]?.length ?? 0) ? testInput[r][c] : 0)));
          setPaintGrid(working);
          setPhase('painting');
          let i = 0;
          const perTick = Math.max(1, Math.round(order.length / 90)); // finish in ≤ ~90 ticks
          intervalRef.current = setInterval(() => {
            const nextIdx = Math.min(i + perTick, order.length);
            for (let k = i; k < nextIdx; k++) {
              const [r, c] = order[k];
              if (working[r] && c < working[r].length) working[r][c] = pred[r][c];
            }
            i = nextIdx;
            setPaintGrid(working.map((r) => [...r]));
            setPaintProgress(Math.round((i / Math.max(1, order.length)) * 100));
            const last = order[Math.max(0, i - 1)];
            setCurrentCell(last ? [last[0], last[1]] : undefined);
            if (i >= order.length) {
              if (intervalRef.current) clearInterval(intervalRef.current);
              intervalRef.current = null;
              setCurrentCell(undefined);
              // ── score
              const s = computeScore(res);
              setScore(s);
              setPhase('scored');
              if (s && onScored) onScored({ ...s, agentId: agent.id, taskId: task.id, elapsedMs: res.elapsedMs });
            }
          }, 22);
        },
        stepCount * 650 + 350,
      ),
    );
  }

  const busy = phase === 'running';
  const playing = phase === 'playing' || phase === 'painting';
  const pred = result?.attempts[0]?.[0] ?? null;
  const attempt2 = result?.attempts[0]?.[1] ?? null;
  const mismatch = React.useMemo(() => {
    if (!score || !pred || !expected || !score.shapeOk) return [];
    const cells: Array<[number, number]> = [];
    for (let r = 0; r < expected.length; r++) for (let c = 0; c < expected[r].length; c++) if (pred[r]?.[c] !== expected[r][c]) cells.push([r, c]);
    return cells;
  }, [score, pred, expected]);

  return (
    <div className="space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>{agent.emoji}</span>
          <div>
            <p className="text-sm font-bold leading-tight">{agent.name}</p>
            <p className="text-xs text-muted-foreground">
              {phase === 'idle' && 'Ready to play'}
              {phase === 'running' && 'Thinking…'}
              {phase === 'playing' && 'Explaining its reasoning…'}
              {phase === 'painting' && 'Painting the answer…'}
              {phase === 'scored' && (result?.ok ? 'Done' : 'Failed')}
              {' · '}{task.id}
            </p>
          </div>
        </div>
        <Button onClick={runAgent} disabled={busy || playing} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {result ? 'Run again' : 'Run agent'}
        </Button>
      </div>

      {(busy || playing) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {agent.slow ? 'This agent can take up to a minute on harder puzzles…' : 'Working…'}
          <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => { clearTimers(); setVisibleSteps(result?.steps.length ?? 0); }} disabled={!result}>
            <SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip animation
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── left: agent trace */}
        <div className="rounded-xl border bg-card">
          <div className="border-b px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Agent trace</div>
          <ScrollArea className="h-[300px]">
            <div className="space-y-1 p-3">
              {phase === 'idle' && <p className="p-4 text-sm text-muted-foreground">Press <strong className="text-foreground">Run agent</strong> to watch this agent attempt the puzzle.</p>}
              {(phase === 'idle'
                ? []
                : (result?.steps ?? []).slice(0, phase === 'scored' ? undefined : visibleSteps)
              ).map((s, i) => (
                <div key={i} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm', s.ok === false && s.kind === 'verify' && 'bg-red-500/5')}>
                  <span className="mt-0.5 shrink-0">{stepIcon(s.kind, s.ok)}</span>
                  <div className="min-w-0">
                    <p className="leading-snug">{s.label}</p>
                    {s.detail && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{s.detail}</p>}
                    {s.code && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] leading-snug text-muted-foreground">{s.code}</pre>}
                  </div>
                </div>
              )) ?? null}
              {phase === 'idle' ? null : visibleSteps === 0 && <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking…</div>}
            </div>
          </ScrollArea>
        </div>

        {/* ── right: the play field */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">The play field</span>
            {phase === 'painting' && <Badge variant="secondary" className="gap-1.5"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{paintProgress}%</Badge>}
          </div>
          <div className="space-y-4 p-4">
            {/* examples reference */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Examples the agent studied</p>
              <div className="flex flex-wrap gap-3">
                {task.train.slice(0, 4).map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <GridView grid={p.input} cellSize={8} patterns={patterns} ariaLabel={`Example ${i + 1} input`} />
                    <span className="text-muted-foreground" aria-hidden>→</span>
                    {p.output && <GridView grid={p.output} cellSize={8} patterns={patterns} ariaLabel={`Example ${i + 1} output`} />}
                  </div>
                ))}
              </div>
            </div>
            {/* test input + prediction */}
            <div className="flex flex-wrap items-start gap-6">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Test input</p>
                <GridView grid={testInput} cellSize={Math.max(10, Math.min(18, 180 / Math.max(1, dims(testInput).w)))} patterns={patterns} ariaLabel="Test input grid" />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Agent prediction {score?.exact === true && <span className="text-emerald-600">· correct ✔</span>}
                </p>
                {pred && (phase === 'painting' || phase === 'scored' || paintGrid) ? (
                  <GridView
                    grid={(phase === 'painting' && paintGrid ? paintGrid : pred) as Grid}
                    cellSize={Math.max(10, Math.min(18, 180 / Math.max(1, dims(pred).w)))}
                    patterns={patterns}
                    highlightCells={phase === 'painting' ? (currentCell ? [currentCell] : undefined) : mismatch.length > 0 ? mismatch : undefined}
                    ariaLabel="Agent prediction grid"
                  />
                ) : (
                  <div className="flex h-[76px] w-[120px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                    {phase === 'running' || phase === 'playing' ? 'pending…' : 'not run yet'}
                  </div>
                )}
              </div>
              {attempt2 && phase === 'scored' && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attempt 2 (pass@2)</p>
                  <GridView grid={attempt2} cellSize={Math.max(8, Math.min(14, 140 / Math.max(1, dims(attempt2).w)))} patterns={patterns} ariaLabel="Second attempt grid" />
                </div>
              )}
            </div>
            {phase === 'painting' && <Progress value={paintProgress} aria-label="Painting progress" />}
            {/* score card */}
            {phase === 'scored' && score && (
              <div className={cn('rounded-lg border p-3', score.exact ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-card')} aria-live="polite">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {score.exact === true && <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Solved — exact match</Badge>}
                  {score.exact === false && score.pass2 === true && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Solved on attempt 2 (pass@2)</Badge>}
                  {score.exact === false && score.pass2 === false && <Badge variant="destructive" className="gap-1"><XCircle className="h-3.5 w-3.5" aria-hidden />Not solved</Badge>}
                  <span className="text-xs text-muted-foreground">
                    pixel accuracy {(score.pixelAcc * 100).toFixed(1)}%
                    {!score.shapeOk && ' · wrong output shape'}
                    {score.shapeOk && score.diffCells > 0 && ` · ${score.diffCells} wrong cell${score.diffCells === 1 ? '' : 's'}`}
                    {' · '}agent time {((result?.elapsedMs ?? 0) / 1000).toFixed(2)}s
                  </span>
                </div>
                {!expected && <p className="mt-1 text-xs text-muted-foreground">This task has no stored answer — scoring is only available for curriculum puzzles and imported tasks with outputs.</p>}
              </div>
            )}
            {phase === 'scored' && !result?.ok && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400" aria-live="polite">
                <p className="font-semibold">Agent error</p>
                <p className="mt-0.5 break-words text-xs">{result?.error}</p>
              </div>
            )}
            {phase === 'scored' && result?.note && (
              <p className="text-xs text-muted-foreground">{result.note}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
