import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** Ensure a player row exists for the anonymous local player id. */
export async function ensurePlayer(playerId: string | null | undefined): Promise<string | null> {
  if (!playerId || typeof playerId !== 'string' || playerId.length < 6 || playerId.length > 64) return null;
  try {
    await db.player.upsert({ where: { id: playerId }, create: { id: playerId }, update: {} });
    return playerId;
  } catch {
    return null;
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(err: unknown) {
  console.error('[api]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
