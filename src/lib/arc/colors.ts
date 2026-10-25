/**
 * ARC Lab — the 10 standard ARC colors.
 */

export interface ArcColor {
  id: number;
  hex: string;
  name: string;
}

export const ARC_COLORS: ArcColor[] = [
  { id: 0, hex: '#000000', name: 'black' },
  { id: 1, hex: '#0074D9', name: 'blue' },
  { id: 2, hex: '#FF4136', name: 'red' },
  { id: 3, hex: '#2ECC40', name: 'green' },
  { id: 4, hex: '#FFDC00', name: 'yellow' },
  { id: 5, hex: '#AAAAAA', name: 'gray' },
  { id: 6, hex: '#F012BE', name: 'magenta' },
  { id: 7, hex: '#FF851B', name: 'orange' },
  { id: 8, hex: '#7FDBFF', name: 'cyan' },
  { id: 9, hex: '#870C25', name: 'maroon' },
];

export const ARC_HEX: string[] = ARC_COLORS.map((c) => c.hex);

export function colorHex(id: number): string {
  return ARC_HEX[id] ?? '#000000';
}

export function colorName(id: number): string {
  return ARC_COLORS[id]?.name ?? `color ${id}`;
}

/**
 * Subtle per-color texture overlays for color-blind accessible rendering.
 * Applied as CSS background-image on top of the cell fill.
 */
export const COLOR_PATTERNS: string[] = [
  '', // 0 black — base
  'repeating-linear-gradient(45deg, rgba(255,255,255,.85) 0 1px, transparent 1px 4px)', // 1 blue — diagonal /
  'radial-gradient(circle at 50% 50%, rgba(255,255,255,.9) 0 1px, transparent 1.6px)', // 2 red — dot
  'repeating-linear-gradient(0deg, rgba(0,0,0,.55) 0 1px, transparent 1px 4px)', // 3 green — horizontal lines
  'repeating-linear-gradient(90deg, rgba(0,0,0,.45) 0 1px, transparent 1px 4px)', // 4 yellow — vertical lines
  'repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 1.5px, transparent 1.5px 5px)', // 5 gray — diagonal \
  'repeating-linear-gradient(45deg, rgba(0,0,0,.5) 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, rgba(0,0,0,.5) 0 1px, transparent 1px 3px)', // 6 magenta — crosshatch
  'radial-gradient(circle at 50% 50%, rgba(0,0,0,.6) 0 1.5px, transparent 2.2px)', // 7 orange — big dot
  'repeating-linear-gradient(90deg, rgba(0,0,0,.5) 0 2px, transparent 2px 5px)', // 8 cyan — thick vertical
  'repeating-linear-gradient(0deg, rgba(255,255,255,.35) 0 1.5px, transparent 1.5px 4px)', // 9 maroon — light horizontal
];

export function patternFor(color: number): string {
  return COLOR_PATTERNS[color] ?? '';
}
