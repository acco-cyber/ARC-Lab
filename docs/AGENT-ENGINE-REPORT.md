# Agent Engine Verification Report — acco-cyber/ARC-AGI-2 inside ARC Lab

**Date:** 2026-02-14 · **Harness:** `scripts/batch-engine-test.ts` (deterministic curriculum sample) · **Budget:** 15 s/task · **Mode:** symbolic CPU (torch-optional patch)

## What was tested

The **actual solver code** from [acco-cyber/ARC-AGI-2](https://github.com/acco-cyber/ARC-AGI-2) — the `arcjepa` package (typed DSL interpreter, beam search, verification, repair, A*, evolution) — vendored under `engine/arcjepa/` and wired into ARC Lab as the **arc-jepa Engine agent** (`/api/agent/arcjepa`). The two torch-dependent modules (`tta`, `memory_prior`) are lazily imported, so the symbolic pipeline runs on CPU-only hosts (verified: no torch installed here).

## Results (12 deterministic curriculum tasks)

| task | exact | pass@2 | pixel | time | program found by the engine |
|------|-------|--------|-------|------|------------------------------|
| w1l1 | ✔ | ✔ | 100% | 0.4s | `INPUT` (identity) |
| w1l9 | ✘ | ✘ | 48% | 5.5s | `MAP_COLOR…SWAP…` (near-miss) |
| w2l7 | ✔ | ✔ | 100% | 0.5s | `CROP INPUT (MERGE (GET_COMPONENTS4 INPUT))` |
| w3l5 | ✔ | ✔ | 100% | 0.5s | `REFLECT_D1 INPUT` |
| w4l3 | ✔ | ✔ | 100% | 8.5s | `COPY (PATTERN_FILL … REFLEC…)` |
| w5l1 | ✔ | ✔ | 100% | 10.5s | `COPY (PATTERN_FILL INPUT … (SWAP…)` |
| w5l9 | ✔ | ✔ | 100% | 5.3s | `MAP_COLOR … 3 2) 7 6) …` |
| w6l7 | ✘ | ✘ | 83% | 12.0s | `SHIFT (REFLECT_V INPUT) (1 0)` |
| w7l5 | ✔ | ✔ | 100% | 0.5s | `MAP_COLOR (REFLECT_H INPUT) 4 6` |
| w8l3 | ✔ | ✔ | 100% | 12.3s | `REFLECT_H INPUT` |
| w9l1 | ✔ | ✔ | 100% | 0.4s | `MAP_COLOR (ROTATE270 INPUT) (MOST_COMMON_COLOR INPUT) 8` |
| w9l9 | ✔ | ✔ | 100% | 0.6s | `ROTATE270 INPUT` |

**Summary: 10/12 exact (83%) · 10/12 pass@2 · 94.2% avg pixel accuracy · 4.76 s avg (CPU).**

Every solved task has a verified DSL program that reproduces **all** demonstration pairs — the engine never receives expected test outputs.

## Also verified (manual, twice)

- **APEX-style agent** (methodology port of the repo's Phase-B "verified program synthesis" notebook): LLM-written programs are accepted only after reproducing every example; repair rounds and direct-grid fallback work as specified.
- **Custom agents**: pasted JavaScript runs sandboxed in a Web Worker, is auto-verified against every example, and scores correctly; HTTP-endpoint adapter contract `{train, testInputs} → {attempts|prediction}`.
- **Built-ins**: copy-bot / rule-sniffer / program-searcher play and score.

## Known limitations (honest)

- The two misses are hard multi-rule compositions (worlds 6/9 mixes); a depth-bounded CPU beam search is not expected to solve every mixed-rule task.
- `difficulty` diagnostics are occasionally `null` when the parse stage exceeds its mini-deadline — cosmetic only.
- Neural stages (TTA, memory prior) require torch + trained weights and stay in the upstream repo; the ARC Lab integration runs the symbolic mode.
