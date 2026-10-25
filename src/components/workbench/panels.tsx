'use client';

/**
 * ARC Lab Workbench — inspector panels.
 *
 * ExamplesPanel  — demonstration pairs + held-out test input.
 * ObjectsPanel   — connected-component detection with bounding-box overlays.
 * ProgramPanel   — DSL op palette, program editor, execution, consistency
 *                  checker, test prediction and bounded program search.
 * TracePanel     — step-by-step execution trace with diffs between steps.
 *
 * All heavy reasoning (findObjects / applyProgram / searchPrograms) runs
 * client-side on the shared ARC core; the panels only render and label.
 */

import React from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Play, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  OP_SPECS,
  applyOp,
  applyProgram,
  describeProgram,
  getOpSpec,
  searchPrograms,
  type CandidateProgram,
  type DslOp,
  type OpParams,
  type OpSpec,
  type Program,
} from '@/lib/arc/dsl';
import { findObjects } from '@/lib/arc/objects';
import { diffGrids, gridsEqual, uniqueColors } from '@/lib/arc/grid';
import { ARC_COLORS, colorHex, colorName } from '@/lib/arc/colors';
import type { Color, Grid, Task } from '@/lib/arc/types';
import { GridView } from '@/components/arc/grid-view';
import { PairViewer } from '@/components/arc/pair-viewer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useArcLab } from '@/lib/store/arc-lab';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Distinct UI overlay color per object index (hue rotation; avoids blue/indigo defaults). */
export function overlayColor(i: number): string {
  return `hsl(${(i * 47) % 360} 80% 60%)`;
}

/** Fraction of matching cells; 0 when shapes differ. */
function pixelAccuracy(a: Grid, b: Grid): number {
  const d = diffGrids(a, b);
  if (!d.shapeEqual) return 0;
  return d.totalCells === 0 ? 0 : 1 - d.diffCells / d.totalCells;
}

/** Cells that differ between two grids (all cells when shapes differ). */
function changedCells(a: Grid, b: Grid): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (a.length !== b.length || (a[0]?.length ?? 0) !== (b[0]?.length ?? 0)) {
    for (let r = 0; r < b.length; r++) {
      for (let c = 0; c < (b[r]?.length ?? 0); c++) out.push([r, c]);
    }
    return out;
  }
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) out.push([r, c]);
    }
  }
  return out;
}

function autoCellSize(g: Grid, cap = 20): number {
  const maxDim = Math.max(g.length, g[0]?.length ?? 0, 1);
  return Math.max(10, Math.min(cap, Math.floor(320 / maxDim)));
}

/** Deep-ish clone so loaded programs never alias search internals. */
function cloneProgram(program: Program): Program {
  return program.map((op) => ({
    op: op.op,
    params: Object.fromEntries(
      Object.entries(op.params).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.map((p): [number, number] => [p[0], p[1]]) : v,
      ]),
    ) as OpParams,
  }));
}

function PairBadge(props: { ok: boolean }) {
  return props.ok ? (
    <Badge className="border-transparent bg-emerald-600 text-white" aria-label="Matches expected output">
      <span aria-hidden>✓</span>
    </Badge>
  ) : (
    <Badge className="border-transparent bg-rose-600 text-white" aria-label="Differs from expected output">
      <span aria-hidden>✗</span>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Examples panel
// ---------------------------------------------------------------------------

export interface ExamplesPanelProps {
  task: Task;
  selectedPairIdx: number;
  onSelectPair: (idx: number) => void;
  runAll: boolean;
  onRunAllChange: (v: boolean) => void;
}

export function ExamplesPanel({ task, selectedPairIdx, onSelectPair, runAll, onRunAllChange }: ExamplesPanelProps) {
  return (
    <div className="space-y-4" aria-label="Examples panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">
          Demonstrations <span className="font-normal text-muted-foreground">({task.train.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          <Switch id="wb-run-all" checked={runAll} onCheckedChange={onRunAllChange} aria-label="Run program on all pairs" />
          <Label htmlFor="wb-run-all" className="cursor-pointer text-xs">
            Run on all pairs <span className="text-muted-foreground">(Program panel)</span>
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {task.train.map((p, i) => (
          <PairViewer
            key={i}
            index={i}
            input={p.input}
            output={p.output}
            selected={i === selectedPairIdx}
            onSelect={() => onSelectPair(i)}
            labels={['Input', 'Output']}
          />
        ))}
      </div>

      <div className="rounded-lg border border-dashed p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">Test input{task.test.length > 1 ? `s (${task.test.length})` : ''}</h4>
          <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
            output hidden (research integrity)
          </Badge>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {task.test.map((p, i) => (
            <PairViewer key={i} index={task.train.length + i} input={p.input} output={null} labels={['Test input', 'Hidden output']} />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          The test output is deliberately withheld — like the ARC-AGI evaluation. Predict it with a program in the{' '}
          <strong className="text-foreground">Program</strong> panel, or submit an answer in the Academy.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Objects panel
// ---------------------------------------------------------------------------

export interface ObjectsPanelProps {
  task: Task;
  selectedPairIdx: number;
}

function PropIcon({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Check className="h-3.5 w-3.5 text-emerald-500" role="img" aria-label={`${label}: yes`} />
  ) : (
    <X className="h-3.5 w-3.5 text-zinc-400" role="img" aria-label={`${label}: no`} />
  );
}

export function ObjectsPanel({ task, selectedPairIdx }: ObjectsPanelProps) {
  const patterns = useArcLab((s) => s.patterns);
  const [connectivity, setConnectivity] = React.useState<'4' | '8'>('4');
  const [bg, setBg] = React.useState<Color>(0);
  const [target, setTarget] = React.useState<'input' | 'output' | 'test'>('input');
  const [selectedObjectId, setSelectedObjectId] = React.useState<number | null>(null);

  const pair = task.train[selectedPairIdx] ?? task.train[0];

  const targetGrid = React.useMemo<Grid>(() => {
    if (target === 'output') return pair.output ?? pair.input;
    if (target === 'test') return task.test[0]?.input ?? pair.input;
    return pair.input;
  }, [target, pair, task]);

  const detection = React.useMemo(
    () => findObjects(targetGrid, { bg, connectivity: connectivity === '8' ? 8 : 4 }),
    [targetGrid, bg, connectivity],
  );

  const overlayBoxes = React.useMemo(
    () =>
      detection.objects.map((o, i) => ({
        bbox: o.bbox,
        color: overlayColor(i),
        label: `#${o.id}${o.id === selectedObjectId ? ' ◄' : ''}`,
      })),
    [detection, selectedObjectId],
  );

  const targetLabel =
    target === 'input'
      ? `Pair ${selectedPairIdx + 1} input`
      : target === 'output'
        ? `Pair ${selectedPairIdx + 1} output`
        : 'Test input';

  return (
    <div className="space-y-4" aria-label="Objects panel">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wb-conn" className="mb-1 block text-xs text-muted-foreground">
            Connectivity
          </Label>
          <Select value={connectivity} onValueChange={(v) => setConnectivity(v === '8' ? '8' : '4')}>
            <SelectTrigger id="wb-conn" size="sm" className="w-24" aria-label="Object connectivity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4-way</SelectItem>
              <SelectItem value="8">8-way</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="wb-bg" className="mb-1 block text-xs text-muted-foreground">
            Background
          </Label>
          <Select value={String(bg)} onValueChange={(v) => setBg(Number(v))}>
            <SelectTrigger id="wb-bg" size="sm" className="w-28" aria-label="Background color">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: colorHex(bg) }} aria-hidden />
                {bg} — {colorName(bg)}
              </span>
            </SelectTrigger>
            <SelectContent>
              {ARC_COLORS.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: c.hex }} aria-hidden />
                    {c.id} — {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="wb-target" className="mb-1 block text-xs text-muted-foreground">
            Target grid
          </Label>
          <Select value={target} onValueChange={(v) => setTarget(v === 'output' ? 'output' : v === 'test' ? 'test' : 'input')}>
            <SelectTrigger id="wb-target" size="sm" className="w-44" aria-label="Target grid for object detection">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="input">Selected pair · input</SelectItem>
              <SelectItem value="output">Selected pair · output</SelectItem>
              <SelectItem value="test">Test input</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <GridView
          grid={targetGrid}
          cellSize={autoCellSize(targetGrid, 24)}
          patterns={patterns}
          overlayBoxes={overlayBoxes}
          showCoords
          ariaLabel={`${targetLabel} with ${detection.objects.length} detected object bounding boxes`}
        />
        <p className="max-w-52 text-[11px] leading-snug text-muted-foreground">
          {targetLabel} · {detection.objects.length} object{detection.objects.length === 1 ? '' : 's'} detected with{' '}
          {connectivity}-way connectivity and background {bg} ({colorName(bg)}). Hover a table row to highlight its box.
        </p>
      </div>

      {detection.objects.length > 0 ? (
        <ScrollArea className="h-96 rounded-md border" aria-label="Detected objects table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead className="text-right">size</TableHead>
                <TableHead>color</TableHead>
                <TableHead>bbox</TableHead>
                <TableHead className="text-right">h×w</TableHead>
                <TableHead className="text-center">sym H</TableHead>
                <TableHead className="text-center">sym V</TableHead>
                <TableHead className="text-center">border</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detection.objects.map((o, i) => (
                <TableRow
                  key={o.id}
                  className={cn('cursor-default', o.id === selectedObjectId && 'bg-emerald-500/10')}
                  onMouseEnter={() => setSelectedObjectId(o.id)}
                  onMouseLeave={() => setSelectedObjectId((cur) => (cur === o.id ? null : cur))}
                  onFocus={() => setSelectedObjectId(o.id)}
                  onClick={() => setSelectedObjectId(o.id)}
                >
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs font-bold">
                      <span
                        className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border"
                        style={{ background: colorHex(o.color), outline: `2px solid ${overlayColor(i)}`, outlineOffset: 1 }}
                        aria-hidden
                      />
                      #{o.id}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{o.size}</TableCell>
                  <TableCell className="text-xs">
                    {o.color} — {colorName(o.color)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    r{o.bbox.minR}–{o.bbox.maxR} c{o.bbox.minC}–{o.bbox.maxC}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {o.height}×{o.width}
                  </TableCell>
                  <TableCell className="text-center">
                    <PropIcon ok={o.symmetricH} label="horizontally symmetric" />
                  </TableCell>
                  <TableCell className="text-center">
                    <PropIcon ok={o.symmetricV} label="vertically symmetric" />
                  </TableCell>
                  <TableCell className="text-center">
                    <PropIcon ok={o.touchesBorder} label="touches border" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No objects found — every cell equals the selected background color.
        </p>
      )}

      <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Detected properties are heuristic, not guaranteed ground truth. Connectivity, background choice and the detector all shape what counts as an
        object.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Program panel
// ---------------------------------------------------------------------------

export interface ProgramPanelProps {
  task: Task;
  selectedPairIdx: number;
  runAll: boolean;
  onRunAllChange: (v: boolean) => void;
  program: Program;
  setProgram: React.Dispatch<React.SetStateAction<Program>>;
}

const OP_GROUPS: Array<{ category: OpSpec['category']; label: string; dot: string }> = [
  { category: 'geometry', label: 'Geometry', dot: 'bg-zinc-400' },
  { category: 'shape', label: 'Shape', dot: 'bg-amber-500' },
  { category: 'color', label: 'Color', dot: 'bg-emerald-500' },
  { category: 'object', label: 'Object', dot: 'bg-rose-500' },
];

function TinyNumberInput(props: { value: number; label: string; prefix?: string; onCommit: (n: number) => void }) {
  const [text, setText] = React.useState(String(props.value));
  React.useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
      {props.prefix && <span aria-hidden>{props.prefix}</span>}
      <Input
        type="number"
        className="h-7 w-14 px-1.5 text-xs"
        value={text}
        aria-label={props.label}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) props.onCommit(n);
        }}
      />
    </label>
  );
}

function ColorParamSelect(props: { name: string; value: Color; onChange: (c: Color) => void }) {
  return (
    <Select value={String(props.value)} onValueChange={(v) => props.onChange(Number(v))}>
      <SelectTrigger size="sm" className="h-7 w-[108px] gap-1 px-2 text-xs" aria-label={`Parameter ${props.name}: color`}>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: colorHex(props.value) }} aria-hidden />
          <span className="font-mono">{props.name}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {ARC_COLORS.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: c.hex }} aria-hidden />
              {c.id} — {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inline editors for a single op's params (dr/dc numbers, color selects, mapColor from→to pairs). */
function OpParamsEditor(props: { op: DslOp; onParamChange: (key: string, value: number | Array<[number, number]>) => void }) {
  const { op, onParamChange } = props;
  const entries = Object.entries(op.params ?? {});
  if (entries.length === 0) {
    return (
      <span className="text-[11px] italic text-muted-foreground" aria-label="No parameters">
        no params
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([key, value]) => {
        if (key === 'pairs' && Array.isArray(value)) {
          return (
            <div key={key} className="flex flex-wrap items-center gap-1" aria-label="Color mapping pairs">
              {value.map((pr, pi) => (
                <span key={pi} className="flex items-center gap-0.5 rounded border bg-muted/40 px-1 py-0.5">
                  <TinyNumberInput
                    value={pr[0]}
                    label={`Mapping ${pi + 1}: from color`}
                    onCommit={(n) =>
                      onParamChange(
                        'pairs',
                        value.map((p, i): [number, number] => (i === pi ? [n, p[1]] : [p[0], p[1]])),
                      )
                    }
                  />
                  <span className="text-[10px] text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <TinyNumberInput
                    value={pr[1]}
                    label={`Mapping ${pi + 1}: to color`}
                    onCommit={(n) =>
                      onParamChange(
                        'pairs',
                        value.map((p, i): [number, number] => (i === pi ? [p[0], n] : [p[0], p[1]])),
                      )
                    }
                  />
                </span>
              ))}
            </div>
          );
        }
        if (key === 'color' || key === 'a' || key === 'b') {
          return <ColorParamSelect key={key} name={key} value={Number(value)} onChange={(n) => onParamChange(key, n)} />;
        }
        return (
          <TinyNumberInput
            key={key}
            value={Number(value)}
            prefix={key}
            label={`Parameter ${key}`}
            onCommit={(n) => onParamChange(key, n)}
          />
        );
      })}
    </div>
  );
}

export function ProgramPanel({ task, selectedPairIdx, runAll, onRunAllChange, program, setProgram }: ProgramPanelProps) {
  const patterns = useArcLab((s) => s.patterns);
  const [checks, setChecks] = React.useState<Array<{ ok: boolean; acc: number }> | null>(null);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; grid: Grid } | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<CandidateProgram[] | null>(null);

  const pair = task.train[selectedPairIdx] ?? task.train[0];
  const pairColors = React.useMemo<Color[]>(
    () => uniqueColors([...pair.input, ...(pair.output ?? [])], true),
    [pair],
  );

  // Reset derived inspection state when the program or task changes.
  React.useEffect(() => {
    setChecks(null);
    setTestResult(null);
  }, [program, task.id]);
  React.useEffect(() => {
    setSearchResults(null);
  }, [task.id]);

  const addOp = (spec: OpSpec) => {
    const choices = spec.paramChoices(pairColors);
    const params: OpParams = choices.length > 0 ? { ...choices[0] } : {};
    setProgram((prev) => [...prev, { op: spec.op, params }]);
  };
  const updateParam = (idx: number, key: string, value: number | Array<[number, number]>) =>
    setProgram((prev) => prev.map((o, i) => (i === idx ? { ...o, params: { ...o.params, [key]: value } } : o)));
  const moveOp = (idx: number, dir: -1 | 1) =>
    setProgram((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  const removeOp = (idx: number) => setProgram((prev) => prev.filter((_, i) => i !== idx));

  const computed = React.useMemo(() => applyProgram(pair.input, program), [pair, program]);
  const expected = pair.output ?? null;
  const matches = computed !== null && expected !== null && gridsEqual(computed, expected);

  const runChecks = () => {
    setChecks(
      task.train.map((p) => {
        const out = applyProgram(p.input, program);
        if (!out || !p.output) return { ok: false, acc: 0 };
        return { ok: gridsEqual(out, p.output), acc: pixelAccuracy(out, p.output) };
      }),
    );
  };

  const applyTest = () => {
    const testInput = task.test[0]?.input;
    if (!testInput) return;
    const out = applyProgram(testInput, program);
    setTestResult(out ? { ok: true, grid: out } : { ok: false, grid: testInput });
  };

  const fitsCount = checks ? checks.filter((c) => c.ok).length : 0;
  const fitsAll = checks !== null && checks.length > 0 && fitsCount === checks.length;

  const runSearch = async () => {
    setSearching(true);
    setSearchResults(null);
    try {
      // Yield a frame so the spinner paints before the bounded search blocks.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      const res = searchPrograms(task.train, { maxOps: 2, timeBudgetMs: 2500, topK: 8 });
      setSearchResults(res);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-5" aria-label="Program panel">
      {/* ------------------------------ Op palette ---------------------------- */}
      <section aria-label="Operation palette">
        <h3 className="mb-2 text-sm font-bold">
          Op palette <span className="font-normal text-muted-foreground">— click to append a step</span>
        </h3>
        <div className="space-y-2">
          {OP_GROUPS.map((group) => (
            <div key={group.category} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex w-20 shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn('h-2 w-2 rounded-full', group.dot)} aria-hidden />
                {group.label}
              </span>
              {OP_SPECS.filter((s) => s.category === group.category).map((spec) => (
                <Button
                  key={spec.op}
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => addOp(spec)}
                  aria-label={`Add operation: ${spec.label}`}
                  title={spec.label}
                >
                  {spec.label}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------- Program list --------------------------- */}
      <section aria-label="Program steps">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">
            Program <span className="font-normal text-muted-foreground">({program.length} steps)</span>
          </h3>
          {program.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600 hover:text-rose-700" onClick={() => setProgram([])}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear all
            </Button>
          )}
        </div>
        {program.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Program is empty — add operations from the palette above. They execute left-to-right on the selected pair.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {program.map((op, i) => {
              const spec = getOpSpec(op.op);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-bold"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium">{spec ? spec.describe(op.params ?? {}) : op.op}</span>
                  <OpParamsEditor op={op} onParamChange={(key, value) => updateParam(i, key, value)} />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveOp(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move step ${i + 1} up`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveOp(i, 1)}
                      disabled={i === program.length - 1}
                      aria-label={`Move step ${i + 1} down`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-rose-500 hover:text-rose-600"
                      onClick={() => removeOp(i)}
                      aria-label={`Delete step ${i + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ------------------------------- Execute ------------------------------ */}
      <section aria-label="Execute program" className="rounded-lg border p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">Execute</h3>
          <div className="flex items-center gap-1.5">
            <Switch id="wb-exec-all" checked={runAll} onCheckedChange={onRunAllChange} aria-label="Execute on all pairs" />
            <Label htmlFor="wb-exec-all" className="cursor-pointer text-xs text-muted-foreground">
              all pairs
            </Label>
          </div>
          {!runAll && (
            <Badge variant="outline" className="text-[10px]">
              pair #{selectedPairIdx + 1}
            </Badge>
          )}
        </div>

        {runAll ? (
          <div className="space-y-2">
            {task.train.map((p, i) => {
              const out = applyProgram(p.input, program);
              const ok = out !== null && !!p.output && gridsEqual(out, p.output);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <PairBadge ok={ok} />
                  <span className="text-xs font-semibold">#{i + 1}</span>
                  <PairViewer
                    input={p.input}
                    output={p.output}
                    candidate={out}
                    showDiff
                    cellSize={12}
                    labels={['Input', out ? 'Computed' : 'Failed']}
                  />
                  {out && p.output && (
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(pixelAccuracy(out, p.output) * 100)}% pixels
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {computed === null ? (
                <Badge variant="destructive">Execution failed ✗</Badge>
              ) : matches ? (
                <Badge className="border-transparent bg-emerald-600 text-white">Result matches ✓</Badge>
              ) : (
                <Badge className="border-transparent bg-rose-600 text-white">Result differs ✗</Badge>
              )}
              {computed !== null && expected !== null && !matches && (
                <Badge variant="outline" className="text-[10px]">
                  {Math.round(pixelAccuracy(computed, expected) * 100)}% pixels
                </Badge>
              )}
              {computed === null && (
                <span className="text-[11px] text-muted-foreground">An operation rejected its input — check the parameters.</span>
              )}
            </div>
            <PairViewer
              input={pair.input}
              output={expected}
              candidate={computed}
              showDiff
              cellSize={16}
              labels={['Input', computed ? 'Computed' : 'Expected']}
            />
          </div>
        )}
      </section>

      {/* --------------------------- Consistency ------------------------------ */}
      <section aria-label="Consistency checker" className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">Consistency</h3>
          <Button variant="outline" size="sm" onClick={runChecks}>
            <Play className="h-3.5 w-3.5" aria-hidden /> Check all demonstrations
          </Button>
          {checks && (
            <Badge
              className={cn(
                'border-transparent text-white',
                fitsAll ? 'bg-emerald-600' : 'bg-amber-500 text-black dark:text-black',
              )}
              aria-live="polite"
            >
              {fitsAll ? 'Fits all examples' : `Fits ${fitsCount}/${checks.length}`}
            </Badge>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={applyTest}>
            Apply to test input
          </Button>
        </div>

        {checks && (
          <ul className="grid gap-1 sm:grid-cols-2" aria-label="Per-pair consistency results">
            {checks.map((c, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <PairBadge ok={c.ok} />
                <span className="font-medium">Pair {i + 1}</span>
                <span className="ml-auto font-mono text-muted-foreground">{Math.round(c.acc * 100)}% pixels</span>
              </li>
            ))}
          </ul>
        )}

        {testResult && (
          <div className="flex flex-wrap items-start gap-4 rounded-md border border-dashed p-2">
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {testResult.ok ? 'Program prediction' : 'Prediction failed — input shown'}
              </p>
              <GridView
                grid={testResult.grid}
                cellSize={autoCellSize(testResult.grid)}
                patterns={patterns}
                ariaLabel="Program prediction for the test input"
              />
            </div>
            <p className="max-w-56 text-[11px] leading-snug text-muted-foreground">
              The expected test output is hidden (research integrity). Compare visually, then verify by submitting in the Academy.
            </p>
          </div>
        )}

        {fitsAll && testResult && (
          <Alert className="border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            <AlertTitle>Consistent is not correct</AlertTitle>
            <AlertDescription>
              Fitting the examples does not guarantee the intended rule — verify with held-out checks before trusting this program.
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* ---------------------------- Bounded search --------------------------- */}
      <section aria-label="Bounded program search" className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">Bounded search</h3>
          <Button variant="outline" size="sm" onClick={() => void runSearch()} disabled={searching}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
            Search programs
          </Button>
          <span className="text-[11px] text-muted-foreground">max 2 ops · 2.5s budget · top 8</span>
        </div>
        {searching && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Searching bounded DSL space…
          </p>
        )}
        {!searching && searchResults && (
          <div aria-live="polite">
            {searchResults.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No program found within the bounded space (≤ 2 ops, 2.5s). Try a longer program by hand or widen the search in code.
              </p>
            ) : (
              <ol className="space-y-2">
                {searchResults.map((cand, i) => (
                  <li key={i} className="rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold text-muted-foreground">#{i + 1}</span>
                      {cand.fitsAll ? (
                        <Badge className="border-transparent bg-emerald-600 text-white">Fits all</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                          Partial
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {Math.round(cand.trainPixelAcc * 100)}% pixels
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-6 px-2 text-[11px]"
                        onClick={() => setProgram(cloneProgram(cand.program))}
                        aria-label={`Load candidate ${i + 1} into the program editor`}
                      >
                        Load into editor
                      </Button>
                    </div>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {describeProgram(cand.program).map((d, j) => (
                        <li key={j}>{d}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {!searching && !searchResults && (
          <p className="text-[11px] text-muted-foreground">
            Iterative-deepening enumeration over the 20-op DSL, pruned on the first demonstration. Deterministic and blind to the test output.
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace panel
// ---------------------------------------------------------------------------

export interface TracePanelProps {
  task: Task;
  selectedPairIdx: number;
  program: Program;
}

export function TracePanel({ task, selectedPairIdx, program }: TracePanelProps) {
  const patterns = useArcLab((s) => s.patterns);
  const [stepIdx, setStepIdx] = React.useState(0);
  const pair = task.train[selectedPairIdx] ?? task.train[0];

  const { states, failStep } = React.useMemo(() => {
    const states: Grid[] = [pair.input];
    let failStep: number | null = null;
    for (let i = 0; i < program.length; i++) {
      const out = applyOp(states[i], program[i]);
      if (!out) {
        failStep = i;
        break;
      }
      states.push(out);
    }
    return { states, failStep };
  }, [pair, program]);

  React.useEffect(() => {
    setStepIdx(0);
  }, [selectedPairIdx, task.id]);

  const maxStep = states.length - 1;
  const step = Math.min(Math.max(stepIdx, 0), maxStep);
  const current = states[step];
  const descriptions = React.useMemo(() => describeProgram(program), [program]);
  const changed = React.useMemo(
    () => (step > 0 ? changedCells(states[step - 1], current) : []),
    [states, step, current],
  );

  const stepLabel =
    step === 0
      ? 'Input grid (step 0)'
      : `Step ${step}/${program.length}: ${descriptions[step - 1] ?? '?'} — ${
          failStep !== null && step === failStep ? 'failed ✗' : 'applied'
        }`;

  return (
    <div className="space-y-4" aria-label="Trace panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">
          Execution trace <span className="font-normal text-muted-foreground">— pair #{selectedPairIdx + 1}</span>
        </h3>
        {failStep !== null && (
          <Badge variant="destructive" aria-live="polite">
            Step {failStep + 1} failed — trace stopped
          </Badge>
        )}
      </div>

      {program.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Program is empty — the trace starts from the input grid. Add operations in the Program panel to step through them here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Trace steps">
            {states.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStepIdx(i)}
                aria-label={`Go to trace step ${i}`}
                aria-current={i === step || undefined}
                className={cn(
                  'h-6 rounded-md border px-2 font-mono text-[10px] transition-colors',
                  i === step
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'bg-card hover:bg-accent',
                  failStep !== null && i === failStep && i !== step && 'border-rose-500 text-rose-600',
                )}
              >
                {i === 0 ? 'in' : i}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setStepIdx(Math.max(0, step - 1))}
              disabled={step === 0}
              aria-label="Previous trace step"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Slider
              className="min-w-40 flex-1"
              value={[step]}
              min={0}
              max={Math.max(maxStep, 0)}
              step={1}
              onValueChange={(v) => setStepIdx(v[0] ?? 0)}
              disabled={maxStep === 0}
              aria-label="Execution trace step"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setStepIdx(Math.min(maxStep, step + 1))}
              disabled={step >= maxStep}
              aria-label="Next trace step"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
              {step}/{maxStep}
            </span>
          </div>

          <p className="text-xs" aria-live="polite">
            <span className="font-semibold">{stepLabel}</span>
            {step > 0 && changed.length > 0 && (
              <span className="text-muted-foreground"> · {changed.length} cell{changed.length === 1 ? '' : 's'} changed</span>
            )}
          </p>

          <div className="flex flex-wrap items-start gap-4">
            <GridView
              grid={current}
              cellSize={autoCellSize(current, 24)}
              patterns={patterns}
              highlightCells={changed}
              showCoords
              ariaLabel={`Trace state at step ${step}${changed.length > 0 ? `, ${changed.length} cells changed from previous step` : ''}`}
            />
            <p className="max-w-52 text-[11px] leading-snug text-muted-foreground">
              {step === 0
                ? 'Starting state — the selected pair’s input grid.'
                : failStep !== null && step === failStep
                  ? 'This operation failed on the state above (invalid parameters or impossible transform). The trace stops here.'
                  : 'Highlighted cells changed relative to the previous step.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

