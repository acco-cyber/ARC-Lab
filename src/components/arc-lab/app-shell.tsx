'use client';

/**
 * ARC Lab — application shell: header nav, main content, sticky footer.
 * Single-page experience switching between Home, Academy, Workbench, Arena, Guide.
 */

import React from 'react';
import { GraduationCap, Home, Microscope, Swords, BookOpen, Sparkles, Flame, Layers, Bot } from 'lucide-react';
import { useArcLab, type TabId } from '@/lib/store/arc-lab';
import { usePlayerId, useProgress } from './providers';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';

const AcademyView = dynamic(() => import('@/components/academy/academy-view'), {
  loading: () => <SectionLoader label="Loading Academy…" />,
});
const WorkbenchView = dynamic(() => import('@/components/workbench/workbench-view'), {
  loading: () => <SectionLoader label="Loading Workbench…" />,
});
const ArenaView = dynamic(() => import('@/components/arena/arena-view'), {
  loading: () => <SectionLoader label="Loading Arena…" />,
});
const AgentLab = dynamic(() => import('@/components/agent/agent-lab'), {
  loading: () => <SectionLoader label="Loading Agent Lab…" />,
});

function SectionLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-3 text-muted-foreground" role="status" aria-live="polite">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'home', label: 'Home', icon: <Home className="h-4 w-4" /> },
  { id: 'academy', label: 'Academy', icon: <GraduationCap className="h-4 w-4" /> },
  { id: 'workbench', label: 'Workbench', icon: <Microscope className="h-4 w-4" /> },
  { id: 'agent', label: 'Agent Lab', icon: <Bot className="h-4 w-4" /> },
  { id: 'arena', label: 'Arena', icon: <Swords className="h-4 w-4" /> },
  { id: 'guide', label: 'Guide', icon: <BookOpen className="h-4 w-4" /> },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5" aria-hidden>
      <div className="grid grid-cols-2 gap-[3px] rounded-md bg-foreground/85 p-[4px]">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#FF4136]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#2ECC40]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#FFDC00]" />
        <span className="h-2.5 w-2.5 rounded-[2px] bg-[#F012BE]" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-extrabold tracking-tight">ARC Lab</p>
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Reasoning Laboratory</p>
      </div>
    </div>
  );
}

function XpChip() {
  const progress = useArcLab((s) => s.progress);
  if (!progress) return null;
  return (
    <div className="hidden items-center gap-3 rounded-full border bg-card px-3 py-1.5 sm:flex" aria-label={`XP ${progress.xp}, level ${progress.levelInfo.level}`}>
      <span className="flex items-center gap-1 text-xs font-bold text-amber-500 dark:text-amber-400">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {progress.xp} XP
      </span>
      <span className="h-3 w-px bg-border" aria-hidden />
      <span className="text-xs text-muted-foreground">
        Lv {progress.levelInfo.level} · {progress.levelInfo.title}
      </span>
      {progress.streak > 0 && (
        <>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="flex items-center gap-0.5 text-xs font-bold text-orange-500">
            <Flame className="h-3.5 w-3.5" aria-hidden />
            {progress.streak}
          </span>
        </>
      )}
    </div>
  );
}

export default function AppShell() {
  const tab = useArcLab((s) => s.tab);
  const setTab = useArcLab((s) => s.setTab);
  const patterns = useArcLab((s) => s.patterns);
  const togglePatterns = useArcLab((s) => s.togglePatterns);
  usePlayerId();
  useProgress();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
          <button type="button" onClick={() => setTab('home')} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring" aria-label="ARC Lab home">
            <Logo />
          </button>
          <nav aria-label="Primary">
            <ul className="flex items-center gap-0.5 sm:gap-1">
              {TABS.map((t) => (
                <li key={t.id}>
                  <Button
                    variant={tab === t.id ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    title={t.label}
                    className={cn('gap-1.5 px-2 sm:px-3', tab === t.id && 'font-semibold')}
                  >
                    {t.icon}
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sr-only sm:hidden">{t.label}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <Switch checked={patterns} onCheckedChange={(v) => togglePatterns(v)} aria-label="Color-blind friendly patterns" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Color-blind friendly grid patterns</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <XpChip />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-6">
        {tab === 'home' && <HomeView />}
        {tab === 'academy' && <AcademyView />}
        {tab === 'workbench' && <WorkbenchView />}
        {tab === 'agent' && <AgentLab />}
        {tab === 'arena' && <ArenaView />}
        {tab === 'guide' && <GuideView />}
      </main>

      <footer className="mt-auto border-t bg-card/50 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-3 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>
            <span className="font-semibold text-foreground">ARC Lab</span> — an interactive laboratory for Abstract Reasoning. Learn · Debug · Benchmark.
          </p>
          <p className="flex items-center gap-2">
            <span>Built for the ARC-AGI era (ARC-1 / ARC-2 compatible, ARC-3 ready schema)</span>
            <span aria-hidden>·</span>
            <span>Puzzles are original & synthetic (arc-lab-curriculum-v1)</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home (hero)
// ---------------------------------------------------------------------------

import { useArcLab as useStoreRef } from '@/lib/store/arc-lab';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';

function HomeView() {
  const setTab = useStoreRef((s) => s.setTab);
  const progress = useStoreRef((s) => s.progress);
  const solved = progress?.levels.filter((l) => l.solved).length ?? 0;

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-6 py-10 sm:px-10 sm:py-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(128,128,128,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,.6) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden
        />
        <div className="relative max-w-3xl space-y-4">
          <Badge variant="outline" className="flex w-fit flex-wrap gap-1 whitespace-normal border-amber-500/50 text-amber-600 dark:text-amber-400">
            <Sparkles className="h-3 w-3 shrink-0" /> 100 levels · 1,120 official ARC-AGI-2 puzzles · notebooks as agents · 1 shared reasoning core
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            Learn to reason. <span className="text-emerald-500">Watch agents reason.</span> Benchmark it.
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            ARC Lab is an interactive laboratory for the Abstraction and Reasoning Corpus. Solve grid puzzles level by level in the{' '}
            <strong className="text-foreground">Academy</strong>, inspect and build transformation programs in the{' '}
            <strong className="text-foreground">Workbench</strong>, watch AI agents play the game in the{' '}
            <strong className="text-foreground">Agent Lab</strong>, and run reproducible solver evaluations in the{' '}
            <strong className="text-foreground">Arena</strong> — all on one shared ARC core.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="lg" onClick={() => setTab('academy')} className="gap-2">
              Start solving <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="lg" variant="outline" onClick={() => setTab('agent')} className="gap-2">
              <Bot className="h-4 w-4" aria-hidden /> Watch an agent play
            </Button>
            <Button size="lg" variant="outline" onClick={() => setTab('arena')}>
              Run the Arena
            </Button>
          </div>
          {progress && (
            <p className="pt-2 text-xs text-muted-foreground" aria-live="polite">
              Your progress: {solved}/100 levels · {progress.xp} XP · {progress.badges.filter((b) => b.earned).length} badges
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="The four experiences">
        <ExperienceCard
          emoji="🎓"
          title="ARC Academy"
          subtitle="The playable puzzle game"
          body="10 worlds × 10 levels teaching real ARC skills: copying, objects, geometry, symmetry, color logic, object motion, rule composition, context, program inference and grandmaster mixes. Hints, XP, badges and a daily challenge — no ML background required."
          cta="Enter the Academy"
          onClick={() => setTab('academy')}
        />
        <ExperienceCard
          emoji="🔬"
          title="ARC Workbench"
          subtitle="The visual reasoning debugger"
          body="Load any puzzle, detect objects with overlays, compose transformation programs from a 20-op DSL, search for consistent programs, and step through execution traces cell by cell. Import and export standard ARC JSON."
          cta="Open the Workbench"
          onClick={() => setTab('workbench')}
        />
        <ExperienceCard
          emoji="🤖"
          title="Agent Lab"
          subtitle="Watch AI agents play the game"
          body="Pick a puzzle and watch built-in heuristics, the real acco-cyber/ARC-AGI-2 symbolic engine, or LLM program-synthesizers reason through it step by step. Plug in your own agent as JS or an HTTP endpoint, and batch-test with honest metrics."
          cta="Open the Agent Lab"
          onClick={() => setTab('agent')}
        />
        <ExperienceCard
          emoji="⚔️"
          title="ARC Arena"
          subtitle="The reproducible evaluation platform"
          body="Run copy-input, rule-based, program-search, ensemble and LLM adapters against standardized tasks. Compare exact accuracy, pass@2, pixel accuracy, runtime and a failure taxonomy. Export reproducible run manifests."
          cta="Enter the Arena"
          onClick={() => setTab('arena')}
        />
      </section>

      <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground" aria-label="Integration statement">
        <p className="font-semibold text-foreground">One integrated workflow</p>
        <p className="mt-1">
          Solve a puzzle by hand in the Academy → open the same task in the Workbench and build the rule as a program → send it to the Agent Lab and watch
          machines attempt it — including your own solver → run full evaluations in the Arena → compare your human trace with the agents'. Every puzzle is
          inspectable and every experiment is exportable.
        </p>
      </section>
    </div>
  );
}

function ExperienceCard(props: { emoji: string; title: string; subtitle: string; body: string; cta: string; onClick: () => void }) {
  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="text-3xl" aria-hidden>
          {props.emoji}
        </div>
        <CardTitle className="text-lg">{props.title}</CardTitle>
        <CardDescription>{props.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="mb-4 text-sm text-muted-foreground">{props.body}</p>
        <Button variant="outline" onClick={props.onClick} className="w-full gap-2">
          {props.cta} <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

function GuideView() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">ARC Lab Guide</h1>
        <p className="mt-1 text-sm text-muted-foreground">How the four experiences fit together, how to import ARC data, how agents plug in, and how the evaluation is scored.</p>
      </div>
      <Accordion type="multiple" defaultValue={['what', 'academy', 'workbench', 'agent', 'arena', 'data', 'schema']}>
        <AccordionItem value="what">
          <AccordionTrigger>What is ARC?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The Abstraction and Reasoning Corpus (ARC) is a benchmark of visual reasoning puzzles: each task shows a few input→output grid examples
              demonstrating a hidden rule, and asks you to apply that rule to a new input. Grids are matrices of integers 0–9. ARC-AGI measures how
              well systems can acquire new skills from few examples.
            </p>
            <p>ARC Lab teaches humans the same skills and gives researchers tools to inspect, build and benchmark rule-finding systems.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="academy">
          <AccordionTrigger>How does the Academy work?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li>10 worlds teach specific skills, each with 10 levels (100 total). Levels unlock sequentially; a world unlocks after 5 solves in the previous one.</li>
              <li>Study the example pairs, then paint your answer in the grid editor (click/drag, resize, undo, copy-input). Submit to check.</li>
              <li>Hints have 3 tiers: what changed? → transformation clue → worked explanation. Using hints reduces XP.</li>
              <li>Challenge mode allows 2 attempts (like the ARC two-guess convention); practice mode is unrestricted with lower XP.</li>
              <li>A new deterministic daily puzzle appears every day (Asia/Dhaka). Streaks and badges track your consistency.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="workbench">
          <AccordionTrigger>What can I do in the Workbench?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li>Examples: inspect every demonstration pair side by side.</li>
              <li>Objects: detect connected components (4/8-connectivity) with bounding-box overlays and per-object properties (size, color, symmetry, border contact). Detections are heuristic, not ground truth.</li>
              <li>Program: compose ops (rotate, flip, transpose, shift, scale, tile, crop, frame, recolor, swap, keep-largest, gravity…) and execute them on all demonstrations to check consistency, then apply to the test input.</li>
              <li>Search: bounded program search enumerates the DSL and ranks candidates by consistency and simplicity.</li>
              <li>Trace: step through the program operation by operation to see exactly where it diverges.</li>
              <li>Import/export native ARC JSON (ARC-AGI-1/2 files load directly; unknown fields are preserved for forward compatibility).</li>
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="arena">
          <AccordionTrigger>How is the Arena scored?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li><strong className="text-foreground">Exact accuracy</strong> — task solved with a perfectly matching grid (primary metric).</li>
              <li><strong className="text-foreground">Pass@2</strong> — solved by either of the solver's two candidates.</li>
              <li><strong className="text-foreground">Pixel accuracy</strong> — diagnostic only; a solver can score high here and still fail exact match.</li>
              <li><strong className="text-foreground">Runtime</strong> — wall-clock per task; efficiency is a first-class measurement.</li>
              <li><strong className="text-foreground">Failure taxonomy</strong> — no-prediction / shape-mismatch / color-mismatch / cell-errors.</li>
              <li>Runs persist with dataset version, solver set, scope and timestamp, and can be exported as reproducible JSON manifests.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="agent">
          <AccordionTrigger>What can agents do in the Agent Lab?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li><strong className="text-foreground">Watch agents play</strong> — pick any puzzle and an agent, then watch its reasoning trace and the answer being painted cell by cell, followed by honest scoring (exact match, pass@2, pixel accuracy).</li>
              <li><strong className="text-foreground">Notebook agent</strong> — drop in a real Jupyter notebook (.ipynb) by URL or upload. ARC Lab analyzes it (cells, dependencies, GPU needs, entrypoints, methodology), executes its cells in a python3 sandbox, probes for a solver entrypoint verified against the demonstrations, and — when the notebook needs GPU-only deps like vLLM — replays the notebook's own verified-program-synthesis methodology with its vendored helper toolkit and an LLM backend. Try it with <code className="rounded bg-muted px-1">acco-cyber/ARC-AGI-2</code>'s <code className="rounded bg-muted px-1">arc2-qwen-solo.ipynb</code> (prefilled).</li>
              <li><strong className="text-foreground">Official ARC-AGI-2 puzzles, always fresh</strong> — the full official set (1,000 training + 120 public evaluation tasks, vendored from github.com/arcprize/ARC-AGI-2 — the same public data as the Kaggle ARC Prize 2026 competition and arcprize.org) is playable. The server tracks every puzzle an agent has been served and <strong className="text-foreground">never serves the same puzzle twice</strong> — every run is a brand-new puzzle. Reset the history per agent whenever you want to start over.</li>
              <li><strong className="text-foreground">arc-jepa engine</strong> — the real symbolic solver from acco-cyber/ARC-AGI-2 runs inside ARC Lab (induction → DSL beam search → repair → A* → evolution), so you can test the exact code from that repository.</li>
              <li><strong className="text-foreground">APEX-style synthesizer</strong> — replicates the Phase-B methodology of that repo: the LLM writes programs, each program must reproduce every example exactly, with repair rounds and a direct-grid fallback.</li>
              <li><strong className="text-foreground">Plug in your own agent</strong> — paste a JavaScript solver (sandboxed in a Web Worker, auto-verified on the examples) or point at an HTTP endpoint that implements your own backend.</li>
              <li><strong className="text-foreground">Batch tests</strong> — run any agent over a deterministic curriculum sample and read the summary (solved, pass@2, pixel accuracy, runtime).</li>
              <li>Agents never see the expected test output before predicting — official-task answers stay server-side and are revealed only after the agent commits its prediction. The same rule as the Arena.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="data">
          <AccordionTrigger>Dataset & licensing policy</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The Academy curriculum is fully original and synthetic (dataset <code className="rounded bg-muted px-1">arc-lab-curriculum-v1</code>),
              generated deterministically from per-level seeds — the game never reuses official tasks, so human exposure cannot contaminate
              benchmark interpretation.
            </p>
            <p>
              The <strong className="text-foreground">Agent Lab</strong> (and the Workbench loader) additionally vendors the complete public
              ARC-AGI-2 set — 1,000 training + 120 public evaluation tasks from <code className="rounded bg-muted px-1">github.com/arcprize/ARC-AGI-2</code>
              (Apache-2.0), identical to the public splits of the Kaggle ARC Prize 2026 competition data and the tasks shown on arcprize.org. These
              are used strictly for agent evaluation with a never-repeat serving queue; the semi-private and fully-private competition sets are not
              public anywhere and are not included.
            </p>
            <p>You can import official or third-party ARC JSON files into the Workbench and Arena yourself — imported tasks stay local to your session and are clearly labeled as user imports.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="schema">
          <AccordionTrigger>ARC-AGI-2 / ARC-AGI-3 compatibility</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The task schema accepts the standard ARC JSON (<code className="rounded bg-muted px-1">{`{train:[{input,output}],test:[{input,output?}]}`}</code>)
              with arbitrary schema_version strings and unknown extra fields preserved — files from the ARC-AGI-1/2 era load as-is, and the same
              tolerance keeps the lab ready for ARC-AGI-3's evolving formats. All grid semantics live in one TypeScript core shared by the game, the
              debugger and the solvers, so behavior is identical across experiences.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
