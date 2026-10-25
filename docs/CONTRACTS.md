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
