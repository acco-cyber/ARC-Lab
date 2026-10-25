'use client';

/**
 * ARC Lab — global client store (zustand).
 * Holds UI state, the anonymous player id, settings, progress cache and
 * cross-experience links (Academy → Workbench → Arena).
 */

import { create } from 'zustand';

export type TabId = 'home' | 'academy' | 'workbench' | 'arena' | 'guide';

export interface ProgressLevel {
  puzzleId: string;
  solved: boolean;
  attempts: number;
  wrongAttempts: number;
  hintsUsed: number;
}

export interface ProgressData {
  xp: number;
  levelInfo: { level: number; title: string; nextAt: number };
  badges: Array<{ id: string; name: string; description: string; emoji: string; earned: boolean }>;
  levels: ProgressLevel[];
  dailies: Array<{ date: string; solved: boolean }>;
  streak: number;
  unlocks: { levels: string[]; worlds: number[] };
}

interface ArcLabState {
  tab: TabId;
  setTab: (tab: TabId) => void;
  playerId: string | null;
  initPlayerId: () => string;
  patterns: boolean;
  togglePatterns: (v?: boolean) => void;
  progress: ProgressData | null;
  setProgress: (p: ProgressData | null) => void;
  /** Cross-links */
  workbenchTaskId: string | null;
  openInWorkbench: (taskId: string) => void;
  clearWorkbenchTask: () => void;
  arenaPresetWorlds: number[] | null;
  arenaPresetIds: string[] | null;
  setArenaPreset: (worlds: number[] | null, ids?: string[] | null) => void;
}

const PLAYER_KEY = 'arc-lab-player-id';

function readPlayerId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).slice(0, 40);
      window.localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return `p-anon-${Date.now().toString(36)}`;
  }
}

export const useArcLab = create<ArcLabState>((set, get) => ({
  tab: 'home',
  setTab: (tab) => set({ tab }),
  playerId: null,
  initPlayerId: () => {
    const existing = get().playerId ?? readPlayerId();
    set({ playerId: existing });
    return existing ?? 'p-anon';
  },
  patterns: false,
  togglePatterns: (v) => set((s) => ({ patterns: v ?? !s.patterns })),
  progress: null,
  setProgress: (p) => set({ progress: p }),
  workbenchTaskId: null,
  openInWorkbench: (taskId) => set({ workbenchTaskId: taskId, tab: 'workbench' }),
  clearWorkbenchTask: () => set({ workbenchTaskId: null }),
  arenaPresetWorlds: null,
  arenaPresetIds: null,
  setArenaPreset: (worlds, ids) => set({ arenaPresetWorlds: worlds, arenaPresetIds: ids ?? null, tab: 'arena' }),
}));
