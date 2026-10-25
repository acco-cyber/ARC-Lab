'use client';

/**
 * ARC Lab — ARC Academy (flagship puzzle game screen).
 * Tabs: Worlds (default) · Daily Challenge · My Progress.
 * Selecting an unlocked level switches to the immersive level-play screen.
 * Progress (solves/locks) comes from the synced store; while it loads we show
 * skeletons and never lock anything.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Flame,
  GraduationCap,
  Map,
  Play,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { api, type PuzzleManifest } from '@/lib/client/api';
import { useArcLab, type ProgressData } from '@/lib/store/arc-lab';
import { usePlayerId, useProgress } from '@/components/arc-lab/providers';
import { WorldMap } from './world-map';
import { LevelPlay } from './level-play';
import { ProgressPanel } from './progress-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AcademyTab = 'worlds' | 'daily' | 'progress';

/** First unsolved unlocked level in curriculum order (null = all caught up). */
function findContinueTarget(manifest: PuzzleManifest | undefined, progress: ProgressData | null): string | null {
  if (!manifest) return null;
  const ordered = [...manifest.levels].sort((a, b) => a.world - b.world || a.level - b.level);
  if (!progress) return ordered[0]?.id ?? null; // progress not loaded yet → don't lock anything
  const unlocked = new Set(progress.unlocks.levels);
  const solved = new Set(progress.levels.filter((l) => l.solved).map((l) => l.puzzleId));
  return ordered.find((l) => unlocked.has(l.id) && !solved.has(l.id))?.id ?? null;
}

export default function AcademyView() {
  usePlayerId();
  useProgress(); // keeps progress + header XP chip in sync
  const progress = useArcLab((s) => s.progress);

  const manifestQ = useQuery({
    queryKey: ['academy-manifest'],
    queryFn: () => api.manifest(),
    staleTime: Infinity,
  });

  const [subTab, setSubTab] = React.useState<AcademyTab>('worlds');
  const [levelId, setLevelId] = React.useState<string | null>(null);

  const continueTarget = findContinueTarget(manifestQ.data, progress);
  const continueLevel = continueTarget ? manifestQ.data?.levels.find((l) => l.id === continueTarget) ?? null : null;

  const handleNextLevel = React.useCallback(() => {
    if (!manifestQ.data || !levelId) {
      setLevelId(null);
      return;
    }
    const cur = manifestQ.data.levels.find((l) => l.id === levelId);
    if (!cur) {
      setLevelId(null);
      return;
    }
    const next =
      manifestQ.data.levels.find((l) => l.world === cur.world && l.level === cur.level + 1) ??
      manifestQ.data.levels.find((l) => l.world === cur.world + 1 && l.level === 1) ??
      null;
    setLevelId(next?.id ?? null);
  }, [manifestQ.data, levelId]);

  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [levelId, subTab]);

  // Sonner <Toaster /> is mounted here because the root layout only mounts the
  // radix toaster — sonner toast() calls from the Academy need a renderer.
  const toaster = <Toaster position="top-center" richColors closeButton />;

  if (levelId) {
    return (
      <div>
        {toaster}
        <LevelPlay levelId={levelId} onExit={() => setLevelId(null)} onNextLevel={handleNextLevel} />
      </div>
    );
  }

  const solvedTotal = progress?.levels.filter((l) => l.solved).length ?? null;

  return (
    <div className="space-y-5">
      {toaster}

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <GraduationCap className="h-6 w-6 shrink-0 text-emerald-500" aria-hidden /> ARC Academy
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            10 worlds × 10 levels — learn the skills of abstract reasoning, one grid at a time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {progress && (
            <>
              <Badge variant="secondary" className="gap-1 py-1">
                <Trophy className="h-3 w-3 text-emerald-500" aria-hidden /> {solvedTotal}/100
              </Badge>
              <Badge variant="secondary" className="gap-1 py-1">
                <Sparkles className="h-3 w-3 text-amber-500" aria-hidden /> {progress.xp} XP
              </Badge>
              {progress.streak > 0 && (
                <Badge variant="secondary" className="gap-1 py-1">
                  <Flame className="h-3 w-3 text-orange-500" aria-hidden /> {progress.streak}
                </Badge>
              )}
            </>
          )}
          <Button
            onClick={() => continueTarget && setLevelId(continueTarget)}
            disabled={!continueTarget}
            className="gap-2"
            aria-label={
              continueLevel
                ? `Continue at level ${continueLevel.id}: ${continueLevel.title}`
                : progress
                  ? 'All levels you have unlocked are solved'
                  : 'Continue playing'
            }
          >
            <Play className="h-4 w-4" aria-hidden />
            {progress
              ? continueLevel
                ? `Continue · ${continueLevel.world}.${continueLevel.level}`
                : 'All caught up!'
              : 'Start playing'}
          </Button>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as AcademyTab)}>
        <TabsList aria-label="Academy sections">
          <TabsTrigger value="worlds">
            <Map className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Worlds</span>
          </TabsTrigger>
          <TabsTrigger value="daily">
            <CalendarDays className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Daily Challenge</span>
          </TabsTrigger>
          <TabsTrigger value="progress">
            <TrendingUp className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">My Progress</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="worlds" className="mt-4">
          {manifestQ.data ? (
            <WorldMap manifest={manifestQ.data} progress={progress} onSelectLevel={setLevelId} />
          ) : manifestQ.isError ? (
            <Card className="mx-auto max-w-lg">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <TriangleAlert className="h-8 w-8 text-amber-500" aria-hidden />
                <p className="font-semibold">Could not load the curriculum</p>
                <p className="text-sm text-muted-foreground">{manifestQ.error?.message ?? 'Something went wrong.'}</p>
                <Button variant="outline" onClick={() => void manifestQ.refetch()} className="gap-2">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Try again
                </Button>
              </CardContent>
            </Card>
          ) : (
            <WorldsSkeleton />
          )}
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <DailyTab onExit={() => setSubTab('worlds')} />
        </TabsContent>

        <TabsContent value="progress" className="mt-4">
          <ProgressPanel worlds={manifestQ.data?.worlds.map(({ id, name }) => ({ id, name }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily challenge tab
// ---------------------------------------------------------------------------

function DailyTab({ onExit }: { onExit: () => void }) {
  const playerId = usePlayerId();
  const queryClient = useQueryClient();

  const dailyQ = useQuery({
    queryKey: ['academy-daily', playerId],
    queryFn: () => api.daily(playerId),
    enabled: playerId !== '',
  });

  if (playerId === '' || dailyQ.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading daily challenge">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (dailyQ.isError || !dailyQ.data) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" aria-hidden />
          <p className="font-semibold">Could not load today&apos;s challenge</p>
          <p className="text-sm text-muted-foreground">{dailyQ.error?.message ?? 'Something went wrong.'}</p>
          <Button variant="outline" onClick={() => void dailyQ.refetch()} className="gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { id, dateKey, solved } = dailyQ.data;

  return (
    <div className="space-y-4">
      {solved && (
        <div
          className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400"
          role="status"
        >
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          You solved today&apos;s challenge — come back tomorrow for a fresh puzzle! (Replaying is free, but awards no extra XP.)
        </div>
      )}
      <LevelPlay
        key={id}
        levelId={id}
        isDaily
        dateKey={dateKey}
        onExit={onExit}
        onNextLevel={onExit}
        onSettled={() => {
          void queryClient.invalidateQueries({ queryKey: ['academy-daily'] });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function WorldsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading worlds">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2.5 py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-1.5 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
