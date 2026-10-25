'use client';

/**
 * ARC Arena — top-level evaluation view.
 *
 * Composes the run setup (left / top) with the results viewer (right / below),
 * keeps the last run in state, and offers a collapsible run history backed by
 * GET /api/arena/runs + GET /api/arena/runs/{id}. Academy cross-links arrive
 * via the arc-lab store (arenaPresetWorlds / arenaPresetIds).
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ChevronDown, FlaskConical, History, Loader2, Sparkles, Swords, X } from 'lucide-react';
import { api, type ArenaRunResponse, type ArenaRunHistoryItem, type PerSolverSummary } from '@/lib/client/api';
import { useArcLab } from '@/lib/store/arc-lab';
import { usePlayerId } from '@/components/arc-lab/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import RunSetup, { defaultSetupConfig, getSolverMeta, type ArenaSetupConfig } from './run-setup';
import RunResults, { type ArenaPerTaskRow } from './run-results';

interface RunRecordPayload {
  id: string;
  createdAt: string;
  config: Record<string, unknown>;
  summary: PerSolverSummary[];
  perTask: ArenaPerTaskRow[];
}

function presetLabelOf(presetIds: string[] | null, presetWorlds: number[] | null): string {
  if (presetIds && presetIds.length > 0) {
    return `${presetIds.length} level id${presetIds.length === 1 ? '' : 's'}: ${presetIds.slice(0, 5).join(', ')}${
      presetIds.length > 5 ? '…' : ''
    }`;
  }
  return `worlds ${(presetWorlds ?? []).join(', ')}`;
}

export default function ArenaView() {
  const playerId = usePlayerId();
  const queryClient = useQueryClient();

  const presetWorlds = useArcLab((s) => s.arenaPresetWorlds);
  const presetIds = useArcLab((s) => s.arenaPresetIds);
  const setArenaPreset = useArcLab((s) => s.setArenaPreset);

  const [tabValue, setTabValue] = React.useState<'new' | 'history'>('new');
  const [lastRun, setLastRun] = React.useState<ArenaRunResponse | null>(null);
  const [config, setConfig] = React.useState<ArenaSetupConfig>(defaultSetupConfig);
  const [historyOpen, setHistoryOpen] = React.useState(true);
  const [loadingRunId, setLoadingRunId] = React.useState<string | null>(null);

  const hasPreset = (presetIds?.length ?? 0) > 0 || (presetWorlds?.length ?? 0) > 0;

  // Academy cross-link: preselect the scope when a preset lands in the store.
  React.useEffect(() => {
    if (presetIds && presetIds.length > 0) {
      setConfig((c) => ({ ...c, mode: 'ids', idsText: presetIds.join(', ') }));
    } else if (presetWorlds && presetWorlds.length > 0) {
      setConfig((c) => ({ ...c, mode: 'curriculum', worlds: [...presetWorlds] }));
    }
  }, [presetIds, presetWorlds]);

  const historyQ = useQuery({
    queryKey: ['arena-history', playerId],
    queryFn: () => api.arenaRuns(playerId),
    enabled: playerId.length > 0,
  });

  const handleRunComplete = React.useCallback(
    (run: ArenaRunResponse) => {
      setLastRun(run);
      if (playerId) {
        queryClient.invalidateQueries({ queryKey: ['arena-history', playerId] });
      }
    },
    [playerId, queryClient],
  );

  async function loadRun(id: string) {
    setLoadingRunId(id);
    try {
      const res = await fetch(`/api/arena/runs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as RunRecordPayload;
      setLastRun({
        runId: data.id,
        createdAt: data.createdAt,
        config: data.config,
        summary: data.summary,
        perTask: data.perTask,
        solverCatalog: [],
      });
      toast.success('Run loaded', { description: `Run ${id.slice(0, 8)} is displayed in the results viewer.` });
      setTabValue('new');
    } catch (err) {
      toast.error('Could not load run', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoadingRunId(null);
    }
  }

  const runs = historyQ.data?.runs ?? [];

  return (
    <div>
      {/* mount a sonner toaster locally so arena toasts render regardless of app-level setup */}
      <Toaster position="bottom-right" richColors closeButton />

      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Swords className="h-6 w-6 text-emerald-500" aria-hidden />
          ARC Arena
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Reproducible solver evaluation — exact accuracy, pass@2, pixel accuracy, runtime and a failure taxonomy across
          symbolic, search and LLM baselines.
        </p>
      </div>

      {hasPreset && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          role="status"
        >
          <p className="flex min-w-0 items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">Scope preset from Academy — {presetLabelOf(presetIds ?? null, presetWorlds ?? null)}</span>
            <Badge variant="outline" className="shrink-0 border-amber-500/50 text-amber-700 dark:text-amber-300">
              From Academy
            </Badge>
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-amber-700 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300"
            onClick={() => setArenaPreset(null, null)}
            aria-label="Clear Academy preset"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}

      <Tabs value={tabValue} onValueChange={(v) => setTabValue(v === 'history' ? 'history' : 'new')}>
        <TabsList aria-label="Arena sections">
          <TabsTrigger value="new" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden /> New run
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" aria-hidden /> History
            {runs.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{runs.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ---------------- New run ---------------- */}
        <TabsContent value="new" className="mt-4">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <RunSetup config={config} onConfigChange={(patch) => setConfig((c) => ({ ...c, ...patch }))} onRunComplete={handleRunComplete} />
            <div className="min-w-0 space-y-4">
              {lastRun ? (
                <RunResults key={`${lastRun.runId ?? 'unsaved'}-${lastRun.createdAt}`} run={lastRun} />
              ) : (
                <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted" aria-hidden>
                    <Swords className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold">No run yet</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Pick at least one solver and a task scope, then hit <span className="font-semibold text-foreground">Run evaluation</span>.
                    Results appear here: summary cards, failure taxonomy and a per-task inspector.
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ---------------- History ---------------- */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-emerald-500" aria-hidden />
                Run history
              </CardTitle>
              <CardDescription>
                Your recent evaluations. Click one to load its full results into the viewer — each run stores dataset
                version, solver set, scope and timestamp.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {historyQ.isLoading ? 'Loading…' : `${runs.length} run${runs.length === 1 ? '' : 's'}`}
                  </p>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" disabled={historyQ.isLoading}>
                      {historyOpen ? 'Hide' : 'Show'}
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', historyOpen && 'rotate-180')} aria-hidden />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  {historyQ.isLoading ? (
                    <div className="space-y-2" role="status" aria-label="Loading run history">
                      <Skeleton className="h-16 w-full rounded-lg" />
                      <Skeleton className="h-16 w-full rounded-lg" />
                      <Skeleton className="h-16 w-full rounded-lg" />
                    </div>
                  ) : historyQ.isError ? (
                    <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                      Could not load run history: {historyQ.error instanceof Error ? historyQ.error.message : 'unknown error'}
                    </p>
                  ) : runs.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                      No runs yet — your completed evaluations will appear here.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {runs.map((item) => (
                        <HistoryRow
                          key={item.id}
                          item={item}
                          loading={loadingRunId === item.id}
                          onLoad={() => loadRun(item.id)}
                        />
                      ))}
                    </ul>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History row
// ---------------------------------------------------------------------------

function HistoryRow(props: { item: ArenaRunHistoryItem; loading: boolean; onLoad: () => void }) {
  const { item, loading, onLoad } = props;
  const first = item.summary[0];
  const taskCount = first?.total ?? 0;
  const solverNames = item.config.solvers.map((id) => getSolverMeta(id)?.name ?? id).join(', ');

  return (
    <li>
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="w-full rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-emerald-500/50 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        aria-label={`Load run from ${format(new Date(item.createdAt), 'MMM d, yyyy · HH:mm')}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{format(new Date(item.createdAt), 'MMM d, yyyy · HH:mm')}</p>
            <p className="truncate text-xs text-muted-foreground">{solverNames}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {taskCount} task{taskCount === 1 ? '' : 's'}
            </Badge>
            {first && (
              <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400">
                {pctOf(first.exactRate)} exact
              </Badge>
            )}
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading run" />
            ) : (
              <ChevronDown className="h-4 w-4 -rotate-90 text-muted-foreground" aria-hidden />
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function pctOf(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
