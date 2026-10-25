# Contributing to ARC Lab

Thanks for your interest in making ARC Lab better — for puzzle players, researchers and agent builders alike. This document gets you from clone to first PR.

## Project quick start

```bash
git clone https://github.com/acco-cyber/ARC-Lab.git
cd ARC-Lab
bun install        # or npm install
bun run db:push    # create the local SQLite database
bun run dev        # http://localhost:3000
bun run lint       # ESLint — must pass before any PR
```

No secrets are needed to run the project. The optional LLM agents use a backend SDK when present and degrade gracefully when it isn't — **PRs must not require API keys to pass CI or local testing.**

## What to work on

Good first issues are labeled [`good first issue`](https://github.com/acco-cyber/ARC-Lab/labels/good%20first%20issue). Typical areas:

1. **Academy** — new curriculum worlds/level generators (must stay deterministic per seed), hint quality, accessibility.
2. **Workbench** — new DSL ops (with semantics matching the existing 20), better object heuristics, trace UX.
3. **Agent Lab** — new built-in agents, better notebook analysis, sandbox improvements (see SECURITY.md first).
4. **Arena** — new solvers/baselines, metrics, failure-taxonomy refinements, reproducibility exports.

## Ground rules

1. **One shared ARC core.** Grid semantics live in `src/lib/arc/`. Do not reimplement grid math in a component — import the core. Any transform you add must be defined once, in `src/lib/arc/transforms.ts` (or `dsl.ts`), with typed inputs/outputs.
2. **Evaluator integrity is non-negotiable.** Solver/search code must never read expected test outputs before prediction. If your change touches scoring paths, explain in the PR how the anti-leakage property is preserved (see SECURITY.md).
3. **Determinism where it matters.** Curriculum generation, program search and batch tests must be reproducible from seeds; no `Math.random()` in those paths (the core RNG is in `src/lib/arc/rng.ts`).
4. **Honest results.** Never fabricate or inflate metrics in docs/UI copy. Distinguish "fits examples" from "solves the test case" everywhere.
5. **Security-sensitive changes** (sandbox, notebook runner, scoring) require a clear threat-model note in the PR description.
6. **No new heavyweight dependencies** without discussion first.

## Pull request checklist

- [ ] `bun run lint` passes
- [ ] The feature was exercised end-to-end in the browser (all four experiences share state — check the flows you touched *and* their hand-offs)
- [ ] New UI is responsive down to 390px and keyboard-accessible
- [ ] Docs updated (README feature lists / SECURITY.md when behavior changes)
- [ ] No secrets, tokens or generated data dumps committed

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) with steps, expected vs actual behavior, and browser/OS. For security issues, follow [SECURITY.md](SECURITY.md) (private disclosure).

## Style

TypeScript strict, functional React components, shadcn/ui for primitives, Tailwind for styling. Prefer small pure functions in `lib/` over logic inside components.
