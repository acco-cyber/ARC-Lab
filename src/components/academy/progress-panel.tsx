'use client';

/**
 * ARC Lab — Academy "My Progress" panel.
 * XP/level bar, streak, badges (earned vs locked), per-world skill map and
 * the last 7 daily challenge results. Data comes from the synced progress
 * store (ProgressData); skeletons render while it is still loading.
 */

import React from 'react';
import { CalendarDays, Check, Flame, Lock, Sparkles, Trophy, X } from 'lucide-react';
import { useArcLab } from '@/lib/store/arc-lab';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface ProgressPanelProps {
  /** World names from the manifest, for friendlier skill-map rows. */
  worlds?: Array<{ id: number; name: string }>;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function ProgressPanel({ worlds }: ProgressPanelProps) {
  const progress = useArcLab((s) => s.progress);

  if (!progress) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading progress">
        <Card>
          <CardContent className="space-y-3 py-5">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 py-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 py-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const { xp, levelInfo, badges, levels, dailies, streak } = progress;
  const solvedTotal = levels.filter((l) => l.solved).length;
  const earnedBadges = badges.filter((b) => b.earned).length;

  // Level bar: playerLevel() → level = floor(xp/500)+1, nextAt = level*500.
  const levelFloor = (levelInfo.level - 1) * 500;
  const intoLevel = Math.max(0, xp - levelFloor);
  const levelSpan = Math.max(1, levelInfo.nextAt - levelFloor);
  const levelPct = Math.min(100, Math.round((intoLevel / levelSpan) * 100));
  const isMaxLevel = levelInfo.level >= 10 && xp >= levelInfo.nextAt;
  const xpToNext = Math.max(0, levelInfo.nextAt - xp);

  // Skill map: group solved counts by world prefix (w{N}l{M}).
  const worldSolved = new Map<number, number>();
  for (const l of levels) {
    const m = /^w(\d+)l\d+$/.exec(l.puzzleId);
    if (m && l.solved) {
      const w = Number(m[1]);
      worldSolved.set(w, (worldSolved.get(w) ?? 0) + 1);
    }
  }
  const worldRows = Array.from({ length: 10 }, (_, i) => {
    const w = i + 1;
    return {
      world: w,
      name: worlds?.find((x) => x.id === w)?.name ?? `World ${w}`,
      solved: worldSolved.get(w) ?? 0,
    };
  });

  const recentDailies = [...dailies].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);

  return (
    <div className="space-y-4">
      {/* XP + level overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" aria-hidden /> Experience
          </CardTitle>
          <CardDescription>Solve levels and dailies to level up from Novice to ARC Grandmaster.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="font-mono text-3xl font-extrabold tabular-nums tracking-tight">{xp.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">total XP</p>
            </div>
            <div className="h-10 w-px bg-border" aria-hidden />
            <div>
              <p className="text-lg font-bold leading-tight">
                Level {levelInfo.level} · <span className="text-muted-foreground">{levelInfo.title}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {isMaxLevel ? 'Max level reached — legendary.' : `${xpToNext} XP to next level`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-sm font-bold text-orange-600 dark:text-orange-400" aria-label={`Daily streak: ${streak} day${streak === 1 ? '' : 's'}`}>
              <Flame className="h-4 w-4" aria-hidden /> {streak} day{streak === 1 ? '' : 's'}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Level {levelInfo.level}</span>
              <span className="tabular-nums">
                {intoLevel} / {levelSpan} XP
              </span>
            </div>
            <Progress value={levelPct} aria-label={`Level progress: ${intoLevel} of ${levelSpan} XP`} />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Totals">
            <Badge variant="secondary" className="gap-1">
              <Trophy className="h-3 w-3 text-emerald-500" aria-hidden /> {solvedTotal}/100 levels
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3 text-amber-500" aria-hidden /> {earnedBadges}/{badges.length} badges
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Skill map */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Skill map</CardTitle>
            <CardDescription>Levels solved per world — a picture of what you have mastered.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {worldRows.map((row) => (
              <div key={row.world}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">
                    <span className="mr-1.5 font-mono text-muted-foreground" aria-hidden>
                      W{row.world}
                    </span>
                    {row.name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{row.solved}/10</span>
                </div>
                <Progress
                  value={(row.solved / 10) * 100}
                  className="h-2"
                  aria-label={`${row.name}: ${row.solved} of 10 levels solved`}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent dailies */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> Recent dailies
            </CardTitle>
            <CardDescription>Your last 7 daily challenge results.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentDailies.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No daily attempts yet — today is a great day to start.</p>
            ) : (
              <ul className="divide-y rounded-lg border" aria-label="Recent daily results">
                {recentDailies.map((d) => (
                  <li key={d.date} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    {d.solved ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" aria-hidden>
                        <Check className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-500" aria-hidden>
                        <X className="h-4 w-4" />
                      </span>
                    )}
                    <span className="font-medium">{formatDate(d.date)}</span>
                    <span className={cn('ml-auto text-xs font-medium', d.solved ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                      {d.solved ? 'Solved' : 'Missed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Badges */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Badges</CardTitle>
          <CardDescription>
            {earnedBadges} of {badges.length} earned — locked badges show what to chase next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                  b.earned
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-border bg-muted/30 opacity-70 grayscale-[0.6]',
                )}
                aria-label={`${b.name}: ${b.description} — ${b.earned ? 'earned' : 'locked'}`}
              >
                <span className="relative text-2xl leading-none" aria-hidden>
                  {b.emoji}
                  {!b.earned && (
                    <Lock className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-background text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-semibold', !b.earned && 'text-muted-foreground')}>{b.name}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{b.description}</span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
