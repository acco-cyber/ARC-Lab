'use client';

/**
 * ARC Lab — read-only grid renderer.
 * Renders an ARC grid with authentic colors, optional color-blind patterns,
 * highlight overlays (cells / bounding boxes), and optional cell click.
 */

import React from 'react';
import type { Grid } from '@/lib/arc/types';
import { colorHex, colorName, patternFor } from '@/lib/arc/colors';
import type { BBox } from '@/lib/arc/objects';

export interface GridOverlayBox {
  bbox: BBox;
  color: string; // CSS color for the outline
  label?: string;
}

export interface GridViewProps {
  grid: Grid;
  cellSize?: number;
  patterns?: boolean;
  highlightCells?: Array<[number, number]>;
  overlayBoxes?: GridOverlayBox[];
  showValues?: boolean;
  showCoords?: boolean;
  onCellClick?: (r: number, c: number) => void;
  className?: string;
  ariaLabel?: string;
}

export const GridView = React.memo(function GridView({
  grid,
  cellSize = 18,
  patterns = false,
  highlightCells,
  overlayBoxes,
  showValues = false,
  showCoords = false,
  onCellClick,
  className,
  ariaLabel,
}: GridViewProps) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const highlightSet = React.useMemo(() => new Set((highlightCells ?? []).map(([r, c]) => `${r}:${c}`)), [highlightCells]);
  const label =
    ariaLabel ??
    `ARC grid ${h} rows by ${w} columns. ` +
      grid
        .slice(0, 4)
        .map((row, i) => `Row ${i + 1}: ${row.slice(0, 8).map((c) => colorName(c)).join(', ')}`)
        .join('. ');

  const gap = cellSize >= 22 ? 2 : 1;
  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${w}, ${cellSize}px)`,
    gap: `${gap}px`,
    padding: `${gap + 1}px`,
    background: 'hsl(var(--foreground) / 0.85)',
    borderRadius: 6,
    width: 'fit-content',
    position: 'relative',
  };

  return (
    <div className={className}>
      {showCoords && (
        <div className="mb-1 text-[10px] font-mono text-muted-foreground" aria-hidden>
          {h}×{w}
        </div>
      )}
      <div style={style} role="img" aria-label={label}>
        {grid.map((row, r) =>
          row.map((color, c) => {
            const isHi = highlightSet.has(`${r}:${c}`);
            const inner: React.CSSProperties = {
              width: cellSize,
              height: cellSize,
              backgroundColor: colorHex(color),
              backgroundImage: patterns ? patternFor(color) || undefined : undefined,
              backgroundSize: patterns ? `${Math.max(4, cellSize / 2)}px ${Math.max(4, cellSize / 2)}px` : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: isHi ? '2px solid hsl(var(--primary))' : undefined,
              outlineOffset: -1,
              zIndex: 1,
            };
            const content =
              showValues && cellSize >= 20 ? (
                <span
                  style={{
                    fontSize: Math.max(8, cellSize * 0.45),
                    color: color === 0 || color === 1 || color === 9 ? '#fff' : '#000',
                    fontWeight: 600,
                    lineHeight: 1,
                    pointerEvents: 'none',
                  }}
                >
                  {color}
                </span>
              ) : null;
            if (onCellClick) {
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  style={{ ...inner, cursor: 'pointer', border: 'none', padding: 0 }}
                  onClick={() => onCellClick(r, c)}
                  aria-label={`Cell row ${r + 1} column ${c + 1}, ${colorName(color)}`}
                  tabIndex={-1}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={`${r}-${c}`} style={inner} aria-hidden>
                {content}
              </div>
            );
          }),
        )}
        {/* bounding box overlays */}
        {(overlayBoxes ?? []).map((box, i) => (
          <div
            key={`box-${i}`}
            style={{
              position: 'absolute',
              left: box.bbox.minC * (cellSize + gap) + gap / 2,
              top: box.bbox.minR * (cellSize + gap) + gap / 2,
              width: (box.bbox.maxC - box.bbox.minC + 1) * (cellSize + gap),
              height: (box.bbox.maxR - box.bbox.minR + 1) * (cellSize + gap),
              border: `2px dashed ${box.color}`,
              borderRadius: 3,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {box.label && (
              <span
                style={{
                  position: 'absolute',
                  top: -16,
                  left: -2,
                  fontSize: 9,
                  fontWeight: 700,
                  color: box.color,
                  background: 'hsl(var(--background))',
                  padding: '0 3px',
                  borderRadius: 3,
                  lineHeight: '14px',
                }}
              >
                {box.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
