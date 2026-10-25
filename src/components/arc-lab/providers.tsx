'use client';

/**
 * ARC Lab — providers (TanStack Query + next-themes) and shared hooks.
 */

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useArcLab } from '@/lib/store/arc-lab';
import { api } from '@/lib/client/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Initialize the anonymous player id (client-side only). */
export function usePlayerId(): string {
  const playerId = useArcLab((s) => s.playerId);
  const initPlayerId = useArcLab((s) => s.initPlayerId);
  React.useEffect(() => {
    initPlayerId();
  }, [initPlayerId]);
  return playerId ?? '';
}

/** Fetch + cache player progress; exposes refresh(). */
export function useProgress() {
  const playerId = usePlayerId();
  const setProgress = useArcLab((s) => s.setProgress);
  const query = useQuery({
    queryKey: ['progress', playerId],
    queryFn: () => api.progress(playerId),
    enabled: playerId.length > 0,
  });
  React.useEffect(() => {
    if (query.data) setProgress(query.data);
  }, [query.data, setProgress]);
  return { ...query, refresh: () => query.refetch() };
}
