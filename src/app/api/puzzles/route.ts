import { NextResponse } from 'next/server';
import { listManifest, WORLDS, dailyIdForDate, todayKey } from '@/lib/arc/curriculum';
import { ARC_LAB_DATASET_VERSION } from '@/lib/arc/types';

export async function GET() {
  return NextResponse.json({
    worlds: WORLDS.map((w) => ({
      id: w.id,
      name: w.name,
      tagline: w.tagline,
      difficulty: w.difficulty,
      skills: w.skills,
    })),
    levels: listManifest(),
    dailyId: dailyIdForDate(todayKey()),
    datasetVersion: ARC_LAB_DATASET_VERSION,
  });
}
