# Engine attribution

This directory vendors the **symbolic search engine of [acco-cyber/ARC-AGI-2](https://github.com/acco-cyber/ARC-AGI-2)** (project *ARC-JEPA: Object-Centric Transformation JEPA with Latent-Guided Program Search for ARC-AGI-2*).

## What was vendored

- `arcjepa/core/` — grid types and validation
- `arcjepa/dsl/` — typed DSL AST, primitives, grammar, interpreter, canonicalizer
- `arcjepa/search/` — the full symbolic pipeline: `parse_task` → difficulty bucket → property/colour-table induction (`induce.py`) → type-constrained beam search (`beam.py`) → verification (`verifier.py`) → local AST repair (`repair.py`) → bounded A* (`astar.py`) → evolutionary repair (`evolution.py`) → `select_two`

## Local modifications (marked `[arc-lab patch]` in the code)

1. `search/__init__.py` and `search/solver.py`: the two torch-dependent modules
   (`tta.py`, `memory_prior.py`) are now imported lazily / guarded, so the
   **symbolic pipeline runs in CPU-only environments without torch**. When a
   neural model *is* supplied, behaviour is unchanged.
2. `engine/arcjepa_agent.py` (new file) — a small CLI adapter that reads an ARC
   task on stdin and emits predictions + diagnostics as JSON, used by the ARC
   Lab Agent Lab (`/api/agent/arcjepa`).

Everything else is upstream code from the acco-cyber repository, imported
unmodified. All neural/training components (`model/`, `training/`, `data/`)
remain in the upstream repository.
