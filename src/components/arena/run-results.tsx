'use client';

/**
 * ARC Arena — run results viewer.
 *
 * Per-solver summary cards (exact / pass@2 / pixel accuracy / runtime),
 * a failure-taxonomy breakdown, a per task × solver table with an inspector
 * (prediction vs expected grids with diff highlight) and JSON export.
 */

import React from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Check, Download, Info, X } from 'lucide-react';
import type { ArenaRunResponse } from '@/lib/client/api';
import { FAILURE_LABELS, type FailureCategory } from '@/lib/arc/metrics';
import { useArcLab } from '@/lib/store/arc-lab';
import { GridView } from '@/components/arc/grid-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SOLVER_CATALOG, SOLVER_KIND_CLASS, normalizeKind, type SolverKind } from './run-setup';

export type ArenaPerTaskRow = ArenaRunResponse['perTask'][number];

const FAILURE_CATEGORIES: FailureCategory[] = [
  'none',
  'no-prediction',
  'unverifiable',
  'shape-mismatch',
  'color-mismatch',
  'cell-errors',
];

const FAILURE_BAR_CLASS: Record<FailureCategory, string> = {
  none: 'bg-emerald-500',
  'no-prediction': 'bg-zinc-400',
  unverifiable: 'bg-zinc-500',
  'shape-mismatch': 'bg-rose-500',
  'color-mismatch': 'bg-amber-500',
  'cell-errors': 'bg-rose-300',
};

function failureLabel(category: string): string {
  return (FAILURE_LABELS as Record<string, string>)[category] ?? category;
}

function failureBadgeClass(category: string): string {
  const map: Record<string, string> = {
    none: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
    'no-prediction': 'border-zinc-500/40 text-zinc-500 dark:text-zinc-400',
    unverifiable: 'border-zinc-500/40 text-zinc-500 dark:text-zinc-400',
    'shape-mismatch': 'border-rose-500/40 text-rose-600 dark:text-rose-400',
    'color-mismatch': 'border-amber-500/40 text-amber-600 dark:text-amber-400',
    'cell-errors': 'border-rose-500/30 text-rose-500 dark:text-rose-300',
  };
  return map[category] ?? 'border-zinc-500/40 text-zinc-500 dark:text-zinc-400';
}

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms).toLocaleString('en-US')} ms`;
  return `${ms.toFixed(1)} ms`;
}

function autoCellSize(grids: Array<number[][] | null | undefined>, cap = 18): number {
  let maxDim = 1;
  for (const g of grids) {
    if (!g) continue;
    maxDim = Math.max(maxDim, g.length, g[0]?.length ?? 0);
  }
  return Math.max(8, Math.min(cap, Math.floor(240 / maxDim)));
}

interface DisplaySolver {
  id: string;
  name: string;
  kind: SolverKind;
}

function buildSolverIndex(run: ArenaRunResponse): Map<string, DisplaySolver> {
  const index = new Map<string, DisplaySolver>();
  for (const entry of run.solverCatalog) {
    index.set(entry.id, { id: entry.id, name: entry.name, kind: normalizeKind(entry.kind) });
  }
  for (const meta of SOLVER_CATALOG) {
    if (!index.has(meta.id)) index.set(meta.id, { id: meta.id, name: meta.name, kind: meta.kind });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RunResultsProps {
  run: ArenaRunResponse;
}

export function RunResults({ run }: RunResultsProps) {
  const patterns = useArcLab((s) => s.patterns);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  const solverIndex = React.useMemo(() => buildSolverIndex(run), [run]);
  const nameOf = React.useCallback((id: string) => solverIndex.get(id)?.name ?? id, [solverIndex]);

  const bestExact = React.useMemo(() => Math.max(0, ...run.summary.map((s) => s.exactRate)), [run.summary]);

  const taskOrder = React.useMemo(() => {
    const seen: string[] = [];
    const set = new Set<string>();
    for (const row of run.perTask) {
      if (!set.has(row.taskId)) {
        set.add(row.taskId);
        seen.push(row.taskId);
      }
    }
    return seen;
  }, [run.perTask]);

  const rowsByTask = React.useMemo(() => {
    const map = new Map<string, ArenaPerTaskRow[]>();
    for (const row of run.perTask) {
      const list = map.get(row.taskId) ?? [];
      list.push(row);
      map.set(row.taskId, list);
    }
    return map;
  }, [run.perTask]);

  const flatRows = React.useMemo(() => {
    const out: Array<{ key: string; row: ArenaPerTaskRow }> = [];
    for (const taskId of taskOrder) {
      for (const row of rowsByTask.get(taskId) ?? []) {
        out.push({ key: `${row.taskId}::${row.solverId}`, row });
      }
    }
    return out;
  }, [taskOrder, rowsByTask]);

  const selected = flatRows.find((f) => f.key === selectedKey)?.row ?? null;

  const config = run.config as { datasetVersion?: string; appVersion?: string };
  const taskCount = run.summary[0]?.total ?? taskOrder.length;

  const diffCells = React.useMemo(() => {
    const pred = selected?.predictions[0];
    const expected = selected?.expected ?? null;
    if (!pred || !expected) return [] as Array<[number, number]>;
    if (pred.length !== expected.length || (pred[0]?.length ?? 0) !== (expected[0]?.length ?? 0)) {
      return [] as Array<[number, number]>;
    }
    const cells: Array<[number, number]> = [];
    for (let r = 0; r < expected.length; r++) {
      for (let c = 0; c < expected[r].length; c++) {
        if (pred[r]?.[c] !== expected[r][c]) cells.push([r, c]);
      }
    }
    return cells;
  }, [selected]);

  function handleExport() {
    const payload = {
      experiment: { runId: run.runId, createdAt: run.createdAt, config: run.config },
      summary: run.summary,
      perTask: run.perTask,
    };
    const filename = `arc-lab-run-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    toast.success('Run exported', { description: filename });
  }

  return (
    <Card>
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            Run results
            {run.runId ? (
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                {run.runId.slice(0, 8)}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                unsaved
              </Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(new Date(run.createdAt), 'MMM d, yyyy · HH:mm:ss')} · {run.summary.length} solver
            {run.summary.length === 1 ? '' : 's'} × {taskCount} task{taskCount === 1 ? '' : 's'}
            {config.datasetVersion ? ` · dataset ${config.datasetVersion}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export run JSON
        </Button>
      </div>

      <CardContent className="space-y-6 p-4 sm:p-5">
        {run.summary.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            This run contains no solver summaries.
          </p>
        ) : (
          <>
            {/* -------- summary cards -------- */}
            <section aria-labelledby="arena-summary-heading" className="space-y-2">
              <h3 id="arena-summary-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Summary
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {run.summary.map((s) => {
                  const isBest = s.exactRate > 0 && s.exactRate === bestExact;
                  return (
                    <div
                      key={s.solverId}
                      className={cn(
                        'space-y-2.5 rounded-lg border bg-card p-3',
                        isBest && 'ring-2 ring-emerald-500/70',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-bold leading-tight">{nameOf(s.solverId)}</p>
                        {isBest && (
                          <Badge className="shrink-0 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            best
                          </Badge>
                        )}
                      </div>
                      <div>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">Exact accuracy</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {pct(s.exactRate)} <span className="font-normal text-muted-foreground">({s.solved}/{s.total})</span>
                          </span>
                        </div>
                        <Progress
                          value={s.exactRate * 100}
                          className="h-2 bg-zinc-500/15 [&>div]:bg-emerald-500"
                          aria-label={`Exact accuracy ${pct(s.exactRate)} for ${nameOf(s.solverId)}`}
                        />
                      </div>
                      <dl className="space-y-1 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Pass@2</dt>
                          <dd className="font-medium">
                            {pct(s.pass2Rate)} <span className="text-muted-foreground">({s.pass2Solved}/{s.total})</span>
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Avg pixel acc</dt>
                          <dd className="font-medium">{s.avgPixelAcc === null ? 'n/a' : pct(s.avgPixelAcc, 1)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Avg runtime</dt>
                          <dd className="font-medium">{fmtMs(s.avgRuntimeMs)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Total runtime</dt>
                          <dd className="font-medium">{fmtMs(s.totalRuntimeMs)}</dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* -------- failures breakdown -------- */}
            <section aria-labelledby="arena-failures-heading" className="space-y-2">
              <h3 id="arena-failures-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Failures breakdown
              </h3>
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                {run.summary.map((s) => {
                  const segments = FAILURE_CATEGORIES.map((cat) => ({ cat, count: s.failures[cat] ?? 0 })).filter(
                    (seg) => seg.count > 0,
                  );
                  return (
                    <div key={s.solverId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-semibold">{nameOf(s.solverId)}</span>
                        <span className="text-muted-foreground">{s.total} task{s.total === 1 ? '' : 's'}</span>
                      </div>
                      {s.total === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No tasks evaluated.</p>
                      ) : (
                        <>
                          <div
                            className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-500/15"
                            role="img"
                            aria-label={`Failure breakdown for ${nameOf(s.solverId)}: ${segments
                              .map((seg) => `${seg.count} ${failureLabel(seg.cat)}`)
                              .join(', ')}`}
                          >
                            {segments.map((seg) => (
                              <div
                                key={seg.cat}
                                className={cn('h-full', FAILURE_BAR_CLASS[seg.cat])}
                                style={{ width: `${(seg.count / s.total) * 100}%` }}
                                title={`${failureLabel(seg.cat)}: ${seg.count}`}
                              />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {segments.map((seg) => (
                              <span
                                key={seg.cat}
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              >
                                <span className={cn('h-2 w-2 rounded-full', FAILURE_BAR_CLASS[seg.cat])} aria-hidden />
                                {failureLabel(seg.cat)}
                                <span className="font-bold text-foreground">{seg.count}</span>
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* -------- per-task table -------- */}
            <section aria-labelledby="arena-pertask-heading" className="space-y-2">
              <h3 id="arena-pertask-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Per-task results <span className="normal-case text-muted-foreground/70">· click a row to inspect</span>
              </h3>
              {/* max-h on both Root and the viewport: the viewport is size-full, so a
                  max-height on the Root alone would not create an internal scroll region. */}
              <ScrollArea className="max-h-96 rounded-lg border [&>[data-slot=scroll-area-viewport]]:max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">Task</TableHead>
                      <TableHead>Solver</TableHead>
                      <TableHead>Exact</TableHead>
                      <TableHead>Pass@2</TableHead>
                      <TableHead>Pixel</TableHead>
                      <TableHead>Runtime</TableHead>
                      <TableHead className="pr-3">Failure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flatRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                          No per-task results in this run.
                        </TableCell>
                      </TableRow>
                    )}
                    {flatRows.map(({ key, row }) => {
                      const isSelected = key === selectedKey;
                      return (
                        <TableRow
                          key={key}
                          data-state={isSelected ? 'selected' : undefined}
                          aria-selected={isSelected}
                          tabIndex={0}
                          className="cursor-pointer"
                          onClick={() => setSelectedKey(isSelected ? null : key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedKey(isSelected ? null : key);
                            }
                          }}
                          aria-label={`Task ${row.taskId}, solver ${nameOf(row.solverId)}`}
                        >
                          <TableCell className="pl-3 font-mono text-xs">{row.taskId}</TableCell>
                          <TableCell className="text-xs">{nameOf(row.solverId)}</TableCell>
                          <TableCell>
                            {row.exact === null ? (
                              <span className="text-xs text-muted-foreground">n/a</span>
                            ) : row.exact ? (
                              <Check className="h-4 w-4 text-emerald-500" aria-label="Exact match" />
                            ) : (
                              <X className="h-4 w-4 text-rose-500" aria-label="Not an exact match" />
                            )}
                          </TableCell>
                          <TableCell>
                            {row.pass2 === null ? (
                              <span className="text-xs text-muted-foreground">n/a</span>
                            ) : row.pass2 ? (
                              <Check className="h-4 w-4 text-emerald-500" aria-label="Solved within two candidates" />
                            ) : (
                              <X className="h-4 w-4 text-rose-500" aria-label="Not solved within two candidates" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {row.pixelAcc === null ? <span className="text-muted-foreground">n/a</span> : pct(row.pixelAcc, 1)}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">{fmtMs(row.runtimeMs)}</TableCell>
                          <TableCell className="pr-3">
                            <Badge variant="outline" className={cn('max-w-44 truncate text-[10px]', failureBadgeClass(row.failure))}>
                              {failureLabel(row.failure)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>

              {/* -------- inspector -------- */}
              {selected && (
                <InspectorPanel
                  row={selected}
                  solverName={nameOf(selected.solverId)}
                  diffCells={diffCells}
                  patterns={patterns}
                />
              )}
            </section>
          </>
        )}

        {/* -------- honest metrics note -------- */}
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Pixel accuracy is diagnostic; exact match is the official-style metric. A program fitting demonstrations has not
          necessarily discovered the intended rule.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inspector (selected per-task row)
// ---------------------------------------------------------------------------

function InspectorPanel(props: {
  row: ArenaPerTaskRow;
  solverName: string;
  diffCells: Array<[number, number]>;
  patterns: boolean;
}) {
  const { row, solverName, diffCells, patterns } = props;
  const prediction = row.predictions[0] ?? null;
  const candidate2 = row.predictions[1] ?? null;
  const expected = row.expected ?? null;
  const cellSize = autoCellSize([prediction, candidate2, expected]);

  return (
    <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-muted/30 p-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold">
          Task <span className="font-mono">{row.taskId}</span> · {solverName}
        </p>
        {row.exact === null ? (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            exact n/a
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              row.exact
                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                : 'border-rose-500/40 text-rose-600 dark:text-rose-400',
            )}
          >
            exact {row.exact ? '✓' : '✗'}
          </Badge>
        )}
        {row.pass2 === true && (
          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
            pass@2
          </Badge>
        )}
        {row.pixelAcc !== null && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            pixel {pct(row.pixelAcc, 1)}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {fmtMs(row.runtimeMs)}
        </Badge>
        <Badge variant="outline" className={cn('text-[10px]', failureBadgeClass(row.failure))}>
          {failureLabel(row.failure)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <GridSlot label="Prediction" cellSize={cellSize} patterns={patterns}>
          {prediction ? (
            <GridView grid={prediction} cellSize={cellSize} patterns={patterns} highlightCells={diffCells} showCoords ariaLabel={`Prediction grid for task ${row.taskId}`} />
          ) : (
            <EmptyGrid label="no prediction" />
          )}
        </GridSlot>
        {candidate2 && (
          <GridSlot label="Candidate 2" cellSize={cellSize} patterns={patterns}>
            <GridView grid={candidate2} cellSize={cellSize} patterns={patterns} showCoords ariaLabel={`Second candidate grid for task ${row.taskId}`} />
          </GridSlot>
        )}
        <div className="hidden self-center sm:block" aria-hidden>
          <div className="h-10 w-px bg-border" />
        </div>
        <GridSlot label="Expected" cellSize={cellSize} patterns={patterns}>
          {expected ? (
            <GridView grid={expected} cellSize={cellSize} patterns={patterns} highlightCells={diffCells} showCoords ariaLabel={`Expected grid for task ${row.taskId}`} />
          ) : (
            <EmptyGrid label="n/a — no ground truth" />
          )}
        </GridSlot>
      </div>

      {diffCells.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {diffCells.length} mismatched cell{diffCells.length === 1 ? '' : 's'} outlined.
        </p>
      )}
      {row.note && <p className="text-xs italic text-muted-foreground">Solver note: {row.note}</p>}
    </div>
  );
}

function GridSlot(props: { label: string; cellSize: number; patterns: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{props.label}</p>
      {props.children}
    </div>
  );
}

function EmptyGrid({ label }: { label: string }) {
  return (
    <div
      className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed p-1 text-center text-[10px] leading-tight text-muted-foreground"
      role="img"
      aria-label={label}
    >
      {label}
    </div>
  );
}

export default RunResults;
