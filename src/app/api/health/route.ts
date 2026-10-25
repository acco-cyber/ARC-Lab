import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, service: 'arc-lab', time: new Date().toISOString() });
}
