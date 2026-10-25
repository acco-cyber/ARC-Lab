#!/usr/bin/env python3
"""ARC Lab — arcjepa engine adapter (CLI).

Runs the *actual* arc-jepa symbolic solver from acco-cyber/ARC-AGI-2
(vendored under engine/arcjepa, torch made optional) on a single ARC task.

Usage:
    echo '<task-json>' | python3 engine/arcjepa_agent.py [--seconds 20] [--seed 0]

stdin : {"train": [{"input": [[..]], "output": [[..]]}, ...],
         "test":  [{"input": [[..]]}, ...],
         "config": {"per_task_seconds": 20, "seed": 0}}   # config optional
stdout: one JSON object:
    {"ok": true, "predictions": [grid per test input, ...],
     "attempts": [[grid, grid] per test input],
     "program": "<dsl program or diagnostic label>",
     "difficulty": {"score": .., "bucket": ..},
     "diagnostics": {...}, "elapsed_ms": ..}

Predictions come from `solve_task` (induction -> DSL beam -> repair -> A* ->
evolution -> select_two), attempt 1 when the search has no exact fit.
Never sees the expected test output.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import logging

logging.basicConfig(level=logging.ERROR)  # keep stdout clean for the JSON contract


def grid_to_list(g):
    return [list(row) for row in g]


def main() -> int:
    raw = sys.stdin.read()
    t0 = time.perf_counter()
    try:
        payload = json.loads(raw)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad-input-json: {e}"}))
        return 1

    train = payload.get("train") or []
    test = payload.get("test") or []
    if not train or not test:
        print(json.dumps({"ok": False, "error": "task needs non-empty train and test arrays"}))
        return 1

    cfg_in = payload.get("config") or {}
    seconds = max(3.0, min(float(cfg_in.get("per_task_seconds", 15)), 60.0))
    seed = int(cfg_in.get("seed", 0))

    try:
        from arcjepa.core.types import task_from_json
        from arcjepa.search.solver import SolveConfig, difficulty_score, parse_task, solve_task

        task = task_from_json("agent-request", {"train": train, "test": test})
        cfg = SolveConfig(per_task_seconds=seconds, seed=seed)

        d_score, bucket = None, None
        try:
            parsed = parse_task(task, deadline=time.perf_counter() + min(seconds, 3.0))
            d_score, bucket = difficulty_score(parsed)
        except Exception:
            pass

        result = solve_task(task, None, cfg)
        # solve_task returns (attempts, diagnostics) where attempts is a list of
        # (attempt1_grid, attempt2_grid) tuples, one entry per test input.
        if isinstance(result, tuple) and len(result) == 2:
            attempts_raw, diagnostics = result
        else:
            attempts_raw, diagnostics = (getattr(result, "attempts", None) or []), (getattr(result, "diagnostics", {}) or {})
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"engine-error: {type(e).__name__}: {e}"}))
        return 1

    # ------------------------------------------------------------------ shape the output
    attempts_by_test = attempts_raw
    diagnostics = diagnostics or {}
    program = ""
    for key in ("program", "best_program"):
        if isinstance(diagnostics.get(key), str) and diagnostics[key]:
            program = diagnostics[key]
            break

    predictions: list = []
    attempts: list = []
    for i in range(len(test)):
        pair_attempts = None
        if isinstance(attempts_by_test, list) and i < len(attempts_by_test):
            pair_attempts = attempts_by_test[i]
        elif isinstance(attempts_by_test, dict):
            pair_attempts = attempts_by_test.get(i) or attempts_by_test.get(str(i))
        if not pair_attempts:
            # last-resort fallback: echo the test input (copy-input convention)
            pair_attempts = [test[i].get("input")]
        attempts.append([grid_to_list(g) for g in pair_attempts[:2]])
        predictions.append([list(r) for r in attempts[-1][0]])

    print(json.dumps({
        "ok": True,
        "predictions": predictions,
        "attempts": attempts,
        "program": program,
        "difficulty": ({"score": d_score, "bucket": bucket} if d_score is not None else None),
        "diagnostics": _jsonable(diagnostics),
        "engine": "arcjepa (acco-cyber/ARC-AGI-2), symbolic mode, torch-optional",
        "elapsed_ms": round((time.perf_counter() - t0) * 1000),
    }))
    return 0


def _jsonable(d):
    try:
        return json.loads(json.dumps(d, default=str))
    except Exception:
        return {}


if __name__ == "__main__":
    raise SystemExit(main())
