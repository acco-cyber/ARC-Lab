'use client';

/**
 * ARC Lab — color palette picker (0-9) with accessible names & patterns preview.
 */

import React from 'react';
import { ARC_COLORS, colorName, patternFor } from '@/lib/arc/colors';

export interface ColorPaletteProps {
  selected: number;
  onSelect: (color: number) => void;
  patterns?: boolean;
  compact?: boolean;
  className?: string;
}

export function ColorPalette({ selected, onSelect, patterns = false, compact = false, className }: ColorPaletteProps) {
  const size = compact ? 24 : 30;
  return (
    <div className={className} role="radiogroup" aria-label="Color palette">
      <div className="flex flex-wrap gap-1.5">
        {ARC_COLORS.map((c) => {
          const isSel = selected === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={isSel}
              title={`${c.name} (${c.id})`}
              onClick={() => onSelect(c.id)}
              className="relative rounded-md border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              style={{
                width: size,
                height: size,
                backgroundColor: c.hex,
                backgroundImage: patterns ? patternFor(c.id) || undefined : undefined,
                backgroundSize: patterns ? '10px 10px' : undefined,
                borderColor: isSel ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                outline: isSel ? '2px solid hsl(var(--primary))' : undefined,
                outlineOffset: 1,
              }}
              aria-label={`${colorName(c.id)} color ${c.id}${isSel ? ' (selected)' : ''}`}
            >
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono font-bold"
                style={{ fontSize: size * 0.42, color: c.id === 0 || c.id === 1 || c.id === 9 ? '#fff' : '#000' }}
                aria-hidden
              >
                {c.id}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
