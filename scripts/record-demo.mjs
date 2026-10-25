/**
 * ARC Lab — signature demo recorder.
 * Walks the full human-vs-AI workflow on the real app and records it as video:
 *   Scene 1  Academy  — human paints the answer, submits, "Solved!"
 *   Scene 2  Workbench — search programs, "Fits all", execute on all pairs
 *   Scene 3  Agent Lab — AI agent thinks, paints its answer cell by cell, scored
 *   Scene 4  Arena    — 5 solvers evaluated, comparison bars
 * Output: media-tmp/raw-*.webm (one continuous take, visible fake cursor).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/z/my-project/media-tmp';
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR_JS = `
(() => {
  if (document.getElementById('demo-cursor')) return;
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;width:26px;height:26px;pointer-events:none;transition:transform 90ms cubic-bezier(.2,.7,.3,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));';
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 2 L4 19 L9 14.5 L12.2 21.5 L15 20.2 L11.8 13.4 L18 13 Z" fill="#111827" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  const ring = document.createElement('div');
  ring.id = 'demo-ripple';
  ring.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:9999px;border:3px solid rgba(16,185,129,.9);opacity:0;pointer-events:none;';
  document.body.appendChild(ring);
  document.addEventListener('mousemove', (e) => {
    c.style.transform = 'translate(' + (e.clientX - 2) + 'px,' + (e.clientY - 2) + 'px)';
  }, true);
  document.addEventListener('mousedown', (e) => {
    ring.style.left = e.clientX + 'px';
    ring.style.top = e.clientY + 'px';
    ring.style.transition = 'none';
    ring.style.transform = 'scale(.4)';
    ring.style.opacity = '.95';
    requestAnimationFrame(() => {
      ring.style.transition = 'transform .38s ease-out, opacity .38s ease-out';
      ring.style.transform = 'scale(2.8)';
      ring.style.opacity = '0';
    });
  }, true);
})();
`;

/** glide the fake cursor to a locator, then click like a human */
async function humanClick(page, locator, settle = 160) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.hover();
  await sleep(settle);
  await locator.click({ delay: 45 });
  await sleep(120);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 810 } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
log('page created — video starts here');

await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
await page.evaluate(CURSOR_JS);
page.on('domcontentloaded', () => page.evaluate(CURSOR_JS).catch(() => {}));
await sleep(2200); // hero shot

// ------------------------------------------------------------------ SCENE 1
log('SCENE1: Academy — solve it yourself');
await humanClick(page, page.getByRole('navigation').getByRole('button', { name: 'Academy' }));
await sleep(1100);

await humanClick(page, page.getByRole('button', { name: /Start playing|Continue/ }));
await page.getByRole('gridcell', { name: /^Row 1 column 1:/ }).waitFor({ timeout: 30000 });
await sleep(900); // let the viewer read the puzzle

const paint = async (colorName, colorId, cells) => {
  await humanClick(page, page.getByRole('radio', { name: new RegExp(`^${colorName} color ${colorId}`) }), 140);
  for (const [r, c] of cells) {
    await humanClick(page, page.getByRole('gridcell', { name: new RegExp(`^Row ${r} column ${c}:`) }), 260);
    log(`  painted ${colorName} @ (${r},${c})`);
  }
};
await paint('orange', 7, [[3, 1], [2, 3], [3, 4], [4, 1]]);
await paint('magenta', 6, [[3, 3]]);

log('  submitting…');
await sleep(650); // a human double-checks before submitting
await humanClick(page, page.getByRole('button', { name: 'Submit your answer' }));
await page.getByText(/Solved!/).waitFor({ timeout: 30000 });
log('  SOLVED ✓');
await sleep(2400);

log('  → Open in Workbench');
await humanClick(page, page.getByRole('button', { name: 'Open this puzzle in the Workbench' }));
await sleep(1600);

// ------------------------------------------------------------------ SCENE 2
log('SCENE2: Workbench — build the rule');
const programTab = page.getByRole('tab', { name: 'Program' });
await programTab.waitFor({ timeout: 30000 });
await humanClick(page, programTab);
await sleep(700);

await humanClick(page, page.getByRole('button', { name: 'Search programs' }));
await page.getByText('Fits all', { exact: false }).first().waitFor({ timeout: 30000 });
log('  program found — fits all examples ✓');
await sleep(900);

await humanClick(page, page.getByRole('button', { name: 'Load candidate 1 into the program editor' }));
await sleep(800);
await humanClick(page, page.getByRole('switch', { name: 'Execute on all pairs' }));
await page.getByText(/100% pixels/).first().waitFor({ timeout: 15000 }).catch(() => {});
await sleep(2000);

// ------------------------------------------------------------------ SCENE 3
log('SCENE3: Agent Lab — watch AI attempt the same puzzle');
await humanClick(page, page.getByRole('navigation').getByRole('button', { name: 'Agent Lab' }));
const runAgentBtn = page.getByRole('button', { name: 'Run agent' });
await runAgentBtn.waitFor({ timeout: 30000 });
await sleep(800);

await humanClick(page, page.getByRole('button', { name: /Program Searcher/ }));
await sleep(500);
await humanClick(page, runAgentBtn);
log('  agent running…');

// wait through thinking → painting → scored
await page
  .waitForFunction(() => document.body.innerText.includes('Painting the answer'), { timeout: 45000 })
  .then(() => log('  painting answer cell by cell…'))
  .catch(() => log('  (painting phase label missed — continuing)'));
await page
  .waitForFunction(
    () => /pixel accuracy/i.test(document.body.innerText) || /exact match/i.test(document.body.innerText),
    { timeout: 60000 },
  )
  .then(() => log('  agent scored ✓'))
  .catch(() => log('  (score text missed — continuing)'));
await sleep(2600);

// ------------------------------------------------------------------ SCENE 4
log('SCENE4: Arena — compare solvers');
await humanClick(page, page.getByRole('navigation').getByRole('button', { name: 'Arena' }));
const runEval = page.getByRole('button', { name: 'Run evaluation' });
await runEval.waitFor({ timeout: 30000 });
await sleep(900);

await humanClick(page, runEval);
log('  evaluating solvers…');
await page.waitForSelector('[aria-label*="Exact accuracy"]', { timeout: 120000 });
log('  arena results in ✓');
await page.evaluate(() => document.getElementById('arena-summary-heading')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
await sleep(3400);

log('done — closing context to flush video');
await ctx.close();
await browser.close();
const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
console.log('VIDEO FILES:', files.map((f) => `${OUT}/${f}`).join(', '));
