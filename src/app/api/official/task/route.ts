import { NextRequest, NextResponse } from 'next/server';
import { badRequest } from '@/lib/server/api';
import { isOfficialDataset, loadOfficialTask, officialIndex } from '@/lib/server/official';

/**
 * GET /api/official/task?dataset=training|evaluation&id=<8hex|random>[&reveal=1]
 * Loads one official task (id=random picks a uniformly random task). Without
 * `reveal=1` the test output is withheld (research integrity); the Workbench
 * debugger may pass reveal=1 explicitly.
 */
export async function GET(req: NextRequest) {
  const ds = req.nextUrl.searchParams.get('dataset');
  let id = (req.nextUrl.searchParams.get('id') ?? '').toLowerCase();
  if (!isOfficialDataset(ds)) return badRequest('dataset must be training or evaluation');
  if (id === 'random') {
    const all = officialIndex(ds);
    if (all.length === 0) return badRequest('dataset is empty');
    id = all[Math.floor(Math.random() * all.length)].id;
  }
  if (!/^[0-9a-f]{8}$/.test(id)) return badRequest('valid 8-hex task id (or "random") required');
  const reveal = req.nextUrl.searchParams.get('reveal') === '1';
  const payload = loadOfficialTask(ds, id, reveal);
  if (!payload) return badRequest('task not found in this dataset');
  return NextResponse.json({ dataset: ds, reveal, id, ...payload });
}
