'use client';

/**
 * ARC Lab — Agent Lab.
 *
 * Watch AI agents play ARC puzzles, plug in your own agent (JavaScript in a
 * browser worker or an HTTP endpoint), and batch-test agents — including the
 * real acco-cyber/ARC-AGI-2 engine vendored into this project — over the
 * curriculum with honest metrics and a persistent scoreboard.
 */

import React from 'react';
import { Bot, FlaskConical, Loader2, Play, RefreshCw, Shuffle, Sparkles, Trophy, Upload } from 'lucide-react';
import { AGENTS, getAgent, loadAgentScores, saveAgentScore, type AgentScoreEntry } from '@/lib/arc/agents';
import { LEVELS, levelTask, WORLDS } from '@/lib/arc/curriculum';
import { validateArcJson, type Task } from '@/lib/arc/types';
import { useArcLab } from '@/lib/store/arc-lab';
import { usePlayerId } from '@/components/arc-lab/providers';
import AgentPlay from './agent-play';
import NotebookAgent from './notebook-agent';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<string, string> = {
  builtin: 'built-in',
  engine: 'python engine',
  llm: 'LLM',
  custom: 'yours',
};

interface BatchRow {
  taskId: string;
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  elapsedMs: number;
  error?: string;
}

interface AgentAggregate {
  agentId: string;
  runs: number;
  solved: number;
  pass2: number;
  avgMs: number;
}

interface OfficialMeta {
  dataset: 'training' | 'evaluation';
  freshNumber: number;
  seen: number;
  total: number;
}

export default function AgentLab() {
  const patterns = useArcLab((s) => s.patterns);
  const playerId = usePlayerId();
  const [agentId, setAgentId] = React.useState('arcjepa-engine');
  const [world, setWorld] = React.useState(1);
  const [levelIdx, setLevelIdx] = React.useState(0);
  const [imported, setImported] = React.useState<Task | null>(null);
  const [importText, setImportText] = React.useState('');
  const [importError, setImportError] = React.useState<string | null>(null);

  // official ARC-AGI-2 fresh-puzzle flow
  const [srcTab, setSrcTab] = React.useState('curriculum');
  const [officialTask, setOfficialTask] = React.useState<Task | null>(null);
  const [officialMeta, setOfficialMeta] = React.useState<OfficialMeta | null>(null);
  const [officialDataset, setOfficialDataset] = React.useState<'training' | 'evaluation'>('training');
  const [officialBusy, setOfficialBusy] = React.useState(false);
  const [officialMsg, setOfficialMsg] = React.useState<string | null>(null);

  // per-agent config
  const [customCode, setCustomCode] = React.useState('');
  const [endpointUrl, setEndpointUrl] = React.useState('');
  const [engineSeconds, setEngineSeconds] = React.useState(15);

  // batch test
  const [batchRunning, setBatchRunning] = React.useState(false);
  const [batchRows, setBatchRows] = React.useState<BatchRow[]>([]);
  const [batchProgress, setBatchProgress] = React.useState(0);

  // scoreboard
  const [scores, setScores] = React.useState<AgentScoreEntry[]>([]);

  React.useEffect(() => setScores(loadAgentScores()), []);

  const agent = getAgent(agentId) ?? AGENTS[0];
  const worldLevels = React.useMemo(() => LEVELS.filter((l) => l.world === world), [world]);
  const level = worldLevels[Math.min(levelIdx, worldLevels.length - 1)] ?? LEVELS[0];
  const task = React.useMemo(() => {
    if (imported) return imported;
    if (officialTask) return officialTask;
    try {
      return levelTask(level.id, { reveal: true });
    } catch {
      return null;
    }
  }, [imported, officialTask, level.id]);

  const serveFreshPuzzle = React.useCallback(async () => {
    if (!playerId || officialBusy) return;
    setOfficialBusy(true);
    setOfficialMsg(null);
    try {
      const res = await fetch(
        `/api/official/next?playerId=${encodeURIComponent(playerId)}&agentId=${encodeURIComponent(agent.id)}&dataset=${officialDataset}`,
        { cache: 'no-store' },
      );
      const data = (await res.json()) as {
        exhausted?: boolean;
        message?: string;
        dataset?: 'training' | 'evaluation';
        taskId?: string;
        freshNumber?: number;
        seen?: number;
        total?: number;
        task?: Task;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
      if (data.exhausted) {
        setOfficialTask(null);
        setOfficialMeta(null);
        setOfficialMsg(data.message ?? 'All puzzles seen for this agent.');
        return;
      }
      if (data.task) {
        setOfficialTask(data.task);
        setOfficialMeta({ dataset: data.dataset ?? officialDataset, freshNumber: data.freshNumber ?? 1, seen: data.seen ?? 0, total: data.total ?? 0 });
        setImported(null);
      }
    } catch (err) {
      setOfficialMsg(err instanceof Error ? err.message : 'failed to fetch a fresh puzzle');
    } finally {
      setOfficialBusy(false);
    }
  }, [playerId, officialBusy, agent.id, officialDataset]);

  const config: Record<string, unknown> = React.useMemo(() => {
    if (agentId === 'custom-js') return { code: customCode };
    if (agentId === 'custom-endpoint') return { endpoint: endpointUrl };
    if (agentId === 'arcjepa-engine') return { perTaskSeconds: engineSeconds };
    return {};
  }, [agentId, customCode, endpointUrl, engineSeconds]);

  const handleScored = React.useCallback(
    (s: { agentId: string; taskId: string; elapsedMs: number; exact: boolean | null; pass2: boolean | null; pixelAcc: number | null }) => {
      const entry: AgentScoreEntry = { ...s, at: new Date().toISOString() };
      saveAgentScore(entry);
      setScores(loadAgentScores());
    },
    [],
  );

  function importJson() {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText);
      const res = validateArcJson(parsed, imported?.id ?? 'imported-task');
      if (!res.ok || !res.task) {
        setImportError(res.errors.slice(0, 3).join('; '));
        return;
      }
      if (res.task.metadata.source === 'user-import') res.task.metadata.source = 'user-import';
      setImported(res.task);
    } catch (err) {
      setImportError(`Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`);
    }
  }

  // ── batch test: run the selected agent over a deterministic sample of tasks
  async function runBatch() {
    if (batchRunning) return;
    const cap = agent.kind === 'engine' ? 8 : agent.kind === 'llm' ? 5 : 12;
    const step = Math.max(1, Math.floor(LEVELS.length / cap));
    const chosen: string[] = [];
    for (let i = 0; i < LEVELS.length && chosen.length < cap; i += step) chosen.push(LEVELS[i].id);

    setBatchRunning(true);
    setBatchRows([]);
    setBatchProgress(0);
    for (let i = 0; i < chosen.length; i++) {
      const id = chosen[i];
      try {
        const t = levelTask(id, { reveal: true });
        const payload = {
          train: t.train.map((p) => ({ input: p.input, output: p.output ?? undefined })),
          testInputs: t.test.map((p) => p.input),
          config,
        };
        const res = await agent.run(payload);
        const expected = t.test[0]?.output ?? null;
        const pred = res.attempts[0]?.[0] ?? null;
        let exact: boolean | null = null;
        let pass2: boolean | null = null;
        let pixelAcc: number | null = null;
        if (expected && pred) {
          const shapeOk = pred.length === expected.length && pred[0]?.length === expected[0]?.length;
          let diff = expected.length * expected[0].length;
          if (shapeOk) {
            diff = 0;
            for (let r = 0; r < expected.length; r++) for (let c = 0; c < expected[r].length; c++) if (pred[r][c] !== expected[r][c]) diff++;
          }
          exact = shapeOk && diff === 0;
          pass2 = res.attempts[0]?.some((p) => p && p.length === expected.length && p[0]?.length === expected[0]?.length && p.every((row, r) => row.every((c, ci) => c === expected[r][ci]))) ?? false;
          pixelAcc = shapeOk ? 1 - diff / (expected.length * expected[0].length) : 0;
        }
        setBatchRows((rows) => [...rows, { taskId: id, exact, pass2, pixelAcc, elapsedMs: res.elapsedMs, error: res.error }]);
      } catch (err) {
        setBatchRows((rows) => [...rows, { taskId: id, exact: false, pass2: false, pixelAcc: 0, elapsedMs: 0, error: err instanceof Error ? err.message : 'error' }]);
      }
      setBatchProgress(Math.round(((i + 1) / chosen.length) * 100));
    }
    setBatchRunning(false);
  }

  const batchSummary = React.useMemo(() => {
    if (batchRows.length === 0) return null;
    const solved = batchRows.filter((r) => r.exact === true).length;
    const pass2 = batchRows.filter((r) => r.pass2 === true).length;
    const accs = batchRows.filter((r) => r.pixelAcc !== null);
    const avgAcc = accs.length > 0 ? accs.reduce((s, r) => s + (r.pixelAcc ?? 0), 0) / accs.length : null;
    const avgMs = batchRows.reduce((s, r) => s + r.elapsedMs, 0) / batchRows.length;
    return { total: batchRows.length, solved, pass2, avgAcc, avgMs };
  }, [batchRows]);

  const aggregates: AgentAggregate[] = React.useMemo(() => {
    const byAgent = new Map<string, AgentAggregate>();
    for (const s of scores) {
      const a = byAgent.get(s.agentId) ?? { agentId: s.agentId, runs: 0, solved: 0, pass2: 0, avgMs: 0 };
      a.runs++;
      if (s.exact) a.solved++;
      if (s.pass2) a.pass2++;
      a.avgMs += s.elapsedMs;
      byAgent.set(s.agentId, a);
    }
    return [...byAgent.values()].map((a) => ({ ...a, avgMs: a.avgMs / Math.max(1, a.runs) })).sort((a, b) => b.solved - a.solved || b.pass2 - a.pass2);
  }, [scores]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Agent Lab</h1>
          <Badge variant="outline" className="gap-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
            <Bot className="h-3 w-3" /> let agents play the game
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pick a puzzle, pick an agent, and watch it reason through the puzzle step by step — then paint its answer and score it against the held-out
          solution. Plug in your own agent as JavaScript or an HTTP endpoint, and batch-test agents (including the vendored{' '}
          <strong className="text-foreground">acco-cyber/ARC-AGI-2</strong> engine) with reproducible metrics.
        </p>
      </header>

      <NotebookAgent playerId={playerId} />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ──────────── left column: agent registry + task picker ──────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">1 · Choose an agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAgentId(a.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    a.id === agentId ? 'border-emerald-500/60 bg-emerald-500/5' : 'hover:bg-muted/50',
                  )}
                  aria-pressed={a.id === agentId}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl" aria-hidden>{a.emoji}</span>
                    <span className="text-sm font-bold">{a.name}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">{KIND_LABEL[a.kind]}</Badge>
                    {a.slow && <span className="text-[10px] text-muted-foreground">slow</span>}
                  </div>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{a.description}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* agent config */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Agent settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {agentId === 'arcjepa-engine' && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="engine-seconds" className="text-xs">Engine time budget</Label>
                    <span className="text-xs font-bold">{engineSeconds}s</span>
                  </div>
                  <Slider id="engine-seconds" min={5} max={45} step={5} value={[engineSeconds]} onValueChange={(v) => setEngineSeconds(v[0])} />
                  <p className="text-xs text-muted-foreground">
                    Runs <code className="rounded bg-muted px-1">engine/arcjepa_agent.py</code> — your real solver (induction → beam → repair → A* →
                    evolution), CPU mode.
                  </p>
                </>
              )}
              {agentId === 'custom-js' && (
                <>
                  <Label htmlFor="agent-code" className="text-xs">Your solver — function body</Label>
                  <Textarea
                    id="agent-code"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    placeholder={'return H.recolor(testInput, { 1: 3 });'}
                    className="min-h-[120px] font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Body of <code className="rounded bg-muted px-1">solve(train, testInput, H)</code>. Helpers: rot90/flipH/flipV/transpose/recolor/shift/
                    cropToContent. Runs sandboxed; auto-verified on every example.
                  </p>
                </>
              )}
              {agentId === 'custom-endpoint' && (
                <>
                  <Label htmlFor="agent-endpoint" className="text-xs">Endpoint URL</Label>
                  <Input id="agent-endpoint" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="http://localhost:8000/solve" className="font-mono text-xs" />
                  <p className="text-xs text-muted-foreground">
                    POST <code className="rounded bg-muted px-1">{`{train, testInputs}`}</code> → reply{' '}
                    <code className="rounded bg-muted px-1">{`{attempts: [[grid,…]]}`}</code> or{' '}
                    <code className="rounded bg-muted px-1">{`{prediction: grid}`}</code>. Wrap your ARC-AGI-2 vLLM solver in a tiny HTTP shim and connect
                    it here.
                  </p>
                </>
              )}
              {(agentId === 'apex-synthesizer' || agentId === 'glm-direct') && (
                <p className="text-xs text-muted-foreground">
                  Uses the built-in LLM adapter. {agentId === 'apex-synthesizer' ? 'Programs are verified against every example before acceptance; direct fallback only as a last resort.' : 'Direct answers — fast but unverified.'}
                </p>
              )}
              {(agentId === 'copy-bot' || agentId === 'rule-sniffer' || agentId === 'program-searcher') && (
                <p className="text-xs text-muted-foreground">Deterministic client-side agent — no configuration needed.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">2 · Choose a puzzle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <Tabs value={srcTab} onValueChange={(v) => { setSrcTab(v); if (v !== 'official') { setOfficialTask(null); setOfficialMeta(null); setOfficialMsg(null); } if (v !== 'import') setImported(null); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="curriculum" className="flex-1 text-xs">Curriculum</TabsTrigger>
                  <TabsTrigger value="official" className="flex-1 text-xs">Official ARC-AGI-2</TabsTrigger>
                  <TabsTrigger value="import" className="flex-1 text-xs">Import JSON</TabsTrigger>
                </TabsList>
                <TabsContent value="official" className="space-y-3 pt-3">
                  <Select value={officialDataset} onValueChange={(v) => { setOfficialDataset(v as 'training' | 'evaluation'); setOfficialTask(null); setOfficialMeta(null); setOfficialMsg(null); }}>
                    <SelectTrigger aria-label="Official dataset"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="training">Training — 1,000 tasks</SelectItem>
                      <SelectItem value="evaluation">Public evaluation — 120 tasks</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={() => void serveFreshPuzzle()} disabled={officialBusy} className="w-full gap-2">
                    {officialBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />}
                    Serve me a NEW puzzle
                  </Button>
                  {officialMeta && (
                    <div className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs">
                      <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                        <RefreshCw className="h-3 w-3" aria-hidden /> fresh #{officialMeta.freshNumber} · {officialMeta.seen}/{officialMeta.total} seen by {agent.name}
                      </p>
                      <p className="text-muted-foreground">Never repeated: the server excludes every puzzle this agent has already been served. Answers stay server-side until the agent commits its prediction.</p>
                    </div>
                  )}
                  {officialTask && (
                    <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => void serveFreshPuzzle()} disabled={officialBusy}>
                      <Shuffle className="h-3.5 w-3.5" aria-hidden /> Next fresh puzzle
                    </Button>
                  )}
                  {officialMsg && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">{officialMsg}</p>}
                  <p className="text-xs text-muted-foreground">The official ARC-AGI-2 set from github.com/arcprize/ARC-AGI-2 — identical to the Kaggle ARC Prize 2026 public data and the tasks on arcprize.org.</p>
                </TabsContent>
                <TabsContent value="curriculum" className="space-y-3 pt-3">
                  <Select value={String(world)} onValueChange={(v) => { setWorld(Number(v)); setLevelIdx(0); }}>
                    <SelectTrigger aria-label="World"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORLDS.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {String(w.id).padStart(2, '0')} · {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-5 gap-1.5">
                    {worldLevels.map((l, i) => (
                      <Button key={l.id} variant={i === levelIdx ? 'default' : 'outline'} size="sm" className="h-8 px-0 text-xs" onClick={() => { setLevelIdx(i); setImported(null); setOfficialTask(null); setOfficialMeta(null); }} aria-label={`Level ${i + 1}`}>
                        {i + 1}
                      </Button>
                    ))}
                  </div>
                  {level && <p className="text-xs text-muted-foreground">{level.title} · {level.worldDifficulty} · {level.skills.join(', ')}</p>}
                </TabsContent>
                <TabsContent value="import" className="space-y-2 pt-3">
                  <Textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder='{"train":[{"input":[[0,1]],"output":[[1,0]]}],"test":[{"input":[[2,0]]}]}'
                    className="min-h-[100px] font-mono text-[11px]"
                    spellCheck={false}
                    aria-label="ARC JSON task"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={importJson} className="gap-1.5">
                      <Upload className="h-3.5 w-3.5" aria-hidden /> Load task
                    </Button>
                    {imported && (
                      <Button size="sm" variant="ghost" onClick={() => { setImported(null); setImportText(''); }}>
                        Use curriculum instead
                      </Button>
                    )}
                  </div>
                  {importError && <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>}
                  {imported && <p className="text-xs text-emerald-600 dark:text-emerald-400">Loaded {imported.id} — schema {imported.schemaVersion}</p>}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* ──────────── right column: play + batch + scoreboard ──────────── */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              {task ? (
                <AgentPlay
                  key={`${task.id}-${agent.id}-${officialMeta?.freshNumber ?? 'local'}`}
                  task={task}
                  agent={agent}
                  config={config}
                  patterns={patterns}
                  onScored={handleScored}
                  remote={officialTask && officialMeta ? { dataset: officialMeta.dataset, agentId: agent.id, playerId } : undefined}
                  onRemoteScored={() => setOfficialMeta((m) => (m ? { ...m, seen: m.seen + 1 } : m))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Select a puzzle to begin.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <FlaskConical className="h-4 w-4" aria-hidden /> Batch test this agent
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <p className="text-xs text-muted-foreground">
                Runs <strong className="text-foreground">{agent.name}</strong> over a deterministic sample of curriculum levels and scores it against the
                held-out answers. {agent.kind === 'engine' ? '8 levels × up to 45s each — this is the real acco-cyber/ARC-AGI-2 engine under test.' : agent.kind === 'llm' ? '5 levels (LLM calls are rate-limited).' : '12 levels, fully local.'}
              </p>
              <Button onClick={runBatch} disabled={batchRunning} className="gap-2">
                {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {batchRunning ? `Testing… ${batchProgress}%` : 'Run batch test'}
              </Button>
              {batchSummary && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
                  <Stat label="Solved (exact)" value={`${batchSummary.solved}/${batchSummary.total}`} />
                  <Stat label="Pass@2" value={`${batchSummary.pass2}/${batchSummary.total}`} />
                  <Stat label="Avg pixel acc" value={batchSummary.avgAcc !== null ? `${(batchSummary.avgAcc * 100).toFixed(1)}%` : '—'} />
                  <Stat label="Avg time" value={`${(batchSummary.avgMs / 1000).toFixed(2)}s`} />
                </div>
              )}
              {batchRows.length > 0 && (
                <ScrollArea className="max-h-56 rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 text-xs">Task</TableHead>
                        <TableHead className="h-8 text-xs">Exact</TableHead>
                        <TableHead className="h-8 text-xs">Pass@2</TableHead>
                        <TableHead className="h-8 text-xs">Pixel</TableHead>
                        <TableHead className="h-8 text-xs">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchRows.map((r) => (
                        <TableRow key={r.taskId}>
                          <TableCell className="py-1.5 font-mono text-xs">{r.taskId}</TableCell>
                          <TableCell className="py-1.5 text-xs">{r.exact === null ? '—' : r.exact ? '✔' : '✘'}</TableCell>
                          <TableCell className="py-1.5 text-xs">{r.pass2 === null ? '—' : r.pass2 ? '✔' : '✘'}</TableCell>
                          <TableCell className="py-1.5 text-xs">{r.pixelAcc !== null ? `${(r.pixelAcc * 100).toFixed(0)}%` : '—'}</TableCell>
                          <TableCell className="py-1.5 text-xs">{(r.elapsedMs / 1000).toFixed(2)}s</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Trophy className="h-4 w-4" aria-hidden /> Agent scoreboard
                <span className="ml-auto text-[10px] font-normal normal-case">from your watch sessions (stored locally)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {aggregates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agent runs scored yet. Watch an agent play a curriculum puzzle to fill the board.</p>
              ) : (
                <div className="space-y-2">
                  {aggregates.map((a) => {
                    const def = getAgent(a.agentId);
                    return (
                      <div key={a.agentId} className="flex items-center gap-3 rounded-lg border p-2.5">
                        <span className="text-lg" aria-hidden>{def?.emoji ?? '🤖'}</span>
                        <span className="text-sm font-bold">{def?.name ?? a.agentId}</span>
                        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400"><Sparkles className="h-3 w-3" aria-hidden />{a.solved}/{a.runs} exact</span>
                          <span>{a.pass2}/{a.runs} pass@2</span>
                          <span>{(a.avgMs / 1000).toFixed(2)}s avg</span>
                        </div>
                      </div>
                    );
                  })}
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => { try { window.localStorage.removeItem('arc-lab-agent-scores-v1'); } catch { /* ignore */ } setScores([]); }}>
                    Clear scoreboard
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-extrabold">{value}</p>
    </div>
  );
}
