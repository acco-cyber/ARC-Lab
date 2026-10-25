'use client';

/**
 * ARC Arena — run setup panel.
 *
 * Solver selection (with kind badges + info popovers), task scope selection
 * (curriculum worlds / specific level ids / imported ARC JSON) and the
 * "Run evaluation" action that calls POST /api/arena/run.
 *
 * The solver catalog below mirrors src/lib/arc/solvers.ts. It is duplicated
 * client-side on purpose: importing the real registry would pull the
 * server-only LLM adapter into the browser bundle.
 */

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Info, Loader2, Play, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api, type ArenaRunResponse } from '@/lib/client/api';
import { validateArcJson } from '@/lib/arc/types';
import { useArcLab } from '@/lib/store/arc-lab';
import { usePlayerId } from '@/components/arc-lab/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Solver catalog (client mirror of src/lib/arc/solvers.ts)
// ---------------------------------------------------------------------------

export type SolverKind = 'baseline' | 'search' | 'ensemble' | 'llm';

export interface SolverMeta {
  id: string;
  name: string;
  kind: SolverKind;
  description: string;
  limitations: string;
  slow: boolean;
}

export const SOLVER_CATALOG: SolverMeta[] = [
  {
    id: 'copy-input',
    name: 'Copy-Input (sanity)',
    kind: 'baseline',
    description: 'Predicts the test input unchanged. Verifies the evaluation pipeline end to end.',
    limitations: 'Solves only identity-style tasks by construction.',
    slow: false,
  },
  {
    id: 'majority-fill',
    name: 'Majority Fill',
    kind: 'baseline',
    description: 'Predicts the most common training output shape filled with its dominant color.',
    limitations: 'Ignores the test input entirely; useful as a weak reference point.',
    slow: false,
  },
  {
    id: 'nearest-train',
    name: 'Nearest Train',
    kind: 'baseline',
    description: 'Returns the output of the pixel-nearest training input to the test input.',
    limitations: 'Cannot generalize beyond memorized examples.',
    slow: false,
  },
  {
    id: 'rule-based',
    name: 'Rule-Based',
    kind: 'baseline',
    description: 'Searches single geometric ops, single recolors, and keep-largest for a rule consistent across all demonstrations.',
    limitations: 'Only one-step rules; no composition, no shifting.',
    slow: false,
  },
  {
    id: 'program-search',
    name: 'Program Search (DSL)',
    kind: 'search',
    description: 'Bounded search over a 20-op DSL (geometry, color, shape, object ops) with pruning on the first demonstration and consistency scoring across all.',
    limitations: 'Depth ≤ 2 within time budget; parameters are enumerated from a bounded grid.',
    slow: true,
  },
  {
    id: 'ensemble',
    name: 'Ensemble',
    kind: 'ensemble',
    description: 'Prefers program-search predictions; falls back to rule-based, then copy-input. Explicit deterministic selection criteria.',
    limitations: 'Inherits limitations of its members; no learned selection.',
    slow: true,
  },
  {
    id: 'llm-glm',
    name: 'LLM Adapter (GLM)',
    kind: 'llm',
    description: 'Sends demonstration pairs to an LLM which returns candidate output grids as JSON. Two samples for pass@2.',
    limitations: 'Network-dependent; may fail to parse; capped tasks per run; copy-input fallback on failure.',
    slow: true,
  },
];

export const DEFAULT_SOLVERS: string[] = ['copy-input', 'rule-based', 'program-search'];

export function getSolverMeta(id: string): SolverMeta | undefined {
  return SOLVER_CATALOG.find((s) => s.id === id);
}

export function normalizeKind(kind: string): SolverKind {
  return kind === 'search' || kind === 'ensemble' || kind === 'llm' ? kind : 'baseline';
}

export const SOLVER_KIND_CLASS: Record<SolverKind, string> = {
  baseline: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300',
  search: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  ensemble: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  llm: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

// ---------------------------------------------------------------------------
// Scope draft + parsing / validation
// ---------------------------------------------------------------------------

export type ArenaScopeMode = 'curriculum' | 'ids' | 'inline';

export interface ArenaSetupConfig {
  solvers: string[];
  mode: ArenaScopeMode;
  /** Selected curriculum worlds (empty = all worlds). */
  worlds: number[];
  /** Raw comma-separated level ids for the 'ids' mode. */
  idsText: string;
  /** Curriculum task limit (1..30, clamped to 5 when the LLM solver is selected). */
  limit: number;
  /** Raw pasted ARC JSON for the 'inline' mode. */
  inlineText: string;
}

export function defaultSetupConfig(): ArenaSetupConfig {
  return {
    solvers: [...DEFAULT_SOLVERS],
    mode: 'curriculum',
    worlds: [],
    idsText: '',
    limit: 10,
    inlineText: '',
  };
}

const LEVEL_ID_RE = /^w(\d+)l(\d+)$/;
const DAILY_ID_RE = /^daily-\d{4}-\d{2}-\d{2}$/;

export function parseLevelIds(text: string): { ids: string[]; invalid: string[] } {
  const tokens = text
    .split(/[,\s;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (LEVEL_ID_RE.test(token) || DAILY_ID_RE.test(token)) {
      if (!ids.includes(token)) ids.push(token);
    } else {
      invalid.push(token);
    }
  }
  return { ids, invalid };
}

export interface InlineParseResult {
  tasks: unknown[];
  validCount: number;
  invalidCount: number;
  error: string | null;
}

/** Parse pasted ARC JSON: an array of task objects, or a single task object. */
export function parseInlineTasks(text: string): InlineParseResult {
  const empty: InlineParseResult = { tasks: [], validCount: 0, invalidCount: 0, error: null };
  if (!text.trim()) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'not valid JSON' };
  }
  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (typeof parsed === 'object' && parsed !== null && 'train' in (parsed as Record<string, unknown>)) {
    list = [parsed];
  } else {
    return { ...empty, error: 'expected a JSON array of task objects (or a single task object)' };
  }
  let validCount = 0;
  let invalidCount = 0;
  for (const item of list) {
    if (validateArcJson(item).ok) validCount++;
    else invalidCount++;
  }
  return { tasks: list, validCount, invalidCount, error: null };
}

export interface SetupValidation {
  ok: boolean;
  solvers: string[];
  scope: Record<string, unknown> | null;
  problem: string | null;
}

/** Validate the draft and build the API scope payload. Pure — safe in render. */
export function validateSetup(config: ArenaSetupConfig): SetupValidation {
  if (config.solvers.length === 0) {
    return { ok: false, solvers: [], scope: null, problem: 'Select at least one solver.' };
  }
  const useLlm = config.solvers.includes('llm-glm');

  if (config.mode === 'curriculum') {
    const limit = Math.min(Math.max(1, Math.round(config.limit)), useLlm ? 5 : 30);
    const scope: Record<string, unknown> = { type: 'curriculum', limit };
    if (config.worlds.length > 0) scope.worlds = [...config.worlds];
    return { ok: true, solvers: [...config.solvers], scope, problem: null };
  }

  if (config.mode === 'ids') {
    const { ids, invalid } = parseLevelIds(config.idsText);
    if (ids.length === 0) {
      return { ok: false, solvers: [], scope: null, problem: 'Enter at least one level id, e.g. w1l1 or daily-2025-06-01.' };
    }
    if (invalid.length > 0) {
      return { ok: false, solvers: [], scope: null, problem: `Invalid ids: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}.` };
    }
    return { ok: true, solvers: [...config.solvers], scope: { type: 'curriculum', ids, limit: ids.length }, problem: null };
  }

  // inline
  const parsed = parseInlineTasks(config.inlineText);
  if (parsed.error) {
    return { ok: false, solvers: [], scope: null, problem: `Imported JSON: ${parsed.error}` };
  }
  if (parsed.validCount === 0) {
    return { ok: false, solvers: [], scope: null, problem: 'Paste at least one valid ARC task (array of {train, test} objects).' };
  }
  const cap = useLlm ? 5 : 20;
  return {
    ok: true,
    solvers: [...config.solvers],
    scope: { type: 'inline', tasks: parsed.tasks.slice(0, cap) },
    problem: null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WORLD_IDS: number[] = Array.from({ length: 10 }, (_, i) => i + 1);

export interface RunSetupProps {
  config: ArenaSetupConfig;
  onConfigChange: (patch: Partial<ArenaSetupConfig>) => void;
  onRunComplete: (run: ArenaRunResponse) => void;
}

export function RunSetup({ config, onConfigChange, onRunComplete }: RunSetupProps) {
  const playerId = usePlayerId();
  const presetIds = useArcLab((s) => s.arenaPresetIds);
  const presetWorlds = useArcLab((s) => s.arenaPresetWorlds);
  const hasPreset = (presetIds?.length ?? 0) > 0 || (presetWorlds?.length ?? 0) > 0;

  const manifestQ = useQuery({ queryKey: ['manifest'], queryFn: api.manifest, staleTime: Infinity });

  const llmSelected = config.solvers.includes('llm-glm');
  const maxTasks = llmSelected ? 5 : 30;
  const effectiveLimit = Math.min(Math.max(1, Math.round(config.limit)), maxTasks);
  const inlineCap = llmSelected ? 5 : 20;

  const idsParsed = React.useMemo(() => parseLevelIds(config.idsText), [config.idsText]);
  const inlineParsed = React.useMemo(() => parseInlineTasks(config.inlineText), [config.inlineText]);
  const validation = React.useMemo(() => validateSetup(config), [config]);

  const worldName = React.useCallback(
    (id: number) => manifestQ.data?.worlds.find((w) => w.id === id)?.name ?? `World ${id}`,
    [manifestQ.data],
  );

  const runMutation = useMutation({
    mutationFn: (payload: { solvers: string[]; scope: Record<string, unknown> }) =>
      api.arenaRun({ playerId: playerId || undefined, solvers: payload.solvers, scope: payload.scope }),
    onSuccess: (res) => {
      const tasks = res.summary[0]?.total ?? 0;
      toast.success('Run complete', {
        description: `${res.summary.length} solver${res.summary.length === 1 ? '' : 's'} × ${tasks} task${tasks === 1 ? '' : 's'} evaluated.`,
      });
      onRunComplete(res);
    },
    onError: (err) => {
      toast.error('Arena run failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    },
  });

  const canRun = validation.ok && !runMutation.isPending;

  function toggleSolver(id: string) {
    const solvers = config.solvers.includes(id) ? config.solvers.filter((s) => s !== id) : [...config.solvers, id];
    const patch: Partial<ArenaSetupConfig> = { solvers };
    if (solvers.includes('llm-glm')) patch.limit = Math.min(config.limit, 5);
    onConfigChange(patch);
  }

  function toggleWorld(world: number) {
    const worlds = config.worlds.includes(world)
      ? config.worlds.filter((w) => w !== world)
      : [...config.worlds, world].sort((a, b) => a - b);
    onConfigChange({ worlds });
  }

  function handleRun() {
    const v = validateSetup(config);
    if (!v.ok || !v.scope) {
      toast.error('Cannot start run', { description: v.problem ?? 'Invalid configuration.' });
      return;
    }
    runMutation.mutate({ solvers: v.solvers, scope: v.scope });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-emerald-500" aria-hidden />
          Configure run
        </CardTitle>
        <CardDescription>Pick solvers and an evaluation scope. Solvers never see the expected outputs.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ---------------- Solvers ---------------- */}
        <section aria-labelledby="arena-solvers-heading" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="arena-solvers-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Solvers · {config.solvers.length}/{SOLVER_CATALOG.length} selected
            </h3>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onConfigChange({ solvers: SOLVER_CATALOG.map((s) => s.id) })}
              >
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onConfigChange({ solvers: [] })}>
                None
              </Button>
            </div>
          </div>

          <div className="space-y-2" role="group" aria-label="Solver selection">
            {SOLVER_CATALOG.map((solver) => {
              const selected = config.solvers.includes(solver.id);
              return (
                <div
                  key={solver.id}
                  className={cn(
                    'rounded-lg border p-2.5 transition-colors',
                    selected ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border bg-card hover:border-muted-foreground/30',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id={`solver-${solver.id}`}
                      checked={selected}
                      onCheckedChange={() => toggleSolver(solver.id)}
                      className="mt-0.5"
                      aria-label={`Select solver ${solver.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <label htmlFor={`solver-${solver.id}`} className="cursor-pointer text-sm font-semibold leading-tight">
                          {solver.name}
                        </label>
                        <Badge variant="outline" className={cn('h-4 px-1 text-[10px] uppercase tracking-wide', SOLVER_KIND_CLASS[solver.kind])}>
                          {solver.kind}
                        </Badge>
                        {solver.slow && (
                          <Badge variant="outline" className="h-4 border-amber-500/40 px-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            slow
                          </Badge>
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                              aria-label={`About ${solver.name}`}
                            >
                              <Info className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-80 text-xs">
                            <p className="font-semibold">{solver.name}</p>
                            <p className="mt-1 text-muted-foreground">{solver.description}</p>
                            <p className="mt-2 text-muted-foreground">
                              <span className="font-semibold text-amber-600 dark:text-amber-400">Limitations: </span>
                              {solver.limitations}
                            </p>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{solver.limitations}</p>
                      {solver.id === 'llm-glm' && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
                          Slow &amp; network-dependent; caps the run to 5 tasks.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------------- Task scope ---------------- */}
        <section aria-labelledby="arena-scope-heading" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="arena-scope-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Task scope
            </h3>
            {hasPreset && (
              <Badge variant="outline" className="gap-1 border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-300">
                <Sparkles className="h-3 w-3" aria-hidden /> From Academy
              </Badge>
            )}
          </div>

          <RadioGroup
            value={config.mode}
            onValueChange={(v) => onConfigChange({ mode: v as ArenaScopeMode })}
            className="gap-2"
            aria-label="Task scope mode"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="curriculum" id="scope-curriculum" />
              <Label htmlFor="scope-curriculum" className="cursor-pointer text-sm font-normal">
                Curriculum — by worlds
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="ids" id="scope-ids" />
              <Label htmlFor="scope-ids" className="cursor-pointer text-sm font-normal">
                Specific level IDs
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="inline" id="scope-inline" />
              <Label htmlFor="scope-inline" className="cursor-pointer text-sm font-normal">
                Imported tasks — ARC JSON
              </Label>
            </div>
          </RadioGroup>

          {config.mode === 'curriculum' && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Draw tasks from the selected worlds (empty = all worlds).</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Worlds">
                {WORLD_IDS.map((id) => {
                  const active = config.worlds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleWorld(id)}
                      aria-pressed={active}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                        active
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {id} · {worldName(id)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Slider
                  min={1}
                  max={maxTasks}
                  step={1}
                  value={[effectiveLimit]}
                  onValueChange={(v) => onConfigChange({ limit: v[0] ?? effectiveLimit })}
                  className="min-w-40 flex-1"
                  aria-label="Task limit"
                />
                <Input
                  type="number"
                  min={1}
                  max={maxTasks}
                  value={effectiveLimit}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) onConfigChange({ limit: Math.min(maxTasks, Math.round(n)) });
                  }}
                  className="h-9 w-20"
                  aria-label="Task limit (number input)"
                />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => onConfigChange({ worlds: [...WORLD_IDS] })}
                  >
                    All worlds
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onConfigChange({ worlds: [] })}>
                    Clear
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Runs up to <span className="font-semibold text-foreground">{effectiveLimit}</span> task
                {effectiveLimit === 1 ? '' : 's'} sampled across the selection (max {maxTasks}
                {llmSelected ? ' with the LLM solver' : ''}).
              </p>
            </div>
          )}

          {config.mode === 'ids' && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Label htmlFor="arena-ids" className="text-xs text-muted-foreground">
                Comma-separated level ids
              </Label>
              <Input
                id="arena-ids"
                value={config.idsText}
                onChange={(e) => onConfigChange({ idsText: e.target.value })}
                placeholder="w1l1, w3l5, daily-2025-06-01"
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={idsParsed.invalid.length > 0 || undefined}
              />
              {config.idsText.trim().length > 0 && (
                <p
                  className={cn(
                    'text-[11px]',
                    idsParsed.invalid.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                  )}
                  role="status"
                >
                  {idsParsed.invalid.length > 0
                    ? `Invalid ids: ${idsParsed.invalid.join(', ')} — expected w<n>l<n> or daily-YYYY-MM-DD.`
                    : `${idsParsed.ids.length} valid id${idsParsed.ids.length === 1 ? '' : 's'} ready.`}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Ids are matched against the 100-level curriculum; daily ids follow the schema but only resolve when part of it.
              </p>
            </div>
          )}

          {config.mode === 'inline' && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Label htmlFor="arena-inline" className="text-xs text-muted-foreground">
                Paste ARC JSON — an array of task objects ({'{train, test}'}) · cap {inlineCap} tasks
                {llmSelected ? ' (LLM)' : ''}
              </Label>
              <Textarea
                id="arena-inline"
                rows={6}
                value={config.inlineText}
                onChange={(e) => onConfigChange({ inlineText: e.target.value })}
                placeholder={'[\n  {\n    "train": [{ "input": [[0, 1]], "output": [[1, 0]] }],\n    "test": [{ "input": [[0, 1]] }]\n  }\n]'}
                className="font-mono text-xs"
                spellCheck={false}
                aria-invalid={inlineParsed.error ? true : undefined}
              />
              {config.inlineText.trim().length > 0 && (
                <p
                  className={cn(
                    'text-[11px]',
                    inlineParsed.error ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                  )}
                  role="status"
                >
                  {inlineParsed.error
                    ? `Invalid JSON: ${inlineParsed.error}`
                    : `${inlineParsed.validCount} valid task${inlineParsed.validCount === 1 ? '' : 's'}${
                        inlineParsed.invalidCount > 0 ? ` · ${inlineParsed.invalidCount} invalid (skipped)` : ''
                      } · first ${inlineCap} will run${llmSelected ? ' (LLM cap)' : ''}.`}
                </p>
              )}
            </div>
          )}

          {llmSelected && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400" role="status">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              LLM adapter selected — slow &amp; network-dependent; this run is capped to 5 tasks.
            </p>
          )}
        </section>

        {/* ---------------- Run ---------------- */}
        <div className="space-y-2 border-t pt-4">
          <Button
            className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={!canRun}
            onClick={handleRun}
          >
            {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {runMutation.isPending ? 'Evaluating…' : 'Run evaluation'}
          </Button>
          {runMutation.isPending && (
            <p className="text-center text-xs text-muted-foreground" role="status" aria-live="polite">
              Evaluating… program-search can take a few seconds per task.
            </p>
          )}
          {validation.problem && !runMutation.isPending && (
            <p className="text-center text-[11px] text-muted-foreground" role="status">
              {validation.problem}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Reproducibility: each run records the dataset version, solver set, scope and timestamp.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default RunSetup;
