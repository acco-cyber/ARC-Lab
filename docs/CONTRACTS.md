# ARC Lab — API & Component Contracts

This document is the single source of truth for the interfaces between the
ARC Lab experiences and the backend. Useful for contributors and for external
solvers that want to participate in Arena evaluations.

## Domain types (`src/lib/arc/types.ts`)

- `Grid = number[][]` — rectangular matrix, values 0–9 (10 ARC colors).
- `Task { id, schemaVersion, train: Pair[], test: Pair[], metadata }`
- `Pair { input: Grid, output?: Grid | null }`
- `validateArcJson(data)` — accepts standard ARC JSON; preserves unknown fields.

## API

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | liveness | `{ok, service, time}` |
| `GET /api/puzzles` | manifest | worlds + 100 levels + today's daily id |
| `GET /api/puzzles/[id]?playerId=` | task with test output **hidden** | daily ids `daily-YYYY-MM-DD` supported |
| `POST /api/puzzles/[id]/submit` | validate answer | body `{playerId, grid, mode: practice\|challenge, revealIfWrong?}` → `{correct, attempts, wrongAttempts, failed, firstSolve, xpAwarded, expected?, explanation?}`. Expected output only revealed when correct, failed (2 wrong in challenge), or explicitly requested in practice. |
| `POST /api/puzzles/[id]/hint` | tiered hint | body `{playerId, tier: 1..3}`; records max tier used (reduces XP) |
| `GET /api/progress?playerId=` | full profile | XP, level, badges, levels, dailies, streak, unlocks |
| `GET /api/daily?playerId=` | today's daily | deterministic per Asia/Dhaka date |
| `POST /api/arena/run` | run solvers | body `{playerId?, solvers: string[], scope}`; scope = `{type:'curriculum', worlds?, ids?, limit?}` or `{type:'inline', tasks: [...]}`. Returns `{runId, createdAt, config, summary, perTask, solverCatalog}`. LLM solver caps tasks at 5. |
| `GET /api/arena/runs?playerId=` | run history | summaries only |
| `GET /api/arena/runs/[id]` | full run | config + summary + perTask |

Answers are never sent to the client before submission — all validation and XP
accounting happens server-side.

## Program search / DSL (`src/lib/arc/dsl.ts`)

- `DslOp { op, params }` — 20 ops across geometry/shape/color/object categories.
- `applyProgram(grid, program) → Grid | null`
- `searchPrograms(train, {maxOps, maxPrograms, timeBudgetMs, topK}) → CandidateProgram[]`
  ranked by consistency (fits all demonstrations), simplicity, pixel accuracy.
  Deterministic; never sees the test output.

## Solver interface (`src/lib/arc/solvers.ts`)

```ts
interface SolverDef {
  id: string;                    // e.g. 'program-search'
  name: string; kind: 'baseline'|'search'|'llm'|'ensemble';
  description: string; limitations: string;
  run(train: Pair[], testInput: Grid): Promise<{predictions: Grid[]; note?: string}> | same;
}
```

Solvers receive ONLY demonstration pairs and the test input. Up to 2
predictions are used for pass@2. External solvers can call
`POST /api/arena/run` with `{type:'inline', tasks:[...]}` to evaluate their own
prediction pipeline by POSTing task JSON and comparing (a submission-style
endpoint is on the roadmap).

## XP rules (`src/lib/arc/progress.ts`)

- Challenge solve: `100 + world*10` + first-try bonus 25 + no-hint bonus 25 − hint penalty (15/30/50 by max tier), floor 10.
- Practice solve: 25 base (same bonuses/penalties), 5 XP consolation per wrong practice attempt.
- Daily solve: 150 base. Streak = consecutive solved days.
- Unlocks: level n+1 after solving n; world w after ≥5 solves in world w−1.

## Shared UI primitives (`src/components/arc/`)

- `GridView` — render a grid (+ highlightCells, overlayBoxes, patterns).
- `GridEditor` — paint/resize/undo/redo/copy; keyboard: arrows, 0–9, Delete.
- `ColorPalette` — 10 ARC colors, radiogroup.
- `PairViewer` — input→output with candidate diff highlighting.

---

## Official ARC-AGI-2 data + fresh-puzzle queue (v3)

### Data

- `data/arc-agi-2/{training,evaluation}/*.json` — 1,000 + 120 official tasks vendored from github.com/arcprize/ARC-AGI-2 (Apache-2.0). Provenance: `data/arc-agi-2/SOURCE.md`.
- `data/arc-agi-2/{training,evaluation}-index.json` — lightweight metadata index (id, nTrain, nTest, hasOutput).
- Server lib: `src/lib/server/official.ts` — index cache, task loader (`loadOfficialTask(ds, id, reveal)` — reveal=false withholds test outputs), unseen picker, scorer (`scoreAttempts`), history/reset, `markServed`.

### HTTP API

| Route | Method | Contract |
|---|---|---|
| `/api/official/summary` | GET | `{source, alsoAvailableAs[], license, counts:{training,evaluation}, note}` |
| `/api/official/next?playerId&agentId&dataset=` | GET | Picks a uniformly random task **not yet served** to (playerId, agentId, dataset) and **records the hand-out immediately** → `{exhausted:false, dataset, taskId, seen, total, freshNumber, task}` (task.test has NO outputs). When every task has been served: `{exhausted:true, seen, total, message}`. |
| `/api/official/score` | POST | `{playerId, agentId, dataset, taskId, attempts: Grid[][], elapsedMs?, engine?}` → scores server-side, upserts `AgentPuzzleRun`, reveals answers → `{ok, score:{exact,pass2,pixelAcc,shapeOk,diffCells,failure}, expected: Grid[]}` |
| `/api/official/history?playerId&agentId[&runs=1]` | GET | `{history:{[ds]:{seen,solved,total}}, runs[]}` |
| `/api/official/history?playerId&agentId[&dataset=]` | DELETE | Reset the never-repeat history → `{ok, deleted}` |
| `/api/official/task?dataset=&id=<8hex\|random>[&reveal=1]` | GET | `{dataset, reveal, id, task, expected}` — Workbench loader (reveal=1 includes outputs) |

### DB

- `AgentPuzzleRun` (Prisma): `@@unique([playerId, agentId, dataset, taskId])`; rows are created at SERVE time (`exact=null`) and updated at SCORE time — the uniqueness is what enforces "never serve the same puzzle twice".

### Notebook agent (`src/lib/server/notebook.ts`, `/api/agent/notebook`)

- POST `{action:'analyze', source:{url|content}}` → `{ok, analysis, agentId}` — `agentId = 'nb-' + sha256(notebook)[:8]` (independent fresh-puzzle queue per notebook).
- POST `{action:'run', source, dataset, playerId, count≤5, samples?, repairSamples?}` → analyze → per fresh puzzle: pick unseen → `markServed` → execute notebook cells in a python3 sandbox (`PY_EXEC_RUNNER`: per-cell stdout/errors, entrypoint probe with convention fitting on demos) → if no entrypoint: methodology mode (LLM writes Python `transform(grid)` using the notebook's own `%%writefile` toolkit, verified by `PY_VERIFY_RUNNER`, repair rounds) → LLM direct fallback → score + record → `{ok, analysis, agentId, summary, results:[{taskId, testInput, attempts, expected, score, steps, execLog, entrypoint?, program?, engine, elapsedMs}]}`
- URL allowlist: github.com / raw.githubusercontent.com / gist.githubusercontent.com / huggingface.co / arcprize.org (blob→raw rewrite for github). Max 5 MB.
- Honest labeling: the engine string always states what actually ran (direct execution / methodology replay with substituted backend / LLM direct fallback).

### UI

- `src/components/agent/notebook-agent.tsx` — Notebook Agent card (URL/upload → analysis panel → dataset+count → fresh-puzzle test results with grids, trace, exec log, program).
- `src/components/agent/agent-lab.tsx` — "Official ARC-AGI-2" puzzle tab ("Serve me a NEW puzzle", fresh #n · seen/total counter, per-agent reset, "Next fresh puzzle"); `AgentPlay` gets `remote` (server-side scoring against withheld answers) + `onRemoteScored`.
- `src/components/agent/agent-play.tsx` — when `remote` is set and the task has no local output, scoring POSTs to `/api/official/score` and reveals the expected grid only after commit.
- `src/components/workbench/task-io.tsx` — Official ARC-AGI-2 loader (dataset select + id input + "Surprise me" random).
