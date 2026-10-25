'use client';

/**
 * ARC Lab — Academy level play screen (the core game loop).
 * Study examples → paint the answer in the grid editor → submit.
 * Practice mode (unrestricted, +25 XP base) vs Challenge mode (2 attempts, +100 XP base).
 * Tiered hints, solution reveal (practice), Workbench / Arena cross-links.
 */

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Eye,
  Lightbulb,
  Lock,
  Microscope,
  RotateCcw,
  Send,
  Swords,
  Target,
  TriangleAlert,
  Trophy,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { useArcLab } from '@/lib/store/arc-lab';
import { usePlayerId, useProgress } from '@/components/arc-lab/providers';
import { GridView } from '@/components/arc/grid-view';
import { GridEditor } from '@/components/arc/grid-editor';
import { ColorPalette } from '@/components/arc/color-palette';
import { PairViewer } from '@/components/arc/pair-viewer';
import { makeGrid } from '@/lib/arc/grid';
import { colorName } from '@/lib/arc/colors';
import type { Grid } from '@/lib/arc/types';
import type { SubmitResponse } from '@/lib/client/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface LevelPlayProps {
  levelId: string;
  onExit: () => void;
  onNextLevel: () => void;
  /** Daily challenges hide world-specific buttons and use daily XP rules. */
  isDaily?: boolean;
  /** Shown in the header for daily challenges (e.g. "2025-03-03"). */
  dateKey?: string;
  /** Called after any submit/hint settles — lets the parent refresh its own queries. */
  onSettled?: () => void;
}

type Mode = 'practice' | 'challenge';

const HINT_TIERS: Array<{ tier: number; label: string }> = [
  { tier: 1, label: 'What changed?' },
  { tier: 2, label: 'Transformation clue' },
  { tier: 3, label: 'Worked explanation' },
];

const DIFFICULTY_CLASS: Record<string, string> = {
  beginner: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  easy: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  intermediate: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  advanced: 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  expert: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function difficultyClass(d: string | undefined): string {
  if (!d) return 'border-border bg-muted text-muted-foreground';
  return DIFFICULTY_CLASS[d.toLowerCase()] ?? 'border-border bg-muted text-muted-foreground';
}

function bonusNotes(result: SubmitResponse, maxHintTier: number): string[] {
  if (!result.firstSolve) return [];
  const notes: string[] = [];
  if (result.wrongAttempts === 0) notes.push('+25 first-try bonus');
  if (maxHintTier === 0) notes.push('+25 no-hint bonus');
  return notes;
}

export function LevelPlay({ levelId, onExit, onNextLevel, isDaily = false, dateKey, onSettled }: LevelPlayProps) {
  const playerId = usePlayerId();
  const patterns = useArcLab((s) => s.patterns);
  const progress = useArcLab((s) => s.progress);
  const openInWorkbench = useArcLab((s) => s.openInWorkbench);
  const setArenaPreset = useArcLab((s) => s.setArenaPreset);
  const { refetch: refetchProgress } = useProgress();

  const [mode, setMode] = React.useState<Mode>('practice');
  const [color, setColor] = React.useState(1);
  const [answerGrid, setAnswerGrid] = React.useState<Grid | null>(null);
  const [result, setResult] = React.useState<SubmitResponse | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [hints, setHints] = React.useState<Record<number, string>>({});
  const [hintOpen, setHintOpen] = React.useState(false);

  const puzzleQ = useQuery({
    queryKey: ['academy-puzzle', levelId, playerId],
    queryFn: () => api.puzzle(levelId, playerId),
    enabled: playerId !== '',
  });

  const task = puzzleQ.data?.task ?? null;
  const taskId = task?.id ?? null;
  const testInput: Grid | null = task?.test[0]?.input ?? null;
  const worldNum = task?.metadata.world ?? null;

  // Reset per-level state and initialize the answer grid from the test input dims.
  React.useEffect(() => {
    setResult(null);
    setRevealed(false);
    setHints({});
    setHintOpen(false);
    const inp = puzzleQ.data?.task.test[0]?.input;
    setAnswerGrid(inp ? makeGrid(inp.length, inp[0]?.length ?? 0, 0) : null);
  }, [taskId]);

  const submitM = useMutation({
    mutationFn: (opts: { revealIfWrong?: boolean }) => {
      if (!answerGrid) throw new Error('Paint your answer first');
      return api.submit(levelId, { playerId, grid: answerGrid, mode, revealIfWrong: opts.revealIfWrong });
    },
    onSuccess: (data, vars) => {
      setResult(data);
      if (vars.revealIfWrong) setRevealed(true);
      if (data.correct) {
        toast.success(`Solved! +${data.xpAwarded} XP`);
      } else if (data.failed) {
        toast.error('Challenge failed — the answer has been revealed.');
      } else if (data.xpAwarded > 0) {
        toast.error(`Not quite — try again (+${data.xpAwarded} XP for the attempt).`);
      } else {
        toast.error('Wrong answer — one attempt left.');
      }
      void refetchProgress();
      onSettled?.();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Submission failed');
    },
  });

  const hintM = useMutation({
    mutationFn: (tier: number) => api.hint(levelId, { playerId, tier }),
    onSuccess: (data) => {
      setHints((prev) => ({ ...prev, [data.tier]: data.hint }));
      toast.info(`Hint ${data.tier} unlocked`, { description: 'Using hints reduces the XP you earn.' });
      void refetchProgress();
      onSettled?.();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not fetch hint');
    },
  });

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setResult(null);
    setRevealed(false);
  };

  // ---- derived state (plain computations; cheap) --------------------------
  const puzzleProgress = puzzleQ.data?.progress ?? null;
  const solvedBefore = Boolean(puzzleProgress?.solved) || (isDaily && puzzleQ.data?.dailySolved === true);
  const wrongAttempts = result?.wrongAttempts ?? puzzleProgress?.wrongAttempts ?? 0;
  const attemptsUsed = result?.attempts ?? puzzleProgress?.attempts ?? 0;
  const localMaxHintTier = Object.keys(hints).reduce((mx, k) => Math.max(mx, Number(k)), 0);
  const maxHintTier = Math.max(puzzleProgress?.hintsUsed ?? 0, localMaxHintTier);
  const challengeExhausted =
    mode === 'challenge' && !solvedBefore && (result?.failed === true || wrongAttempts >= 2);
  const hintsLockedInChallenge = mode === 'challenge' && result === null;
  const submitDisabled =
    !answerGrid || submitM.isPending || result?.correct === true || challengeExhausted;

  // ---- early exits (after all hooks) --------------------------------------
  if (playerId === '' || puzzleQ.isPending) {
    return <LevelPlaySkeleton isDaily={isDaily} />;
  }

  if (puzzleQ.isError || !task || !testInput) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" aria-hidden />
          <p className="font-semibold">Could not load {isDaily ? 'the daily challenge' : 'this level'}</p>
          <p className="text-sm text-muted-foreground">{puzzleQ.error?.message ?? 'Something went wrong.'}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void puzzleQ.refetch()} className="gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden /> Try again
            </Button>
            <Button variant="ghost" onClick={onExit}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const locked = !isDaily && progress !== null && !progress.unlocks.levels.includes(levelId);
  if (locked) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Lock className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">This level is still locked</p>
          <p className="text-sm text-muted-foreground">Solve the previous level to unlock it — check the world map for what&apos;s available.</p>
          <Button variant="outline" onClick={onExit} className="gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to map
          </Button>
        </CardContent>
      </Card>
    );
  }

  const pairs = (
    <>
      {task.train.map((pair, i) => (
        <PairViewer
          key={i}
          input={pair.input}
          output={pair.output ?? null}
          index={i}
          patterns={patterns}
          labels={['Input', 'Output']}
        />
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onExit} className="mt-0.5 gap-1.5" aria-label={isDaily ? 'Back to the Academy' : 'Back to world map'}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {isDaily ? 'Back' : 'Map'}
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">{task.metadata.title ?? levelId}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isDaily && dateKey && (
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
                <CalendarDays className="h-3 w-3" aria-hidden /> Daily · {dateKey}
              </Badge>
            )}
            {!isDaily && task.metadata.world != null && (
              <Badge variant="secondary">
                World {task.metadata.world} · Level {task.metadata.level}
              </Badge>
            )}
            <Badge variant="outline" className={difficultyClass(task.metadata.difficulty)}>
              {task.metadata.difficulty ?? 'intermediate'}
            </Badge>
            {task.metadata.skills.map((s) => (
              <Badge key={s} variant="secondary" className="font-normal">
                {s}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Attempts used: {attemptsUsed}
              {maxHintTier > 0 ? ` · Max hint tier: ${maxHintTier}` : ''}
            </span>
          </div>
        </div>
        <ModeToggle mode={mode} onChange={switchMode} challengeWrong={mode === 'challenge' ? wrongAttempts : 0} />
      </div>

      {solvedBefore && !isDaily && result?.correct !== true && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-400" role="status">
          <Trophy className="h-4 w-4 shrink-0" aria-hidden /> Already solved — replay for fun (no duplicate XP).
        </div>
      )}

      {/* Examples */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> Study the examples
          </CardTitle>
          <CardDescription>
            {task.train.length} demonstration pair{task.train.length === 1 ? '' : 's'} reveal the hidden transformation rule. Apply the same rule to the
            test input below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {task.train.length > 3 ? (
            <ScrollArea className="max-h-[400px]">
              <div className="grid gap-3 pr-3 md:grid-cols-2">{pairs}</div>
            </ScrollArea>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">{pairs}</div>
          )}
        </CardContent>
      </Card>

      {/* Challenge */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-muted-foreground" aria-hidden /> Solve the test case
          </CardTitle>
          <CardDescription>
            {mode === 'challenge'
              ? 'Challenge mode: you get 2 attempts, worth full XP.'
              : 'Practice mode: unlimited attempts, base 25 XP.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Test input</p>
              <div className="overflow-x-auto rounded-lg border bg-card p-3">
                <GridView grid={testInput} cellSize={22} patterns={patterns} showCoords ariaLabel="Test input grid" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answer</p>
              <div className="overflow-x-auto rounded-lg border bg-card p-3">
                {answerGrid ? (
                  <GridEditor
                    grid={answerGrid}
                    onChange={setAnswerGrid}
                    selectedColor={color}
                    patterns={patterns}
                    copySource={testInput}
                    ariaLabel="Your answer grid editor"
                  />
                ) : (
                  <Skeleton className="h-32 w-48" />
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <ColorPalette selected={color} onSelect={setColor} patterns={patterns} compact />
                <span className="text-xs text-muted-foreground">
                  Selected: <span className="font-semibold text-foreground">{colorName(color)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Result (aria-live so screen readers announce submissions) */}
          <div aria-live="polite">
            {result && (
              <ResultBanner
                result={result}
                revealed={revealed}
                maxHintTier={maxHintTier}
                isDaily={isDaily}
                patterns={patterns}
                answerGrid={answerGrid}
                testInput={testInput}
                onNextLevel={onNextLevel}
                onExit={onExit}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => submitM.mutate({})} disabled={submitDisabled} className="gap-2" aria-label="Submit your answer">
              <Send className="h-4 w-4" aria-hidden />
              {submitM.isPending ? 'Checking…' : 'Submit answer'}
            </Button>

            <Popover open={hintOpen} onOpenChange={setHintOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2" aria-label="Open tiered hints" aria-expanded={hintOpen}>
                  <Lightbulb className="h-4 w-4" aria-hidden /> Hint
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  Hints are tiered and reduce XP: −15 / −30 / −50 by the max tier you use.
                </p>
                {hintsLockedInChallenge && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400" role="note">
                    Hints stay hidden in challenge mode until after your first submission.
                  </p>
                )}
                {HINT_TIERS.map(({ tier, label }) => (
                  <div key={tier} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">
                        Hint {tier} — {label}
                      </p>
                      {!hints[tier] && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={hintsLockedInChallenge || hintM.isPending}
                          onClick={() => hintM.mutate(tier)}
                          aria-label={`Reveal hint ${tier}: ${label}`}
                        >
                          {hintM.isPending ? '…' : 'Reveal'}
                        </Button>
                      )}
                    </div>
                    {hints[tier] && <p className="mt-1.5 text-sm leading-snug">{hints[tier]}</p>}
                  </div>
                ))}
              </PopoverContent>
            </Popover>

            {mode === 'practice' && result?.correct !== true && (
              <Button
                variant="outline"
                onClick={() => submitM.mutate({ revealIfWrong: true })}
                disabled={!answerGrid || submitM.isPending}
                className="gap-2"
                aria-label="Reveal the expected solution (practice only)"
              >
                <Eye className="h-4 w-4" aria-hidden /> Reveal solution
              </Button>
            )}

            {!isDaily && (
              <>
                <Button variant="outline" onClick={() => openInWorkbench(levelId)} className="gap-2" aria-label="Open this puzzle in the Workbench">
                  <Microscope className="h-4 w-4" aria-hidden /> Open in Workbench
                </Button>
                {worldNum != null && (
                  <Button
                    variant="outline"
                    onClick={() => setArenaPreset([worldNum], [levelId])}
                    className="gap-2"
                    aria-label="Run this puzzle in the Arena"
                  >
                    <Swords className="h-4 w-4" aria-hidden /> Run in Arena
                  </Button>
                )}
              </>
            )}
          </div>

          {mode === 'challenge' && !solvedBefore && result?.correct !== true && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {challengeExhausted
                ? 'Challenge failed — switch to Practice mode to keep training on this level.'
                : `Challenge attempts: ${Math.min(wrongAttempts, 2)}/2 wrong used — ${Math.max(0, 2 - wrongAttempts)} attempt${2 - wrongAttempts === 1 ? '' : 's'} remaining.`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
  challengeWrong,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  challengeWrong: number;
}) {
  return (
    <div role="radiogroup" aria-label="Play mode" className="flex shrink-0 rounded-lg border bg-muted p-0.5">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'practice'}
        onClick={() => onChange('practice')}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring',
          mode === 'practice' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Practice
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'challenge'}
        onClick={() => onChange('challenge')}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring',
          mode === 'challenge' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Challenge{mode === 'challenge' && challengeWrong > 0 ? ` (${Math.min(challengeWrong, 2)}/2)` : ''}
      </button>
    </div>
  );
}

function ResultBanner({
  result,
  revealed,
  maxHintTier,
  isDaily,
  patterns,
  answerGrid,
  testInput,
  onNextLevel,
  onExit,
}: {
  result: SubmitResponse;
  revealed: boolean;
  maxHintTier: number;
  isDaily: boolean;
  patterns: boolean;
  answerGrid: Grid | null;
  testInput: Grid;
  onNextLevel: () => void;
  onExit: () => void;
}) {
  const showExpected = result.expected != null;
  const notes = bonusNotes(result, maxHintTier);

  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border p-4',
        result.correct
          ? 'border-emerald-500/40 bg-emerald-500/10'
          : result.failed
            ? 'border-rose-500/40 bg-rose-500/10'
            : revealed
              ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {result.correct ? (
          <>
            <Trophy className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
            <p className="font-bold text-emerald-700 dark:text-emerald-400">Correct!</p>
            {result.xpAwarded > 0 && (
              <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                +{result.xpAwarded} XP
              </Badge>
            )}
            {notes.map((n) => (
              <Badge key={n} variant="secondary">
                {n}
              </Badge>
            ))}
            {!result.firstSolve && <Badge variant="secondary">replay — no duplicate XP</Badge>}
          </>
        ) : result.failed ? (
          <>
            <TriangleAlert className="h-5 w-5 shrink-0 text-rose-500" aria-hidden />
            <p className="font-bold text-rose-700 dark:text-rose-400">Challenge failed — both attempts used</p>
          </>
        ) : revealed ? (
          <>
            <Eye className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-bold text-amber-700 dark:text-amber-400">Solution revealed</p>
          </>
        ) : (
          <>
            <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-bold text-amber-700 dark:text-amber-400">
              {result.mode === 'challenge' ? `Wrong — ${Math.max(0, 2 - result.wrongAttempts)} attempt${2 - result.wrongAttempts === 1 ? '' : 's'} left` : 'Not quite — try again!'}
            </p>
            {result.xpAwarded > 0 && <Badge variant="secondary">+{result.xpAwarded} XP for the attempt</Badge>}
          </>
        )}
      </div>

      {showExpected && (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <PairViewer
            input={testInput}
            output={result.expected}
            candidate={answerGrid}
            showDiff
            patterns={patterns}
            labels={['Test input', 'Expected']}
            className="bg-transparent"
          />
        </div>
      )}

      {result.explanation && (
        <p className="mt-3 rounded-md border bg-card p-3 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">How it works: </span>
          {result.explanation}
        </p>
      )}

      {result.correct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isDaily ? (
            <Button onClick={onExit} className="gap-2">
              Back to the Academy <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={onNextLevel} className="gap-2">
              Next level <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {!isDaily && (
            <Button variant="outline" onClick={onExit}>
              World map
            </Button>
          )}
        </div>
      )}

      {result.failed && (
        <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-400">
          Switch to Practice mode (top right) to keep training on this level.
        </p>
      )}
    </div>
  );
}

function LevelPlaySkeleton({ isDaily }: { isDaily: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={`Loading ${isDaily ? 'daily challenge' : 'level'}`}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-20 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <Card>
        <CardContent className="space-y-3 py-5">
          <Skeleton className="h-5 w-44" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-6 py-5 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </CardContent>
      </Card>
    </div>
  );
}
