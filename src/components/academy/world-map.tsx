'use client';

/**
 * ARC Lab — Academy world map.
 * 10 world cards (skills, difficulty, progress) with inline expansion listing
 * the 10 levels of each world as a grid of playable level buttons.
 * Lock states come from server-computed progress.unlocks (levels/worlds).
 */

import React from 'react';
import { Check, ChevronDown, Lock, Play } from 'lucide-react';
import type { PuzzleManifest } from '@/lib/client/api';
import type { ProgressData } from '@/lib/store/arc-lab';
import { colorHex } from '@/lib/arc/colors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface WorldMapProps {
  manifest: PuzzleManifest;
  progress: ProgressData | null;
  onSelectLevel: (levelId: string) => void;
}

/** Difficulty → theme-safe badge styling (no blue/indigo UI colors). */
const DIFFICULTY_CLASS: Record<string, string> = {
  beginner: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  easy: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  intermediate: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  advanced: 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  expert: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function difficultyClass(d: string): string {
  return DIFFICULTY_CLASS[d.toLowerCase()] ?? 'border-border bg-muted text-muted-foreground';
}

/** One authentic ARC palette color per world (data accents, not theme colors). */
const WORLD_ACCENT: number[] = [3, 8, 7, 4, 6, 2, 5, 9, 1, 0];

type LevelStatus = 'solved' | 'unlocked' | 'locked';

export function WorldMap({ manifest, progress, onSelectLevel }: WorldMapProps) {
  const [expanded, setExpanded] = React.useState<number | null>(null);

  // progress === null → show everything unlocked (no locks until data arrives).
  const solvedIds = React.useMemo(
    () => new Set((progress?.levels ?? []).filter((l) => l.solved).map((l) => l.puzzleId)),
    [progress],
  );
  const unlockedWorlds = React.useMemo(
    () => (progress ? new Set(progress.unlocks.worlds) : new Set(manifest.worlds.map((w) => w.id))),
    [progress, manifest],
  );
  const unlockedLevels = React.useMemo(
    () => (progress ? new Set(progress.unlocks.levels) : new Set(manifest.levels.map((l) => l.id))),
    [progress, manifest],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {manifest.worlds
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((world) => {
          const levels = manifest.levels
            .filter((l) => l.world === world.id)
            .sort((a, b) => a.level - b.level);
          const solvedCount = levels.filter((l) => solvedIds.has(l.id)).length;
          const isUnlocked = unlockedWorlds.has(world.id);
          const isOpen = expanded === world.id;
          const accent = colorHex(WORLD_ACCENT[world.id - 1] ?? world.id % 10);

          return (
            <Card
              key={world.id}
              className={cn(
                'overflow-hidden transition-shadow',
                isUnlocked && 'hover:shadow-md',
                !isUnlocked && 'opacity-75',
              )}
              style={{ borderTop: `3px solid ${accent}` }}
            >
              <button
                type="button"
                onClick={() => isUnlocked && setExpanded(isOpen ? null : world.id)}
                disabled={!isUnlocked}
                aria-expanded={isOpen}
                aria-controls={`world-panel-${world.id}`}
                aria-label={
                  isUnlocked
                    ? `${world.name}, ${world.difficulty}. ${solvedCount} of 10 levels solved. ${isOpen ? 'Collapse' : 'Expand'} levels.`
                    : `${world.name} is locked. Solve 5 levels in World ${world.id - 1} to unlock.`
                }
                className="flex w-full cursor-pointer items-start gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
              >
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-base font-extrabold text-black/80"
                  style={{ background: accent }}
                  aria-hidden
                >
                  {world.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold tracking-tight">{world.name}</span>
                    <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', difficultyClass(world.difficulty))}>
                      {world.difficulty}
                    </Badge>
                    {!isUnlocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{world.tagline}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {world.skills.map((s) => (
                      <Badge key={s} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                        {s}
                      </Badge>
                    ))}
                  </span>
                  <span className="mt-3 flex items-center gap-2">
                    <Progress
                      value={(solvedCount / 10) * 100}
                      className="h-1.5 flex-1"
                      aria-label={`${world.name} progress: ${solvedCount} of 10 levels solved`}
                    />
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{solvedCount}/10</span>
                  </span>
                </span>
                <ChevronDown
                  className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                  aria-hidden
                />
              </button>

              {isOpen && (
                <div id={`world-panel-${world.id}`} role="region" aria-label={`${world.name} levels`} className="border-t bg-muted/30 px-4 py-3">
                  <ScrollArea className="max-h-[340px]">
                    <div className="grid gap-2 pr-3 sm:grid-cols-2">
                      {levels.map((lvl) => {
                        const status: LevelStatus = solvedIds.has(lvl.id) ? 'solved' : unlockedLevels.has(lvl.id) ? 'unlocked' : 'locked';
                        return (
                          <Button
                            key={lvl.id}
                            variant="outline"
                            disabled={status === 'locked'}
                            onClick={() => onSelectLevel(lvl.id)}
                            className={cn(
                              'h-auto w-full justify-start gap-2.5 py-2',
                              status === 'solved' && 'border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15',
                            )}
                            aria-label={`Level ${lvl.level}: ${lvl.title} — ${status === 'solved' ? 'solved' : status === 'locked' ? 'locked' : 'ready to play'}`}
                          >
                            {status === 'solved' ? (
                              <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                            ) : status === 'locked' ? (
                              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            ) : (
                              <Play className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            )}
                            <span className="min-w-0 text-left">
                              <span className="block font-mono text-[10px] leading-tight text-muted-foreground">{lvl.id}</span>
                              <span className="block truncate text-xs font-medium leading-tight">
                                {lvl.level}. {lvl.title}
                              </span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </Card>
          );
        })}
    </div>
  );
}
