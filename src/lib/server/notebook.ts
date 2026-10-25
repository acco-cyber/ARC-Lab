/**
 * ARC Lab — Notebook Agent engine (SERVER ONLY).
 *
 * Accepts a real Jupyter notebook (.ipynb) — e.g. acco-cyber/ARC-AGI-2's
 * `arc2-qwen-solo.ipynb` — and runs it against official ARC-AGI-2 puzzles:
 *
 *  1. ANALYZE   parse cells, imports, pip installs, %%writefile modules,
 *               solver entrypoints, GPU/heavy-dependency needs → a verdict.
 *  2. EXECUTE   run the code cells in a sandboxed python3 subprocess
 *               (shell magics skipped, per-cell stdout/errors captured),
 *               then probe the namespace for a solver entrypoint
 *               (solve / transform / predict / any 1-2 arg function) and
 *               test which call convention reproduces the demonstration pairs.
 *  3. FALLBACK  when the notebook needs GPU-only dependencies (vLLM, unsloth,
 *               torch…) and exposes no local entrypoint, run the notebook's own
 *               METHODOLOGY instead: verified program synthesis using the
 *               notebook's vendored helper toolkit (its %%writefile modules),
 *               with the LLM backend substituted for the notebook's model.
 *
 * Everything is honest: the exec log shows exactly which cells ran and which
 * failed, and the engine label states what actually executed.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import type { Grid } from '@/lib/arc/types';
import { llmChat } from '@/lib/server/llm';

// ─────────────────────────────────────────────────────────── types

export interface NotebookCellInfo {
  index: number;
  type: 'code' | 'markdown' | 'raw';
  lines: number;
  preview: string;
  writefile?: string;
  skippedLines: number;
}

export interface NotebookAnalysis {
  title: string;
  kernel: string;
  nCode: number;
  nMarkdown: number;
  bytes: number;
  sha8: string;
  imports: string[];
  heavyImports: string[];
  missingImports: string[]; // imports we know are not available in this sandbox
  pipInstalls: string[];
  writefiles: Array<{ file: string; lines: number; safe: boolean; imports: string[] }>;
  entrypoints: string[];
  methodology: 'verified-program-synthesis' | 'direct-predict' | 'unknown';
  needsGpu: boolean;
  verdict: 'direct-run' | 'methodology' | 'analysis-only';
  verdictNote: string;
  cells: NotebookCellInfo[];
}

export interface NotebookStep {
  kind: 'observe' | 'think' | 'verify' | 'act';
  label: string;
  detail?: string;
  code?: string;
  ok?: boolean;
}

export interface ExecCellLog {
  cell: number;
  ok: boolean;
  stdout?: string;
  error?: string;
  trace?: string[];
}

export interface NotebookSolveResult {
  ok: boolean;
  attempts: Grid[][];
  steps: NotebookStep[];
  analysis: NotebookAnalysis;
  execLog: ExecCellLog[];
  entrypoint?: string;
  convention?: string;
  fitReport?: string[];
  program?: string;
  engine: string;
  note?: string;
  error?: string;
  elapsedMs: number;
}

interface RawCell {
  cell_type?: string;
  source?: string | string[];
}

// ─────────────────────────────────────────────────────────── constants

const HEAVY_MODULES = new Set([
  'torch', 'torchvision', 'vllm', 'unsloth', 'transformers', 'peft', 'trl', 'bitsandbytes',
  'flash_attn', 'accelerate', 'datasets', 'xformers', 'deepspeed', 'sentencepiece', 'tiktoken',
  'jax', 'cupy', 'numba', 'ray', 'wandb', 'openai',
]);

const AVAILABLE_MODULES = new Set([
  // python stdlib (common subset)
  'json', 'sys', 'os', 're', 'math', 'itertools', 'collections', 'functools', 'time', 'io',
  'contextlib', 'traceback', 'inspect', 'random', 'glob', 'shutil', 'subprocess', 'datetime',
  'typing', 'pickle', 'bz2', 'gzip', 'hashlib', 'copy', 'abc', 'enum', 'dataclasses', 'pathlib',
  'statistics', 'string', 'warnings', 'multiprocessing', 'argparse', 'textwrap', 'unicodedata',
  'zlib', 'tempfile', 'threading', 'queue', 'base64', 'struct', 'operator', 'pprint', 'types',
  'timeit', 'uuid', 'csv', 'heapq', 'bisect', 'array', 'weakref', 'secrets', 'errno',
  '__future__', 'ast', 'asyncio', 'signal', 'gc', 'platform', 'site', 'code', 'codeop',
  // available in this sandbox
  'numpy', 'np', 'scipy',
]);

const PREFERRED_ENTRYPOINTS = ['solve', 'transform', 'predict', 'infer', 'solver', 'run', 'main'];

const MAX_NOTEBOOK_BYTES = 5 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 75_000;
const VERIFY_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────── parsing helpers

function cellSource(c: RawCell): string {
  const s = c.source;
  if (Array.isArray(s)) return s.join('');
  return typeof s === 'string' ? s : '';
}

function scanImports(src: string): string[] {
  const mods = new Set<string>();
  const re = /^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) mods.add(m[1]);
  return [...mods];
}

function extractTitle(nb: { cells?: RawCell[] }): string {
  for (const c of nb.cells ?? []) {
    if (c.cell_type !== 'markdown') continue;
    const m = cellSource(c).match(/^#\s+(.+)$/m);
    if (m) return m[1].trim().slice(0, 120);
  }
  return 'Untitled notebook';
}

function extractHelperSignatures(src: string, max = 28): string {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const m = lines[i].match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (!m) continue;
    let doc = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const t = lines[j].trim();
      const d = t.match(/^("""|''')(.*?)(?:\1|$)/);
      if (d && d[2]) {
        doc = d[2].slice(0, 90);
        break;
      }
      if (t && !t.startsWith('#') && !t.startsWith('"') && !t.startsWith("'")) break;
    }
    out.push(`def ${m[1]}(${m[2]}):${doc ? `  # ${doc}` : ''}`);
  }
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────── analysis

export function analyzeNotebook(rawJson: string): NotebookAnalysis {
  const nb = JSON.parse(rawJson) as { cells?: RawCell[]; metadata?: { kernelspec?: { display_name?: string; name?: string } } };
  const cells = nb.cells ?? [];
  const codeCells: string[] = [];
  const cellInfos: NotebookCellInfo[] = [];
  const imports = new Set<string>();
  const pip = new Set<string>();
  const entrypoints = new Set<string>();
  const writefiles: NotebookAnalysis['writefiles'] = [];
  let shellLines = 0;

  cells.forEach((c, index) => {
    const type = (c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'raw' ? 'raw' : 'code') as NotebookCellInfo['type'];
    const src = cellSource(c);
    let writefile: string | undefined;
    let skipped = 0;

    if (type === 'code') {
      const lines = src.split('\n');
      const kept: string[] = [];
      let i = 0;
      if (lines[0]?.startsWith('%%')) {
        const magic = lines[0];
        if (magic.startsWith('%%writefile')) {
          writefile = magic.replace('%%writefile', '').trim();
        }
        i = 1; // skip the magic line either way
        skipped++;
      }
      for (; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*!/.test(line) || /^\s*%/.test(line)) {
          skipped++;
          const pm = line.match(/install(?:\s+--[\w-]+)*\s+(.+)$/);
          if (pm) pm[1].split(/\s+/).filter((p) => /^[\w.\-[\]]+$/.test(p)).forEach((p) => pip.add(p));
          continue;
        }
        const sm = line.match(/^\s*os\.system\(\s*['"]pip\s+install\s+(.+?)['"]/);
        if (sm) {
          skipped++;
          sm[1].split(/\s+/).forEach((p) => pip.add(p));
          continue;
        }
        kept.push(line);
      }
      const clean = kept.join('\n');
      codeCells.push(clean);
      for (const im of scanImports(clean)) imports.add(im);
      for (const n of PREFERRED_ENTRYPOINTS) {
        // only scan cells that will actually execute — module bodies written via
        // %%writefile never run as notebook code, so their defs are not entrypoints
        if (!writefile && new RegExp(`^\\s*def\\s+${n}\\s*\\(`, 'm').test(clean)) entrypoints.add(n);
      }
      if (writefile) {
        const wfImports = scanImports(src);
        const heavy = wfImports.some((m) => HEAVY_MODULES.has(m));
        const missingDep = wfImports.some((m) => !AVAILABLE_MODULES.has(m) && !HEAVY_MODULES.has(m));
        writefiles.push({ file: writefile, lines: src.split('\n').length, safe: !heavy && !missingDep, imports: wfImports });
      }
    }

    cellInfos.push({
      index,
      type,
      lines: src ? src.split('\n').length : 0,
      preview: (type === 'markdown' ? cellSource(c) : src).replace(/^%%.*$/m, '').trim().slice(0, 160) || `(${type} cell)`,
      writefile,
      skippedLines: skipped,
    });
  });

  const importList = [...imports].sort();
  const heavy = importList.filter((m) => HEAVY_MODULES.has(m));
  const missing = importList.filter((m) => !AVAILABLE_MODULES.has(m) && !HEAVY_MODULES.has(m));

  // methodology detection
  const allSrc = codeCells.join('\n') + '\n' + writefiles.map((w) => w.file).join('\n');
  const mdCells = cells.filter((c) => c.cell_type === 'markdown').map((c) => cellSource(c)).join('\n');
  const hay = (allSrc + '\n' + mdCells).toLowerCase();
  let methodology: NotebookAnalysis['methodology'] = 'unknown';
  if (/def\s+transform\s*\(/.test(allSrc) || (hay.includes('verif') && (hay.includes('program') || hay.includes('transform')))) {
    methodology = 'verified-program-synthesis';
  } else if (hay.includes('output grid') || hay.includes('test input')) {
    methodology = 'direct-predict';
  }

  const needsGpu = heavy.length > 0;
  let verdict: NotebookAnalysis['verdict'] = 'analysis-only';
  let verdictNote = '';
  if (entrypoints.size > 0) {
    verdict = 'direct-run';
    verdictNote = `Defines its own entrypoint(s): ${[...entrypoints].join(', ')}. ARC Lab will execute the cells and call the entrypoint on the puzzle directly.`;
  } else if (methodology === 'verified-program-synthesis') {
    verdict = 'methodology';
    verdictNote = needsGpu
      ? `No local solver entrypoint and it needs GPU-only deps (${heavy.slice(0, 3).join(', ')}…), so end-to-end vLLM serving is impossible in this sandbox. ARC Lab will run the notebook's own pipeline — verified program synthesis with its vendored helper toolkit — with the LLM backend substituted for its model.`
      : 'No single entrypoint found; ARC Lab will replay its program-synthesis pipeline with an LLM backend.';
  } else {
    verdictNote = needsGpu
      ? `Requires GPU-only dependencies (${heavy.slice(0, 3).join(', ')}). Cells will be executed for the record; anything that needs them will fail visibly, and ARC Lab will fall back to LLM direct prediction.`
      : 'ARC Lab will execute the cells and fall back to LLM direct prediction if no solver entrypoint emerges.';
  }

  const sha8 = crypto.createHash('sha256').update(rawJson).digest('hex').slice(0, 8);

  return {
    title: extractTitle(nb),
    kernel: nb.metadata?.kernelspec?.display_name ?? nb.metadata?.kernelspec?.name ?? 'python3',
    nCode: cellInfos.filter((c) => c.type === 'code').length,
    nMarkdown: cellInfos.filter((c) => c.type === 'markdown').length,
    bytes: Buffer.byteLength(rawJson),
    sha8,
    imports: importList,
    heavyImports: heavy,
    missingImports: missing,
    pipInstalls: [...pip].slice(0, 20),
    writefiles,
    entrypoints: [...entrypoints],
    methodology,
    needsGpu,
    verdict,
    verdictNote,
    cells: cellInfos,
  };
}

// ─────────────────────────────────────────────────────────── notebook fetch

const ALLOWED_FETCH_HOSTS = new Set([
  'github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com', 'huggingface.co',
  'arcprize.org', 'www.arcprize.org',
]);

export function normalizeNotebookUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_FETCH_HOSTS.has(u.hostname)) return null;
    const gh = u.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+)$/);
    if (u.hostname === 'github.com' && gh) {
      return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export async function fetchNotebook(url: string): Promise<string> {
  const normalized = normalizeNotebookUrl(url);
  if (!normalized) throw new Error('Only https URLs from github.com / raw.githubusercontent.com / gist / huggingface.co / arcprize.org are allowed.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(normalized, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} for ${normalized}`);
    const text = await res.text();
    if (text.length > MAX_NOTEBOOK_BYTES) throw new Error(`Notebook too large (${(text.length / 1024 / 1024).toFixed(1)} MB, limit 5 MB).`);
    if (text[0] === '<') throw new Error('URL returned HTML, not a notebook. Use a raw .ipynb URL.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function notebookAgentId(rawJson: string): string {
  return `nb-${crypto.createHash('sha256').update(rawJson).digest('hex').slice(0, 8)}`;
}

// ─────────────────────────────────────────────────────────── python runner

const PY_EXEC_RUNNER = String.raw`
import json, sys, io, os, contextlib, traceback, inspect, types

def main():
    spec = json.load(open(sys.argv[1]))
    cells = spec.get('cells', [])
    task = spec.get('task', {})
    sys.path.insert(0, os.getcwd())
    ns = {'__name__': '__notebook__'}
    log = []
    for i, src in enumerate(cells):
        entry = {'cell': i, 'ok': True, 'stdout': ''}
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(src, '<notebook cell %d>' % i, 'exec'), ns)
        except Exception as e:
            entry['ok'] = False
            entry['error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
            tb = traceback.format_exc().strip().splitlines()
            entry['trace'] = tb[-2:]
        entry['stdout'] = buf.getvalue()[:2500]
        log.append(entry)

    result = {'log': log, 'entrypoint': None, 'convention': None,
              'fitReport': [], 'attempts': [], 'error': None}

    def as_grid(x):
        try:
            if hasattr(x, 'tolist'):
                x = x.tolist()
            if not isinstance(x, list) or not x or len(x) > 200:
                return None
            rows = []
            for row in x:
                if not isinstance(row, (list, tuple)) or len(row) == 0 or len(row) > 200:
                    return None
                rows.append([int(c) for c in row])
            w = len(rows[0])
            if any(len(r) != w for r in rows):
                return None
            if any(c < 0 or c > 9 for r in rows for c in r):
                return None
            return rows
        except Exception:
            return None

    train = task.get('train', [])
    tests = task.get('test', [])

    fns = []
    for n in ['solve', 'transform', 'predict', 'infer', 'solver', 'run', 'main']:
        v = ns.get(n)
        if callable(v) and not inspect.isclass(v) and getattr(v, '__module__', '') not in ('builtins',):
            fns.append(n)
    for n, v in list(ns.items()):
        if n.startswith('_') or n in fns or n in ('main',):
            continue
        if isinstance(v, types.FunctionType) and v.__module__ == '__notebook__':
            try:
                k = len(inspect.signature(v).parameters)
                if 1 <= k <= 2:
                    fns.append(n)
            except Exception:
                pass
    fns = fns[:40]

    def conventions_for(fn):
        convs = []
        try:
            k = len(inspect.signature(fn).parameters)
        except Exception:
            k = 2
        if k >= 2:
            convs.append(('fn(train, grid)', lambda g: fn(train, g)))
            convs.append(('fn({"train": train}, grid)', lambda g: fn({'train': train}, g)))
        if k >= 1:
            convs.append(('fn(grid)', lambda g: fn(g)))
        return convs

    best = None
    for name in fns:
        fn = ns[name]
        for conv_name, call in conventions_for(fn):
            fits = 0
            errs = []
            for p in train:
                try:
                    out = as_grid(call(p['input']))
                    if out is not None and p.get('output') is not None and out == p['output']:
                        fits += 1
                    else:
                        errs.append('%s/%s: demo %d mismatch' % (name, conv_name, len(errs) + 1))
                except Exception as e:
                    errs.append('%s/%s: %s: %s' % (name, conv_name, type(e).__name__, str(e)[:100]))
            score = (fits, -len(errs))
            if best is None or score > best['score']:
                best = {'name': name, 'conv': conv_name, 'score': score, 'fits': fits, 'errs': errs[:4]}

    if best and best['fits'] > 0:
        result['entrypoint'] = best['name']
        result['convention'] = best['conv']
        result['fitReport'] = ['%d/%d demonstration pairs reproduced' % (best['fits'], len(train))] + best['errs']
        fn = ns[best['name']]
        for conv_name, call in conventions_for(fn):
            if conv_name == best['conv']:
                for t in tests:
                    try:
                        out = as_grid(call(t['input']))
                        result['attempts'].append([out] if out is not None else [])
                    except Exception as e:
                        result['attempts'].append([])
                        result['error'] = 'test call failed: %s: %s' % (type(e).__name__, str(e)[:160])
                break

    sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps(result))

try:
    main()
except Exception as e:
    sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps({'log': [], 'entrypoint': None, 'attempts': [], 'error': 'runner: %s' % str(e)[:200]}))
`;

const PY_VERIFY_RUNNER = String.raw`
import json, sys, os

def main():
    spec = json.load(open(sys.argv[1]))
    sys.path.insert(0, os.getcwd())
    ns = {}
    out = {'fits': 0, 'total': len(spec.get('train', [])), 'errors': [], 'attempts': [], 'entry': None}
    try:
        exec(compile(spec['program'], 'llm_program.py', 'exec'), ns)
    except Exception as e:
        out['errors'].append('program failed to load: %s: %s' % (type(e).__name__, str(e)[:220]))
        sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps(out))
        return
    fn = None
    for n in ['transform', 'solve', 'predict', 'infer']:
        if callable(ns.get(n)):
            fn = ns[n]
            out['entry'] = n
            break
    if fn is None:
        out['errors'].append('no transform(grid) function found in the program')
        sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps(out))
        return

    def as_grid(x):
        try:
            if hasattr(x, 'tolist'):
                x = x.tolist()
            if not isinstance(x, list) or not x or len(x) > 200:
                return None
            rows = []
            for row in x:
                if not isinstance(row, (list, tuple)) or len(row) == 0 or len(row) > 200:
                    return None
                rows.append([int(c) for c in row])
            w = len(rows[0])
            if any(len(r) != w for r in rows):
                return None
            if any(c < 0 or c > 9 for r in rows for c in r):
                return None
            return rows
        except Exception:
            return None

    for i, p in enumerate(spec.get('train', [])):
        try:
            g = as_grid(fn(p['input']))
            exp = p.get('output')
            if g is not None and exp is not None and g == exp:
                out['fits'] += 1
            else:
                got = ('%dx%d' % (len(g), len(g[0]))) if g else 'invalid'
                exps = ('%dx%d' % (len(exp), len(exp[0]))) if exp else '?'
                out['errors'].append('demo %d: got %s, expected %s' % (i + 1, got, exps))
        except Exception as e:
            out['errors'].append('demo %d: %s: %s' % (i + 1, type(e).__name__, str(e)[:140]))
    if out['fits'] == out['total'] and out['total'] > 0:
        for t in spec.get('test', []):
            try:
                g = as_grid(fn(t['input']))
                out['attempts'].append([g] if g is not None else [])
            except Exception as e:
                out['attempts'].append([])
                out['errors'].append('test call: %s: %s' % (type(e).__name__, str(e)[:140]))
    sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps(out))

try:
    main()
except Exception as e:
    sys.stdout.write('__ARC_LAB_RESULT__' + json.dumps({'fits': 0, 'total': 0, 'errors': ['runner: %s' % str(e)[:200]], 'attempts': [], 'entry': None}))
`;

interface PyExecResult {
  log: ExecCellLog[];
  entrypoint: string | null;
  convention: string | null;
  fitReport: string[];
  attempts: Grid[][];
  error: string | null;
}

interface PyVerifyResult {
  fits: number;
  total: number;
  errors: string[];
  attempts: Grid[][];
  entry: string | null;
}

function runPython(script: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'python3',
      [script, ...args],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONUNBUFFERED: '1' } },
      (err, stdout) => {
        resolve({ stdout: typeof stdout === 'string' ? stdout : '', error: err ? `${err.message.slice(0, 200)}` : undefined });
      },
    );
  });
}

function parseMarker<T>(stdout: string): T | null {
  const idx = stdout.lastIndexOf('__ARC_LAB_RESULT__');
  if (idx === -1) return null;
  try {
    return JSON.parse(stdout.slice(idx + 18)) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────── task serialization

interface SerializedTask {
  train: Array<{ input: Grid; output: Grid }>;
  test: Array<{ input: Grid }>;
}

function serializeTask(train: Array<{ input: Grid; output?: Grid }>, testInputs: Grid[]): SerializedTask {
  return {
    train: train.filter((p) => p.output).map((p) => ({ input: p.input, output: p.output as Grid })),
    test: testInputs.map((input) => ({ input })),
  };
}

// ─────────────────────────────────────────────────────────── main entry

export interface NotebookRunOptions {
  train: Array<{ input: Grid; output?: Grid }>;
  testInputs: Grid[];
  rawNotebook: string;
  /** LLM knobs for the methodology / fallback path. */
  samples?: number;
  repairSamples?: number;
}

export async function runNotebookOnTask(opts: NotebookRunOptions): Promise<NotebookSolveResult> {
  const t0 = Date.now();
  const analysis = analyzeNotebook(opts.rawNotebook);
  const nb = JSON.parse(opts.rawNotebook) as { cells?: RawCell[] };
  const steps: NotebookStep[] = [];
  const engineBase = `notebook "${analysis.title}"`;

  steps.push({
    kind: 'observe',
    label: `Parsed notebook: ${analysis.title}`,
    detail: `${analysis.nCode} code + ${analysis.nMarkdown} markdown cells · kernel ${analysis.kernel} · ${(analysis.bytes / 1024).toFixed(0)} KB`,
  });

  // ── prepare sandbox dir
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclab-nb-'));
  let pyExec: PyExecResult | null = null;
  try {
    // build cell payloads
    const execCells: string[] = [];
    const skipped: string[] = [];
    (nb.cells ?? []).forEach((c, i) => {
      if (c.cell_type !== 'code') return;
      const src = cellSource(c);
      const info = analysis.cells[i];
      if (info?.writefile) {
        const body = src.split('\n').slice(1).join('\n');
        const safeName = info.writefile.replace(/[^\w.-]/g, '_');
        try {
          fs.writeFileSync(path.join(dir, safeName), body);
          skipped.push(`cell ${i}: %%writefile ${safeName} → module staged (${body.split('\n').length} lines)`);
        } catch {
          skipped.push(`cell ${i}: %%writefile ${safeName} → could not stage`);
        }
        return;
      }
      const lines = src.split('\n');
      const kept = lines.filter((l) => !/^\s*!/.test(l) && !/^\s*%/.test(l));
      if (kept.length !== lines.length) skipped.push(`cell ${i}: ${lines.length - kept.length} shell/magic line(s) skipped`);
      if (kept.join('').trim()) execCells.push(kept.join('\n'));
    });

    if (skipped.length) {
      steps.push({ kind: 'observe', label: 'Staged notebook artifacts', detail: skipped.slice(0, 8).join(' · ') });
    }

    // stage safe helper modules for the methodology path
    const safeModules = analysis.writefiles.filter((w) => w.safe);
    for (const w of safeModules) {
      const cell = (nb.cells ?? []).find((c) => c.cell_type === 'code' && cellSource(c).startsWith(`%%writefile ${w.file}`));
      if (cell) {
        const body = cellSource(cell).split('\n').slice(1).join('\n');
        try {
          fs.writeFileSync(path.join(dir, w.file.replace(/[^\w.-]/g, '_')), body);
        } catch {
          /* ignore */
        }
      }
    }

    // ── execute cells
    steps.push({
      kind: 'think',
      label: 'Executing notebook cells in a python3 sandbox…',
      detail: analysis.needsGpu
        ? `Known heavy imports: ${analysis.heavyImports.slice(0, 5).join(', ')} — those cells are expected to fail here; later cells still get their chance.`
        : 'Capturing per-cell stdout and errors.',
    });
    const execScript = path.join(dir, 'arc_lab_nb_exec.py');
    const specFile = path.join(dir, 'arc_lab_nb_spec.json');
    fs.writeFileSync(execScript, PY_EXEC_RUNNER);
    fs.writeFileSync(specFile, JSON.stringify({ cells: execCells, task: serializeTask(opts.train, opts.testInputs) }));
    const execRes = await runPython(execScript, [specFile], dir, EXEC_TIMEOUT_MS);
    pyExec = parseMarker<PyExecResult>(execRes.stdout) ?? {
      log: [],
      entrypoint: null,
      convention: null,
      fitReport: [],
      attempts: [],
      error: execRes.error ?? 'runner produced no result (timeout or crash)',
    };
    const okCells = pyExec.log.filter((l) => l.ok).length;
    const badCells = pyExec.log.filter((l) => !l.ok);
    steps.push({
      kind: 'verify',
      label: `Executed ${pyExec.log.length} code cells: ${okCells} ok, ${badCells.length} failed`,
      detail: badCells
        .slice(0, 4)
        .map((l) => `cell ${l.cell}: ${l.error}`)
        .join(' · ') || 'all cells clean',
      ok: badCells.length === 0,
    });
    if (pyExec.log.length === 0 && pyExec.error) {
      steps.push({ kind: 'verify', label: 'Sandbox execution aborted', detail: pyExec.error, ok: false });
    }

    // ── entrypoint path
    if (pyExec.entrypoint && pyExec.attempts.some((a) => a.length > 0)) {
      steps.push({
        kind: 'verify',
        label: `Found solver entrypoint: ${pyExec.entrypoint}()`,
        detail: (pyExec.fitReport ?? []).join(' · ') || 'verified against the demonstration pairs',
        ok: true,
      });
      steps.push({ kind: 'act', label: `Ran ${pyExec.entrypoint}() on the test input(s) — pure local execution of the notebook's own code` });
      return {
        ok: true,
        attempts: pyExec.attempts,
        steps,
        analysis,
        execLog: pyExec.log,
        entrypoint: pyExec.entrypoint,
        convention: pyExec.convention ?? undefined,
        fitReport: pyExec.fitReport,
        engine: `${engineBase} — direct execution of ${pyExec.entrypoint}() (no LLM involved)`,
        elapsedMs: Date.now() - t0,
      };
    }

    // ── methodology / fallback paths
    const K1 = Math.min(Math.max(opts.samples ?? 2, 1), 3);
    const K2 = Math.min(Math.max(opts.repairSamples ?? 1, 0), 2);
    let program: string | undefined;
    let attempts: Grid[][] = [];

    if (analysis.methodology === 'verified-program-synthesis' && safeModules.length > 0) {
      // pick the best helper toolkit: prefer kit-like names, then the highest
      // def-density module (dense pure helpers beat long pipeline harnesses)
      const toolkit = safeModules.reduce((a, b) => {
        const kitName = (f: string) => /kit|toolkit|helper|librar/i.test(f);
        if (kitName(a.file) !== kitName(b.file)) return kitName(a.file) ? a : b;
        const density = (f: { file: string; lines: number }) => {
          const cell = (nb.cells ?? []).find((c) => c.cell_type === 'code' && cellSource(c).startsWith(`%%writefile ${f.file}`));
          const body = cell ? cellSource(cell) : '';
          const defs = (body.match(/^def\s+/gm) ?? []).length;
          return defs / Math.max(1, f.lines);
        };
        return density(a) >= density(b) ? a : b;
      });
      const sigs = extractHelperSignatures(
        fs.existsSync(path.join(dir, toolkit.file.replace(/[^\w.-]/g, '_')))
          ? fs.readFileSync(path.join(dir, toolkit.file.replace(/[^\w.-]/g, '_')), 'utf8')
          : '',
      );
      steps.push({
        kind: 'think',
        label: `No callable entrypoint — running the notebook's own methodology: verified program synthesis`,
        detail: `Using its vendored toolkit ${toolkit.file} (${toolkit.lines} lines) as the helper library; the LLM backend stands in for the notebook's GPU model.`,
      });

      const modName = toolkit.file.replace(/\.py$/, '').replace(/[^\w.]/g, '');
      const SYSTEM = `You are replicating the program-synthesis stage of a real ARC-AGI-2 notebook (${analysis.title}).
Write a Python function \`def transform(grid):\` that maps an input grid (list of lists of ints 0-9) to the output grid, reproducing EVERY example pair EXACTLY.
The notebook's own helper toolkit is importable: \`from ${modName} import *\`. Available helpers (signatures):
${sigs || '(toolkit signatures unavailable — use plain numpy)'}

Rules:
- numpy is available as np. Pure function, no file I/O, no input(), no while True without exit.
- Derive the RULE from the examples; do not hardcode the answer grids.
- The function must return a list of lists of ints (or a numpy array).
Reply with ONLY the Python code, fenced as \`\`\`python ... \`\`\`.`;

      const taskText = JSON.stringify(serializeTask(opts.train, opts.testInputs));
      const examples = opts.train
        .filter((p) => p.output)
        .map((p, i) => `Example ${i + 1}:\nINPUT: ${JSON.stringify(p.input)}\nOUTPUT: ${JSON.stringify(p.output)}`)
        .join('\n\n');
      const verifyScript = path.join(dir, 'arc_lab_verify.py');
      fs.writeFileSync(verifyScript, PY_VERIFY_RUNNER);

      const bestRef: { current: { code: string; fits: number; errors: string[]; attempts: Grid[][] } | null } = { current: null };
      const tryProgram = async (code: string): Promise<boolean> => {
        const specFile2 = path.join(dir, 'verify_spec.json');
        fs.writeFileSync(specFile2, JSON.stringify({ program: code, task: taskText, train: serializeTask(opts.train, opts.testInputs).train, test: serializeTask(opts.train, opts.testInputs).test }));
        const res = await runPython(verifyScript, [specFile2], dir, VERIFY_TIMEOUT_MS);
        const parsed = parseMarker<PyVerifyResult>(res.stdout);
        if (!parsed) {
          steps.push({ kind: 'verify', label: 'Program verification did not return (timeout or crash)', ok: false });
          return false;
        }
        steps.push({
          kind: 'verify',
          label: `Program: reproduced ${parsed.fits}/${parsed.total} examples`,
          detail: parsed.errors.slice(0, 3).join(' · ') || 'fits every example',
          ok: parsed.fits === parsed.total && parsed.total > 0,
        });
        if (!bestRef.current || parsed.fits > bestRef.current.fits) bestRef.current = { code, fits: parsed.fits, errors: parsed.errors, attempts: parsed.attempts };
        return parsed.fits === parsed.total && parsed.total > 0 && parsed.attempts.length > 0;
      };

      let solvedByProgram = false;
      for (let i = 0; i < K1 && !solvedByProgram; i++) {
        try {
          const text = await llmChat(SYSTEM, `${examples}\n\nWrite the Python transform(grid) program (function definition only).`);
          const code = extractPython(text);
          if (!code) {
            steps.push({ kind: 'verify', label: `Candidate ${i + 1}: unparsable reply`, ok: false });
            continue;
          }
          steps.push({ kind: 'think', label: `Candidate program ${i + 1} written by the LLM backend`, code: code.slice(0, 700) });
          solvedByProgram = await tryProgram(code);
        } catch (err) {
          steps.push({ kind: 'verify', label: `Candidate ${i + 1}: LLM error`, detail: err instanceof Error ? err.message : 'error', ok: false });
        }
      }
      const bestForRepair = bestRef.current;
      if (!solvedByProgram && bestForRepair) {
        for (let i = 0; i < K2 && !solvedByProgram; i++) {
          try {
            const repair = `${examples}\n\nThis Python program is WRONG:\n\`\`\`python\n${bestForRepair.code}\n\`\`\`\nIts verification errors: ${bestForRepair.errors.slice(0, 3).join('; ')}.\nRewrite it so transform(grid) reproduces EVERY example exactly. Same contract, reply with only the corrected code.`;
            const text = await llmChat(SYSTEM, repair);
            const code = extractPython(text);
            if (!code) continue;
            steps.push({ kind: 'think', label: `Repair round ${i + 1}`, code: code.slice(0, 700) });
            solvedByProgram = await tryProgram(code);
          } catch (err) {
            steps.push({ kind: 'verify', label: `Repair ${i + 1}: LLM error`, detail: err instanceof Error ? err.message : 'error', ok: false });
          }
        }
      }
      const bestFinal = bestRef.current;
      if (solvedByProgram && bestFinal) {
        program = bestFinal.code;
        attempts = bestFinal.attempts;
        steps.push({ kind: 'act', label: 'Verified program applied to the test input(s) — the notebook methodology, executed with local substitutes' });
        return {
          ok: true,
          attempts,
          steps,
          analysis,
          execLog: pyExec.log,
          program,
          engine: `${engineBase} — methodology mode: verified program synthesis with its own toolkit, LLM backend substituted for the GPU model`,
          note: 'The notebook needs GPU-only dependencies, so its model backend was substituted; the verify-on-demos discipline is the notebook\'s own.',
          elapsedMs: Date.now() - t0,
        };
      }
      const bestAny = bestRef.current;
      if (bestAny) {
        steps.push({ kind: 'think', label: 'No program fits all examples — falling back to direct grid prediction', detail: `best program reproduced ${bestAny.fits} of ${opts.train.filter((p) => p.output).length} examples` });
      }
    }

    // ── LLM direct fallback
    const DIRECT_SYSTEM = `You are an ARC-AGI-2 solver. Given example input/output grid pairs, infer the transformation and output the test grid.
Grids are rectangular arrays of integers 0-9. The output may differ in size from the input.
Reply with ONLY the output grid as a JSON array of arrays. No markdown, no commentary.`;
    const examples = opts.train
      .filter((p) => p.output)
      .map((p, i) => `Example ${i + 1}:\nINPUT: ${JSON.stringify(p.input)}\nOUTPUT: ${JSON.stringify(p.output)}`)
      .join('\n\n');
    const directAttempts: Grid[][] = [];
    let llmError = '';
    for (const ti of opts.testInputs) {
      const preds: Grid[] = [];
      for (let i = 0; i < 2 && preds.length < 2; i++) {
        try {
          const text = await llmChat(
            DIRECT_SYSTEM,
            `${examples}\n\nNotebook context: ${analysis.title} (${analysis.methodology}).\n\nTest INPUT: ${JSON.stringify(ti)}\n\nWhat is the Test OUTPUT? Reply with ONLY the output grid as JSON.`,
          );
          const g = parseGridLoose(text);
          if (g && !preds.some((p) => JSON.stringify(p) === JSON.stringify(g))) preds.push(g);
        } catch (err) {
          llmError = err instanceof Error ? err.message : 'llm-error';
        }
      }
      directAttempts.push(preds.length > 0 ? preds : [ti.map((r) => [...r])]);
    }
    if (directAttempts.some((a) => a.length > 0)) {
      steps.push({ kind: 'act', label: 'Direct fallback produced candidate grids (unverified — no program evidence)', ok: false });
    } else {
      steps.push({ kind: 'act', label: 'No prediction could be produced', detail: llmError || 'LLM unavailable', ok: false });
    }
    attempts = directAttempts;
    return {
      ok: attempts.some((a) => a.length > 0),
      attempts,
      steps,
      analysis,
      execLog: pyExec.log,
      program,
      engine: program ? `${engineBase} — methodology mode` : `${engineBase} — LLM direct fallback (notebook could not be executed locally)`,
      note: llmError ? `LLM note: ${llmError}` : undefined,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ─────────────────────────────────────────────────────────── small helpers

function extractPython(text: string): string | null {
  if (!text) return null;
  const fence = text.match(/```(?:python|py)?\s*([\s\S]*?)```/);
  const code = (fence ? fence[1] : text).trim();
  return /def\s+\w+\s*\(/.test(code) && code.length > 20 ? code : null;
}

function parseGridLoose(text: string): Grid | null {
  if (!text) return null;
  const start = text.indexOf('[[');
  const end = text.lastIndexOf(']]');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 2)) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 200) return null;
    const w = Array.isArray(parsed[0]) ? (parsed[0] as unknown[]).length : -1;
    if (w <= 0 || w > 200) return null;
    for (const row of parsed as unknown[]) {
      if (!Array.isArray(row) || (row as unknown[]).length !== w) return null;
      for (const cell of row as unknown[]) {
        if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return null;
      }
    }
    return parsed as Grid;
  } catch {
    return null;
  }
}
