'use client';

/**
 * ARC Lab Workbench — task source sidebar.
 *
 * Curriculum browser (worlds → levels via /api/puzzles manifest), ARC JSON
 * import (file upload / paste / built-in demo sample), export to the standard
 * ARC JSON format, and the list of tasks loaded this session.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Braces, Download, FileUp, FlaskConical, Loader2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/client/api';
import { validateArcJson, type Task } from '@/lib/arc/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Built-in demo task: small 3×3 recolor (blue → red) with 2 train pairs.
// ---------------------------------------------------------------------------

export const DEMO_TASK_JSON = `{
  "schema_version": "arc-lab-1",
  "train": [
    { "input": [[1, 1, 0], [0, 1, 0], [0, 0, 1]], "output": [[2, 2, 0], [0, 2, 0], [0, 0, 2]] },
    { "input": [[0, 1, 1], [1, 0, 0], [1, 0, 1]], "output": [[0, 2, 2], [2, 0, 0], [2, 0, 2]] }
  ],
  "test": [ { "input": [[1, 0, 1], [0, 1, 0], [1, 1, 0]] } ]
}`;

export const DEMO_TASK_ID = 'demo-recolor-3x3';

// ---------------------------------------------------------------------------
// Parse / serialize helpers
// ---------------------------------------------------------------------------

export interface ArcJsonParseResult {
  ok: boolean;
  task?: Task;
  errors: string[];
}

/** Parse raw text as ARC JSON; returns a validated Task or readable errors. */
export function parseArcJson(text: string, id: string): ArcJsonParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'could not parse'}`] };
  }
  const res = validateArcJson(data, id);
  if (res.ok && res.task) return { ok: true, task: res.task, errors: [] };
  return { ok: false, errors: res.errors.length > 0 ? res.errors : ['Validation failed'] };
}

/**
 * Serialize a task to the standard ARC JSON shape
 * `{train:[{input,output}],test:[{input,output?}]}`. Test outputs that are
 * unknown (held out) are omitted from the export.
 */
export function taskToExportJson(task: Task): Record<string, unknown> {
  return {
    schema_version: task.schemaVersion,
    train: task.train.map((p) => (p.output ? { input: p.input, output: p.output } : { input: p.input })),
    test: task.test.map((p) => (p.output ? { input: p.input, output: p.output } : { input: p.input })),
  };
}

/** Download the task as `${task.id}.json` via Blob + object URL. */
export function downloadTaskJson(task: Task): void {
  const blob = new Blob([JSON.stringify(taskToExportJson(task), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${task.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export interface TaskSourceSidebarProps {
  currentTask: Task | null;
  sessionTasks: Task[];
  /** Level id currently being fetched (for per-button loading state). */
  loadingId: string | null;
  onLoadLevel: (id: string) => void;
  onSelectSessionTask: (id: string) => void;
  onImportTask: (task: Task) => void;
}

function sourceBadgeClass(source: Task['metadata']['source']): string {
  switch (source) {
    case 'arc-lab-synthetic':
      return 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400';
    case 'user-import':
      return 'border-amber-500/50 text-amber-600 dark:text-amber-400';
    case 'arc-official':
      return 'border-rose-500/50 text-rose-600 dark:text-rose-400';
  }
}

function sourceLabel(source: Task['metadata']['source']): string {
  switch (source) {
    case 'arc-lab-synthetic':
      return 'Synthetic';
    case 'user-import':
      return 'Import';
    case 'arc-official':
      return 'Official';
  }
}

export function TaskSourceSidebar({
  currentTask,
  sessionTasks,
  loadingId,
  onLoadLevel,
  onSelectSessionTask,
  onImportTask,
}: TaskSourceSidebarProps) {
  const manifestQuery = useQuery({ queryKey: ['workbench-manifest'], queryFn: () => api.manifest() });
  const [worldId, setWorldId] = React.useState<string>('');
  const [pasteText, setPasteText] = React.useState('');
  const [importErrors, setImportErrors] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const worlds = manifestQuery.data?.worlds ?? [];
  const levels = manifestQuery.data?.levels ?? [];
  const worldLevels = React.useMemo(
    () => levels.filter((l) => String(l.world) === worldId).sort((a, b) => a.level - b.level),
    [levels, worldId],
  );

  // Default to the first world once the manifest arrives.
  React.useEffect(() => {
    if (!worldId && worlds.length > 0) setWorldId(String(worlds[0].id));
  }, [worlds, worldId]);

  const acceptTask = React.useCallback(
    (task: Task) => {
      setImportErrors([]);
      onImportTask(task);
    },
    [onImportTask],
  );

  const importText = React.useCallback(
    (text: string, id: string) => {
      const res = parseArcJson(text, id);
      if (res.ok && res.task) acceptTask(res.task);
      else setImportErrors(res.errors);
    },
    [acceptTask],
  );

  const handleFile = React.useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        importText(text, file.name.replace(/\.json$/i, '').slice(0, 60) || 'imported');
      } catch {
        setImportErrors([`Could not read file "${file.name}".`]);
      }
    },
    [importText],
  );

  const loadDemo = React.useCallback(() => {
    importText(DEMO_TASK_JSON, DEMO_TASK_ID);
  }, [importText]);

  return (
    <div className="space-y-4 rounded-xl border bg-card p-3 text-sm">
      {/* ------------------------------ Curriculum ----------------------------- */}
      <section aria-label="Load curriculum task">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
          Curriculum task
        </h3>
        <Label htmlFor="wb-world-select" className="mb-1 block text-xs text-muted-foreground">
          World
        </Label>
        <Select value={worldId} onValueChange={setWorldId}>
          <SelectTrigger id="wb-world-select" size="sm" className="w-full" aria-label="Select world">
            <SelectValue placeholder={manifestQuery.isLoading ? 'Loading worlds…' : 'Choose a world'} />
          </SelectTrigger>
          <SelectContent>
            {worlds.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.id}. {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mt-2">
          {manifestQuery.isLoading && (
            <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading levels…
            </p>
          )}
          {manifestQuery.isError && (
            <div className="space-y-1.5 px-1 py-2" role="alert">
              <p className="text-xs text-rose-600 dark:text-rose-400">Failed to load manifest.</p>
              <Button variant="outline" size="sm" onClick={() => void manifestQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {manifestQuery.isSuccess && (
            <ScrollArea className="h-72 rounded-md border" aria-label="Level list">
              <ul className="p-1">
                {worldLevels.map((l) => {
                  const isCurrent = currentTask?.id === l.id;
                  const isLoading = loadingId === l.id;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => onLoadLevel(l.id)}
                        disabled={isLoading}
                        aria-label={`Load level ${l.id}: ${l.title}`}
                        aria-current={isCurrent || undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                          isCurrent && 'bg-emerald-500/10',
                        )}
                      >
                        <span className="font-mono text-[10px] text-muted-foreground" aria-hidden>
                          {l.id}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{l.title}</span>
                        {isLoading ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                        ) : (
                          <span className="shrink-0 text-[10px] uppercase text-muted-foreground" aria-hidden>
                            {l.difficulty}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {worldLevels.length === 0 && (
                  <li className="px-2 py-2 text-xs text-muted-foreground">No levels for this world.</li>
                )}
              </ul>
            </ScrollArea>
          )}
        </div>
      </section>

      <Separator />

      {/* ------------------------------ Import -------------------------------- */}
      <section aria-label="Import ARC JSON">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileUp className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Import ARC JSON
        </h3>
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="ARC JSON file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => fileInputRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" aria-hidden /> Choose file…
            </Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={loadDemo}>
              <Braces className="h-3.5 w-3.5" aria-hidden /> Demo sample
            </Button>
          </div>
          <div>
            <Label htmlFor="wb-paste-json" className="mb-1 block text-xs text-muted-foreground">
              …or paste ARC JSON
            </Label>
            <Textarea
              id="wb-paste-json"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='{"train":[{"input":[[0,1]],"output":[[1,0]]}],"test":[{"input":[[1,0]]}]}'
              className="h-24 resize-y font-mono text-[11px]"
              aria-label="Paste ARC JSON text"
              spellCheck={false}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-1.5 w-full"
              disabled={pasteText.trim().length === 0}
              onClick={() => importText(pasteText, `imported-${Date.now().toString(36)}`)}
            >
              Import pasted JSON
            </Button>
          </div>
          {importErrors.length > 0 && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2" role="alert">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Import rejected
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-rose-600 dark:text-rose-400">
                {importErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* ------------------------------ Export -------------------------------- */}
      <section aria-label="Export current task">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Download className="h-3.5 w-3.5 text-rose-500" aria-hidden />
          Export
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!currentTask}
          onClick={() => currentTask && downloadTaskJson(currentTask)}
          aria-label={currentTask ? `Download ${currentTask.id}.json` : 'Load a task first to export'}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download task JSON
        </Button>
        <p className="mt-1 px-0.5 text-[11px] leading-snug text-muted-foreground">
          {currentTask
            ? <>Saves <span className="font-mono">{currentTask.id}.json</span> in standard ARC format. Unknown test outputs are omitted.</>
            : 'Load a task to enable export.'}
        </p>
      </section>

      <Separator />

      {/* --------------------------- Session tasks ----------------------------- */}
      <section aria-label="Tasks loaded this session">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          This session ({sessionTasks.length})
        </h3>
        {sessionTasks.length === 0 ? (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            Tasks you load or import appear here for quick switching.
          </p>
        ) : (
          <ScrollArea className="h-40 rounded-md border" aria-label="Session task list">
            <ul className="p-1">
              {sessionTasks.map((t) => {
                const isCurrent = t.id === currentTask?.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSessionTask(t.id)}
                      aria-label={`Switch to task ${t.id}`}
                      aria-current={isCurrent || undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                        isCurrent && 'bg-emerald-500/10',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{t.id}</span>
                      <Badge variant="outline" className={cn('h-4 shrink-0 px-1 text-[9px]', sourceBadgeClass(t.metadata.source))}>
                        {sourceLabel(t.metadata.source)}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </section>
    </div>
  );
}
