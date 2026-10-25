'use client';

/**
 * ARC Lab Workbench — the visual reasoning debugger.
 *
 * Layout: task source sidebar (curriculum / import / export / session list)
 * + main area with a task header and four inspector tabs
 * (Examples · Objects · Program · Trace).
 *
 * Cross-link: when another experience (Academy) sets `workbenchTaskId` in the
 * shared store, the task is auto-loaded once and the flag is cleared.
 */

import React from 'react';
import { FlaskConical, Loader2, Microscope } from 'lucide-react';
import { useArcLab } from '@/lib/store/arc-lab';
import { api } from '@/lib/client/api';
import type { Task } from '@/lib/arc/types';
import type { Program } from '@/lib/arc/dsl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExamplesPanel, ObjectsPanel, ProgramPanel, TracePanel } from './panels';
import { DEMO_TASK_ID, DEMO_TASK_JSON, TaskSourceSidebar, parseArcJson } from './task-io';
import { cn } from '@/lib/utils';

type SourceBadgeMeta = { label: string; className: string };

const SOURCE_BADGES: Record<Task['metadata']['source'], SourceBadgeMeta> = {
  'arc-lab-synthetic': { label: 'Synthetic', className: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400' },
  'user-import': { label: 'User import', className: 'border-amber-500/50 text-amber-600 dark:text-amber-400' },
  'arc-official': { label: 'ARC official', className: 'border-rose-500/50 text-rose-600 dark:text-rose-400' },
};

function demoTask(): Task | null {
  const res = parseArcJson(DEMO_TASK_JSON, DEMO_TASK_ID);
  return res.ok && res.task ? res.task : null;
}

export default function WorkbenchView() {
  const workbenchTaskId = useArcLab((s) => s.workbenchTaskId);
  const clearWorkbenchTask = useArcLab((s) => s.clearWorkbenchTask);

  const [currentTask, setCurrentTask] = React.useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [sessionTasks, setSessionTasks] = React.useState<Task[]>([]);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [activePanel, setActivePanel] = React.useState<string>('examples');

  // Shared program state (Program panel edits, Trace panel consumes).
  const [program, setProgram] = React.useState<Program>([]);
  const [selectedPairIdx, setSelectedPairIdx] = React.useState(0);
  const [runAll, setRunAll] = React.useState(false);

  const applyTask = React.useCallback((task: Task) => {
    setCurrentTask(task);
    setSelectedTaskId(task.id);
    setProgram([]);
    setSelectedPairIdx(0);
    setRunAll(false);
    setActivePanel('examples');
    setLoadError(null);
    setSessionTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }, []);

  const loadLevel = React.useCallback(
    async (id: string) => {
      setLoadingId(id);
      setLoadError(null);
      try {
        const res = await api.puzzle(id, '');
        applyTask(res.task);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : `Failed to load task ${id}.`);
      } finally {
        setLoadingId(null);
      }
    },
    [applyTask],
  );

  // Auto-load a task requested via cross-link (Academy → Workbench), once.
  const handledRequestRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!workbenchTaskId || handledRequestRef.current === workbenchTaskId) return;
    handledRequestRef.current = workbenchTaskId;
    clearWorkbenchTask();
    void loadLevel(workbenchTaskId);
  }, [workbenchTaskId, clearWorkbenchTask, loadLevel]);

  const selectSessionTask = React.useCallback(
    (id: string) => {
      const found = sessionTasks.find((t) => t.id === id);
      if (found) applyTask(found);
    },
    [sessionTasks, applyTask],
  );

  const importTask = React.useCallback(
    (task: Task) => {
      applyTask(task);
      setActivePanel('examples');
    },
    [applyTask],
  );

  const task = currentTask;
  const pairCount = task?.train.length ?? 0;
  const safePairIdx = task ? Math.min(selectedPairIdx, Math.max(0, pairCount - 1)) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]" aria-label="ARC Workbench">
      {/* ------------------------------ Sidebar ------------------------------ */}
      <aside aria-label="Task source">
        <TaskSourceSidebar
          currentTask={task}
          sessionTasks={sessionTasks}
          loadingId={loadingId}
          onLoadLevel={(id) => void loadLevel(id)}
          onSelectSessionTask={selectSessionTask}
          onImportTask={importTask}
        />
        {loadError && (
          <p className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            {loadError}
          </p>
        )}
      </aside>

      {/* ------------------------------- Main -------------------------------- */}
      <section aria-label="Workbench main area" className="min-w-0">
        {!task ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
            <Microscope className="h-8 w-8 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-bold">No task loaded</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Pick a curriculum level from the sidebar, import an ARC JSON file, or start with the built-in demo (a tiny 3×3 recolor). The Workbench
              never reveals test outputs — research integrity first.
            </p>
            {loadingId && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading task…
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const t = demoTask();
                if (t) applyTask(t);
              }}
            >
              <FlaskConical className="h-4 w-4" aria-hidden /> Load demo task
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Task header */}
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-extrabold tracking-tight">
                    {task.metadata.title ?? 'Untitled task'}
                  </h2>
                  {typeof task.metadata.world === 'number' && (
                    <Badge variant="outline" className="border-zinc-400/50 text-zinc-600 dark:text-zinc-300">
                      World {task.metadata.world}
                      {typeof task.metadata.level === 'number' ? ` · Level ${task.metadata.level}` : ''}
                    </Badge>
                  )}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground" aria-label={`Task id ${task.id}`}>
                  {task.id}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  schema: {task.schemaVersion}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn('text-[10px]', SOURCE_BADGES[task.metadata.source].className)}
                  aria-label={`Task source: ${SOURCE_BADGES[task.metadata.source].label}`}
                >
                  {SOURCE_BADGES[task.metadata.source].label}
                </Badge>
              </div>
            </header>

            {/* Panels */}
            <Tabs value={activePanel} onValueChange={setActivePanel}>
              <TabsList aria-label="Workbench panels">
                <TabsTrigger value="examples">Examples</TabsTrigger>
                <TabsTrigger value="objects">Objects</TabsTrigger>
                <TabsTrigger value="program">Program</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
              </TabsList>
              <TabsContent value="examples" className="mt-4">
                <ExamplesPanel
                  task={task}
                  selectedPairIdx={safePairIdx}
                  onSelectPair={setSelectedPairIdx}
                  runAll={runAll}
                  onRunAllChange={setRunAll}
                />
              </TabsContent>
              <TabsContent value="objects" className="mt-4">
                <ObjectsPanel task={task} selectedPairIdx={safePairIdx} />
              </TabsContent>
              <TabsContent value="program" className="mt-4">
                <ProgramPanel
                  task={task}
                  selectedPairIdx={safePairIdx}
                  runAll={runAll}
                  onRunAllChange={setRunAll}
                  program={program}
                  setProgram={setProgram}
                />
              </TabsContent>
              <TabsContent value="trace" className="mt-4">
                <TracePanel task={task} selectedPairIdx={safePairIdx} program={program} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </section>
    </div>
  );
}
