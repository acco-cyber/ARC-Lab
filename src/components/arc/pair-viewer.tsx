'use client';

/**
 * ARC Lab — input → output pair viewer with optional candidate diff.
 */

import React from 'react';
import { ArrowRight, CircleHelp } from 'lucide-react';
import { GridView } from './grid-view';
import type { Grid } from '@/lib/arc/types';
import { diffGrids } from '@/lib/arc/grid';

export interface PairViewerProps {
  input: Grid;
  output?: Grid | null;
  /** A candidate answer to display instead of / next to the expected output. */
  candidate?: Grid | null;
  /** Highlight mismatches between candidate and output. */
  showDiff?: boolean;
  cellSize?: number;
  patterns?: boolean;
  labels?: [string, string];
  className?: string;
  index?: number;
  onSelect?: () => void;
  selected?: boolean;
}

export function PairViewer({
  input,
  output,
  candidate,
  showDiff = false,
  cellSize = 16,
  patterns = false,
  labels,
  className,
  index,
  onSelect,
  selected,
}: PairViewerProps) {
  const diffs = React.useMemo(() => {
    const target = output ?? null;
    if (!showDiff || !target || !candidate) return [];
    const d = diffGrids(candidate, target);
    if (!d.shapeEqual) return [];
    const out: Array<[number, number]> = [];
    for (let r = 0; r < target.length; r++) {
      for (let c = 0; c < target[r].length; c++) {
        if (candidate[r]?.[c] !== target[r][c]) out.push([r, c]);
      }
    }
    return out;
  }, [showDiff, output, candidate]);

  const shown = candidate ?? output ?? null;
  const autoSize = React.useMemo(() => {
    // scale down for large grids
    const maxDim = Math.max(input.length, input[0]?.length ?? 0, shown?.length ?? 0, shown?.[0]?.length ?? 0);
    return Math.max(10, Math.min(cellSize, Math.floor(240 / Math.max(1, maxDim))));
  }, [input, shown, cellSize]);

  return (
    <div
      className={
        'flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors ' +
        (selected ? 'border-primary bg-primary/5 ' : 'bg-card ') +
        (onSelect ? 'cursor-pointer hover:border-primary/60 ' : '') +
        (className ?? '')
      }
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={onSelect ? !!selected : undefined}
    >
      {typeof index === 'number' && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold" aria-hidden>
          {index + 1}
        </span>
      )}
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{labels?.[0] ?? 'Input'}</p>
        <GridView grid={input} cellSize={autoSize} patterns={patterns} />
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {candidate ? labels?.[1] ?? 'Candidate' : output ? labels?.[1] ?? 'Output' : 'Hidden output'}
        </p>
        {shown ? (
          <GridView grid={shown} cellSize={autoSize} patterns={patterns} highlightCells={diffs} />
        ) : (
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-md border border-dashed text-muted-foreground" aria-label="Output hidden until submission">
            <CircleHelp className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
