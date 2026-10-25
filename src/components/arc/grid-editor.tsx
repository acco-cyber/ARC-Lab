'use client';

/**
 * ARC Lab — interactive grid editor.
 * Paint cells (click + drag), resize, fill, clear, undo/redo, copy from source.
 * Keyboard: arrow keys move focus, number keys paint, Delete/Backspace erases.
 */

import React from 'react';
import {
  ChevronsDown,
  ChevronsUp,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eraser,
  PaintBucket,
  RotateCcw,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Grid } from '@/lib/arc/types';
import { colorHex, colorName, patternFor } from '@/lib/arc/colors';
import { cloneGrid, makeGrid } from '@/lib/arc/grid';

export interface GridEditorProps {
  grid: Grid;
  onChange: (grid: Grid) => void;
  selectedColor: number;
  patterns?: boolean;
  maxDim?: number;
  readOnly?: boolean;
  /** Optional reference grid (e.g. the puzzle input) for the "copy" button. */
  copySource?: Grid | null;
  /** Hide the toolbar (palette stays). */
  compactToolbar?: boolean;
  className?: string;
  ariaLabel?: string;
}

const TOOLBTN = 'h-8 w-8 p-0';

export function GridEditor({
  grid,
  onChange,
  selectedColor,
  patterns = false,
  maxDim = 30,
  readOnly = false,
  copySource = null,
  compactToolbar = false,
  className,
  ariaLabel = 'Interactive ARC grid editor',
}: GridEditorProps) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const paintingRef = React.useRef(false);
  const [history, setHistory] = React.useState<Grid[]>([]);
  const [redoStack, setRedoStack] = React.useState<Grid[]>([]);
  const cellRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  const commit = React.useCallback(
    (next: Grid) => {
      setHistory((hist) => [...hist.slice(-99), grid]);
      setRedoStack([]);
      onChange(next);
    },
    [grid, onChange],
  );

  const paint = React.useCallback(
    (r: number, c: number) => {
      if (readOnly) return;
      if (grid[r]?.[c] === selectedColor) return;
      const next = cloneGrid(grid);
      next[r][c] = selectedColor;
      setHistory((hist) => [...hist.slice(-99), grid]);
      setRedoStack([]);
      onChange(next);
    },
    [grid, selectedColor, onChange, readOnly],
  );

  React.useEffect(() => {
    const up = () => {
      paintingRef.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const undo = React.useCallback(() => {
    setHistory((hist) => {
      if (hist.length === 0) return hist;
      const prev = hist[hist.length - 1];
      setRedoStack((rd) => [...rd, grid]);
      onChange(prev);
      return hist.slice(0, -1);
    });
  }, [grid, onChange]);

  const redo = React.useCallback(() => {
    setRedoStack((rd) => {
      if (rd.length === 0) return rd;
      const next = rd[rd.length - 1];
      setHistory((hist) => [...hist, grid]);
      onChange(next);
      return rd.slice(0, -1);
    });
  }, [grid, onChange]);

  const resize = (dh: number, dw: number) => {
    const nh = Math.max(1, Math.min(maxDim, h + dh));
    const nw = Math.max(1, Math.min(maxDim, w + dw));
    if (nh === h && nw === w) return;
    commit(resizeTo(grid, nh, nw));
  };

  const onCellKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    const move = (nr: number, nc: number) => {
      if (nr < 0 || nr >= h || nc < 0 || nc >= w) return;
      cellRefs.current.get(`${nr}:${nc}`)?.focus();
      e.preventDefault();
    };
    if (e.key === 'ArrowUp') move(r - 1, c);
    else if (e.key === 'ArrowDown') move(r + 1, c);
    else if (e.key === 'ArrowLeft') move(r, c - 1);
    else if (e.key === 'ArrowRight') move(r, c + 1);
    else if (/^[0-9]$/.test(e.key) && !readOnly) {
      commit(withCell(grid, r, c, Number(e.key)));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
      commit(withCell(grid, r, c, 0));
    }
  };

  const gap = 2;
  const canUndo = history.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={className}>
        {/* toolbar */}
        {!compactToolbar && !readOnly && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Grid editor tools">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={undo} disabled={!canUndo} aria-label="Undo">
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={redo} disabled={!canRedo} aria-label="Redo">
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo</TooltipContent>
            </Tooltip>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={TOOLBTN}
                  onClick={() => commit(makeGrid(h, w, selectedColor))}
                  aria-label={`Fill all with ${colorName(selectedColor)}`}
                >
                  <PaintBucket className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fill all with selected color</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => commit(makeGrid(h, w, 0))} aria-label="Clear grid">
                  <Eraser className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear to black (0)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => commit(makeGrid(h, w, 0))} aria-label="Reset grid">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset</TooltipContent>
            </Tooltip>
            {copySource && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2"
                    onClick={() => commit(cloneGrid(copySource))}
                    aria-label="Copy source grid into editor"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span className="text-xs">Copy input</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy the input grid as a starting point</TooltipContent>
              </Tooltip>
            )}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => resize(-1, 0)} disabled={h <= 1} aria-label="Remove row">
                  <ChevronsUp className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>− row</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => resize(1, 0)} disabled={h >= maxDim} aria-label="Add row">
                  <ChevronsDown className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>+ row</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => resize(0, -1)} disabled={w <= 1} aria-label="Remove column">
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>− column</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={TOOLBTN} onClick={() => resize(0, 1)} disabled={w >= maxDim} aria-label="Add column">
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>+ column</TooltipContent>
            </Tooltip>
            <span className="ml-1 font-mono text-xs text-muted-foreground" aria-live="polite">
              {h}×{w}
            </span>
          </div>
        )}
        {/* grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${w}, 24px)`,
            gap: `${gap}px`,
            padding: `${gap + 1}px`,
            background: 'hsl(var(--foreground) / 0.85)',
            borderRadius: 6,
            width: 'fit-content',
            touchAction: 'none',
          }}
          role="grid"
          aria-label={ariaLabel}
        >
          {grid.map((row, r) =>
            row.map((color, c) => (
              <button
                key={`${r}:${c}`}
                ref={(el) => {
                  if (el) cellRefs.current.set(`${r}:${c}`, el);
                  else cellRefs.current.delete(`${r}:${c}`);
                }}
                type="button"
                role="gridcell"
                aria-label={`Row ${r + 1} column ${c + 1}: ${colorName(color)}. Press to paint ${colorName(selectedColor)}.`}
                disabled={readOnly}
                style={{
                  width: 24,
                  height: 24,
                  backgroundColor: colorHex(color),
                  backgroundImage: patterns ? patternFor(color) || undefined : undefined,
                  backgroundSize: patterns ? '12px 12px' : undefined,
                  border: 'none',
                  padding: 0,
                  cursor: readOnly ? 'default' : 'crosshair',
                  opacity: readOnly ? 0.9 : 1,
                }}
                onPointerDown={() => {
                  if (readOnly) return;
                  paintingRef.current = true;
                  paint(r, c);
                }}
                onPointerEnter={() => {
                  if (paintingRef.current && !readOnly) paint(r, c);
                }}
                onKeyDown={(e) => onCellKeyDown(e, r, c)}
                className="focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              />
            )),
          )}
        </div>
        {!readOnly && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click or drag to paint with the selected color. Keyboard: arrows move, 0–9 paint, Delete erases.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

function resizeTo(g: Grid, nh: number, nw: number): Grid {
  const out = makeGrid(nh, nw, 0);
  for (let r = 0; r < Math.min(nh, g.length); r++) {
    for (let c = 0; c < Math.min(nw, g[r].length); c++) out[r][c] = g[r][c];
  }
  return out;
}

function withCell(g: Grid, r: number, c: number, value: number): Grid {
  const next = cloneGrid(g);
  if (next[r]?.[c] !== undefined) next[r][c] = value;
  return next;
}
