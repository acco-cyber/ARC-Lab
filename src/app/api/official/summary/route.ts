import { NextResponse } from 'next/server';
import { officialCounts } from '@/lib/server/official';

/** GET /api/official/summary — vendored official ARC-AGI-2 dataset stats. */
export async function GET() {
  return NextResponse.json({
    source: 'github.com/arcprize/ARC-AGI-2',
    alsoAvailableAs: ['Kaggle ARC Prize 2026 competition data (public split)', 'arcprize.org/tasks?v=2 task viewer (120 public evaluation tasks)'],
    license: 'Apache-2.0 (upstream repository)',
    counts: officialCounts(),
    note: 'All 1,120 public tasks (1,000 training + 120 evaluation) are vendored in the app. The semi-private and fully-private competition sets are not public.',
  });
}
