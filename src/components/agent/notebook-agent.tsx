'use client';

/**
 * ARC Lab — Notebook Agent.
 *
 * Drop in a real Jupyter notebook (.ipynb) — by URL (e.g. your
 * acco-cyber/ARC-AGI-2 arc2-qwen-solo.ipynb) or by uploading the file —
 * and ARC Lab will:
 *   1. analyze it (cells, deps, GPU needs, entrypoints, methodology),
 *   2. execute its cells in a python3 sandbox and look for a solver
 *      entrypoint, testing call conventions against the demos,
 *   3. otherwise replay the notebook's own methodology (verified program
 *      synthesis with its vendored toolkit, LLM backend substituted),
 *   4. test it on FRESH official ARC-AGI-2 puzzles — the never-repeat
 *      queue guarantees the same puzzle is never served to the same
 *      notebook twice — and show the scored results.
 */

import React from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, FileUp, FlaskConical, Loader2, Notebook,
  RefreshCw, Sparkles, XCircle, Zap,
} from 'lucide-react';
import type { Grid } from '@/lib/arc/types';
import { dims } from '@/lib/arc/grid';
import { GridView } from '@/components/arc/grid-view';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const DEFAULT_NOTEBOOK_URL = 'https://github.com/acco-cyber/ARC-AGI-2/blob/main/arc2-qwen-solo.ipynb';

// ─────────────────────────────────────────────────────────── API types

interface NotebookAnalysis {
  title: string;
  kernel: string;
  nCode: number;
  nMarkdown: number;
  bytes: number;
  sha8: string;
  imports: string[];
  heavyImports: string[];
  missingImports: string[];
  pipInstalls: string[];
  writefiles: Array<{ file: string; lines: number; safe: boolean }>;
  entrypoints: string[];
  methodology: 'verified-program-synthesis' | 'direct-predict' | 'unknown';
  needsGpu: boolean;
  verdict: 'direct-run' | 'methodology' | 'analysis-only';
  verdictNote: string;
  cells: Array<{ index: number; type: string; lines: number; preview: string; writefile?: string; skippedLines: number }>;
}

interface StepOut {
  kind: 'observe' | 'think' | 'verify' | 'act';
  label: string;
  detail?: string;
  code?: string;
  ok?: boolean;
}

interface ScoreOut {
  exact: boolean | null;
  pass2: boolean | null;
  pixelAcc: number | null;
  shapeOk: boolean;
  diffCells: number | null;
  failure: string;
}

interface NotebookTaskResult {
  dataset: string;
  taskId: string;
  freshNumber: number;
  seen: number;
  total: number;
  testInput: Grid;
  attempts: Grid[][];
  expected: Grid[];
  score: ScoreOut;
  steps: StepOut[];
  execLog: Array<{ cell: number; ok: boolean; stdout?: string; error?: string }>;
  entrypoint?: string;
  program?: string;
  engine: string;
  note?: string;
  elapsedMs: number;
  ok: boolean;
  error?: string;
}

interface NotebookRunResponse {
  ok: boolean;
  analysis: NotebookAnalysis;
  agentId: string;
  summary?: { tested: number; solved: number; pass2: number; avgPixel: number; totalMs: number };
  results?: NotebookTaskResult[];
  exhausted?: boolean;
  message?: string;
  error?: string;
}

interface HistoryResponse {
  history: Record<string, { seen: number; solved: number; total: number }>;
}

const FAILURE_BADGE: Record<string, { label: string; className: string }> = {
  none: { label: 'solved', className: 'bg-emerald-600 text-white' },
  'no-prediction': { label: 'no prediction', className: 'bg-zinc-500 text-white' },
  unverifiable: { label: 'unverifiable', className: 'bg-zinc-500 text-white' },
  'shape-mismatch': { label: 'wrong shape', className: 'bg-rose-600 text-white' },
  'color-mismatch': { label: 'wrong palette', className: 'bg-amber-500 text-white' },
  'cell-errors': { label: 'cells misplaced', className: 'bg-rose-500 text-white' },
};

function stepIcon(kind: string, ok?: boolean) {
  if (kind === 'verify' && ok === true) return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (kind === 'verify' && ok === false) return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />;
  if (kind === 'observe') return <Notebook className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />;
  if (kind === 'think') return <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />;
  return <Zap className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />;
}

// ─────────────────────────────────────────────────────────── component

export default function NotebookAgent({ playerId }: { playerId: string }) {
  const [url, setUrl] = React.useState(DEFAULT_NOTEBOOK_URL);
  const [uploadedContent, setUploadedContent] = React.useState<string | null>(null);
  const [uploadedName, setUploadedName] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<NotebookAnalysis | null>(null);
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [dataset, setDataset] = React.useState<'training' | 'evaluation'>('training');
  const [count, setCount] = React.useState(2);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<NotebookTaskResult[]>([]);
  const [summary, setSummary] = React.useState<NotebookRunResponse['summary'] | null>(null);
  const [exhausted, setExhausted] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<Record<string, { seen: number; solved: number; total: number }>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const source = React.useMemo(
    () => (uploadedContent ? { content: uploadedContent } : { url }),
    [uploadedContent, url],
  );

  const refreshHistory = React.useCallback(async (aid: string) => {
    try {
      const res = await fetch(`/api/official/history?playerId=${encodeURIComponent(playerId)}&agentId=${encodeURIComponent(aid)}`, { cache: 'no-store' });
      if (res.ok) setHistory(((await res.json()) as HistoryResponse).history);
    } catch {
      /* ignore */
    }
  }, [playerId]);

  async function handleFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setError('Notebook larger than 5 MB.');
      return;
    }
    const text = await f.text();
    if (!text.trim().startsWith('{')) {
      setError('Not a Jupyter notebook (.ipynb is JSON).');
      return;
    }
    setUploadedContent(text);
    setUploadedName(f.name);
    setAnalysis(null);
    setResults([]);
    await analyze(text);
  }

  async function analyze(overrideContent?: string) {
    setAnalyzing(true);
    setError(null);
    setResults([]);
    setSummary(null);
    setExhausted(null);
    try {
      const res = await fetch('/api/agent/notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', source: overrideContent ? { content: overrideContent } : source }),
      });
      const data = (await res.json()) as NotebookRunResponse;
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnalysis(data.analysis);
      setAgentId(data.agentId);
      void refreshHistory(data.agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'analyze failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function runOnFreshPuzzles() {
    if (!analysis || running) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setSummary(null);
    setExhausted(null);
    try {
      const res = await fetch('/api/agent/notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', source, dataset, playerId, count }),
      });
      const data = (await res.json()) as NotebookRunResponse;
      if (data.exhausted) {
        setExhausted(data.message ?? 'All puzzles seen for this notebook.');
        setResults([]);
        void refreshHistory(data.agentId);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results ?? []);
      setSummary(data.summary ?? null);
      setAnalysis(data.analysis);
      setAgentId(data.agentId);
      void refreshHistory(data.agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'notebook run failed');
    } finally {
      setRunning(false);
    }
  }

  async function resetHistory() {
    if (!agentId) return;
    await fetch(`/api/official/history?playerId=${encodeURIComponent(playerId)}&agentId=${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    void refreshHistory(agentId);
  }

  const h = agentId ? history[dataset] : undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Notebook className="h-4 w-4" aria-hidden /> Notebook agent — drop in your own .ipynb
          <Badge variant="outline" className="ml-auto gap-1 border-emerald-500/50 text-[10px] text-emerald-600 dark:text-emerald-400">
            <FlaskConical className="h-3 w-3" aria-hidden /> analyze → execute → test on fresh puzzles
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <p className="text-xs text-muted-foreground">
          ARC Lab accepts real research notebooks. It parses the notebook, runs its cells in a python3 sandbox, probes for a solver entrypoint
          (verified against the demonstration pairs), and — when the notebook needs GPU-only deps like vLLM — replays the notebook&apos;s own
          verified-program-synthesis methodology with its vendored toolkit and an LLM backend. Every test uses a <strong className="text-foreground">brand-new puzzle</strong>.
        </p>

        {/* source row */}
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <Input
            value={uploadedContent ? uploadedName ?? 'uploaded notebook' : url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUploadedContent(null);
              setUploadedName(null);
            }}
            disabled={!!uploadedContent}
            placeholder="https://github.com/you/repo/blob/main/agent.ipynb"
            className="font-mono text-xs"
            aria-label="Notebook URL"
          />
          <Button variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={analyzing || running}>
            <FileUp className="h-3.5 w-3.5" aria-hidden /> Upload .ipynb
          </Button>
          <Button className="gap-1.5" onClick={() => analyze()} disabled={analyzing || running || (!uploadedContent && !url.trim())}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Notebook className="h-4 w-4" aria-hidden />}
            {analyzing ? 'Analyzing…' : 'Load & analyze'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ipynb,application/json"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            aria-hidden
          />
        </div>
        {uploadedContent && (
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary" className="gap-1"><FileUp className="h-3 w-3" aria-hidden /> {uploadedName}</Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setUploadedContent(null); setUploadedName(null); }}>
              use URL instead
            </Button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* analysis panel */}
        {analysis && (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-extrabold">{analysis.title}</p>
              <Badge variant="secondary" className="text-[10px]">agent id {agentId}</Badge>
              {analysis.verdict === 'direct-run' && (
                <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" aria-hidden /> direct execution possible</Badge>
              )}
              {analysis.verdict === 'methodology' && (
                <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500"><RefreshCw className="h-3 w-3" aria-hidden /> methodology replay</Badge>
              )}
              {analysis.needsGpu && <Badge variant="destructive" className="gap-1">GPU-only deps</Badge>}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{analysis.verdictNote}</p>

            <div className="grid gap-3 text-xs md:grid-cols-4">
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">Cells</p>
                <p>{analysis.nCode} code · {analysis.nMarkdown} markdown</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">Entrypoints</p>
                <p>{analysis.entrypoints.length > 0 ? analysis.entrypoints.map((e) => <code key={e} className="rounded bg-muted px-1">{e}()</code>) : 'none detected'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">Vendored modules</p>
                <p>{analysis.writefiles.length > 0 ? analysis.writefiles.map((w) => (
                  <span key={w.file} className={cn('mr-1', w.safe ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                    {w.file}{w.safe ? '' : ' (GPU)'}
                  </span>
                )) : 'none'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">Methodology</p>
                <p>{analysis.methodology === 'verified-program-synthesis' ? 'verified program synthesis' : analysis.methodology === 'direct-predict' ? 'direct prediction' : 'unclassified'}</p>
              </div>
            </div>

            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
                Dependencies &amp; cell-by-cell report ({analysis.imports.length} imports, {analysis.pipInstalls.length} pip installs)
              </summary>
              <div className="space-y-2 border-t p-3 text-xs">
                <div className="flex flex-wrap gap-1">
                  {analysis.imports.map((im) => (
                    <Badge
                      key={im}
                      variant="secondary"
                      className={cn(
                        'text-[10px]',
                        analysis.heavyImports.includes(im) && 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                      )}
                    >
                      {im}
                    </Badge>
                  ))}
                </div>
                <ScrollArea className="h-40 rounded-md border">
                  <div className="divide-y p-2">
                    {analysis.cells.map((c) => (
                      <div key={c.index} className="flex items-start gap-2 py-1 text-[11px]">
                        <Badge variant="outline" className="shrink-0 text-[9px]">{c.type}</Badge>
                        {c.writefile && <Badge variant="secondary" className="shrink-0 text-[9px]">writes {c.writefile}</Badge>}
                        <span className="line-clamp-1 text-muted-foreground">{c.preview}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </details>

            {/* run config */}
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Official puzzle set</Label>
                <Select value={dataset} onValueChange={(v) => setDataset(v as 'training' | 'evaluation')}>
                  <SelectTrigger aria-label="Dataset"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="training">ARC-AGI-2 training (1,000 tasks)</SelectItem>
                    <SelectItem value="evaluation">ARC-AGI-2 public evaluation (120 tasks)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Fresh puzzles per run</Label>
                  <span className="text-xs font-bold">{count}</span>
                </div>
                <Slider min={1} max={5} step={1} value={[count]} onValueChange={(v) => setCount(v[0])} aria-label="Puzzles per run" />
              </div>
              <Button onClick={runOnFreshPuzzles} disabled={running} className="gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
                {running ? 'Testing…' : 'Test on fresh puzzles'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> never repeats a puzzle
              </Badge>
              <span>
                {h ? (
                  <>this notebook has seen <strong className="text-foreground">{h.seen}/{h.total}</strong> {dataset} puzzles ({h.solved} solved exactly) — every run serves only unseen ones</>
                ) : (
                  'server tracks every puzzle this notebook has been served — zero repeats'
                )}
              </span>
              {h && h.seen > 0 && (
                <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => void resetHistory()}>
                  <RefreshCw className="h-3 w-3" aria-hidden /> reset history
                </Button>
              )}
            </div>

            {running && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Executing the notebook per puzzle… methodology notebooks make several LLM calls per puzzle, so this can take a few minutes.
              </p>
            )}

            {exhausted && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
                {exhausted}
              </div>
            )}

            {summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
                <Stat label="Fresh puzzles tested" value={`${summary.tested}`} />
                <Stat label="Solved (exact)" value={`${summary.solved}/${summary.tested}`} />
                <Stat label="Pass@2" value={`${summary.pass2}/${summary.tested}`} />
                <Stat label="Avg pixel acc" value={`${(summary.avgPixel * 100).toFixed(1)}%`} />
              </div>
            )}

            {/* per-task results */}
            {results.map((r) => (
              <NotebookResultCard key={r.taskId} r={r} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────── result card

function NotebookResultCard({ r }: { r: NotebookTaskResult }) {
  const pred = r.attempts[0]?.[0] ?? null;
  const attempt2 = r.attempts[0]?.[1] ?? null;
  const expected = r.expected[0] ?? null;
  const failure = FAILURE_BADGE[r.score.failure] ?? FAILURE_BADGE['cell-errors'];
  const mismatch = React.useMemo(() => {
    if (!pred || !expected || !r.score.shapeOk) return [];
    const cells: Array<[number, number]> = [];
    for (let row = 0; row < expected.length; row++) {
      for (let c = 0; c < expected[row].length; c++) if (pred[row]?.[c] !== expected[row][c]) cells.push([row, c]);
    }
    return cells;
  }, [pred, expected, r.score.shapeOk]);
  const okCells = r.execLog.filter((l) => l.ok).length;

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-sm font-bold">{r.taskId}</p>
        <Badge variant="secondary" className="text-[10px]">{r.dataset}</Badge>
        <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400">fresh #{r.freshNumber} · {r.seen}/{r.total} seen</Badge>
        {r.score.exact === true && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />exact match</Badge>}
        {r.score.exact === false && r.score.pass2 === true && <Badge variant="secondary">solved on attempt 2</Badge>}
        {r.score.exact === false && r.score.pass2 === false && <Badge className={failure.className}>{failure.label}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {r.score.pixelAcc !== null ? `pixel ${(r.score.pixelAcc * 100).toFixed(1)}% · ` : ''}
          {(r.elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-5">
        {r.testInput.length > 0 && <GridBlock label="Test input" grid={r.testInput} />}
        {pred && <GridBlock label="Prediction" grid={pred} highlight={mismatch} />}
        {attempt2 && <GridBlock label="Attempt 2" grid={attempt2} small />}
        {expected && <GridBlock label="Expected" grid={expected} />}
        {!pred && <div className="flex h-[72px] w-[110px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">no prediction</div>}
      </div>

      <details className="mt-3 rounded-lg border">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
          Agent trace ({r.steps.length} steps) · exec log ({okCells}/{r.execLog.length} cells ok)
        </summary>
        <div className="grid gap-3 border-t p-3 md:grid-cols-2">
          <div className="space-y-1.5">
            {r.steps.map((s, i) => (
              <div key={i} className={cn('flex items-start gap-2 rounded-lg px-2 py-1 text-xs', s.ok === false && s.kind === 'verify' && 'bg-red-500/5')}>
                <span className="mt-0.5">{stepIcon(s.kind, s.ok)}</span>
                <div className="min-w-0">
                  <p className="leading-snug">{s.label}</p>
                  {s.detail && <p className="break-words text-[11px] text-muted-foreground">{s.detail}</p>}
                  {s.code && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 text-[10px] leading-snug">{s.code}</pre>}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {r.execLog.map((l) => (
              <div key={l.cell} className="flex items-start gap-2 rounded-lg px-2 py-1 text-xs">
                {l.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />}
                <div className="min-w-0">
                  <p className="leading-snug">cell {l.cell} {l.ok ? 'ok' : `failed: ${l.error}`}</p>
                  {l.stdout && <p className="break-words text-[11px] text-muted-foreground">stdout: {l.stdout.slice(0, 220)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      {r.program && (
        <details className="mt-2 rounded-lg border">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
            Program used ({r.entrypoint ? `notebook entrypoint ${r.entrypoint}()` : 'LLM-written, verified on all examples'})
          </summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t p-3 text-[10px] leading-snug">{r.program}</pre>
        </details>
      )}

      <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground" title={r.engine}>{r.engine}</p>
      {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
    </div>
  );
}

function GridBlock({ label, grid, highlight, small }: { label: string; grid: Grid; highlight?: Array<[number, number]>; small?: boolean }) {
  const w = dims(grid).w;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <GridView grid={grid} cellSize={small ? Math.max(6, Math.min(12, 120 / Math.max(1, w))) : Math.max(8, Math.min(16, 150 / Math.max(1, w)))} highlightCells={highlight} ariaLabel={`${label} grid`} />
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
