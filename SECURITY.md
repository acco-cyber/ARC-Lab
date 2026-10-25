# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's [private vulnerability reporting](https://github.com/acco-cyber/ARC-Lab/security/advisories/new) or contact the maintainer directly. Include a description, reproduction steps and affected components. You will get an acknowledgment within a few days and a fix timeline for confirmed issues.

## Scope: what ARC Lab executes and how it is contained

ARC Lab runs three kinds of third-party code. Each has a documented containment model — and honest limits.

### 1. Notebook agents (`.ipynb`) — untrusted code, strongest isolation available

When you load a notebook (e.g. `arc2-qwen-solo.ipynb`), its code cells execute in a Python subprocess with **five isolation layers**:

| # | Layer | Guarantee |
|---|---|---|
| 1 | **Network isolation** — cells run under `unshare -rn` (fresh user + network namespace) when the host OS allows it | No network egress from notebook code |
| 2 | **Credential stripping** — the subprocess environment is an allowlist (`PATH`, `LANG`, `HOME`=sandbox dir, …). The ARC Lab server environment is **not** inherited | Notebook code cannot read API keys/tokens from the environment |
| 3 | **Resource limits** — `RLIMIT_CPU` 60 s, `RLIMIT_AS` 1 GiB, `RLIMIT_NPROC` 64, `RLIMIT_FSIZE` 8 MiB, applied before any cell runs | No CPU/memory exhaustion, fork bombs or huge file writes |
| 4 | **Host-side caps** — wall-clock timeout and stdout/maxBuffer caps enforced by the Node parent | Runaway cells are killed |
| 5 | **Throwaway working directory** — per-run `mkdtemp`, deleted afterwards | No persistent writes into the app tree |

Additionally: shell magics (`!pip …`, `%…`) are **stripped, never executed**; `%%writefile` cells are staged as files without executing them as notebook cells.

### Honest limits (read this)

- **A Python subprocess is not a VM.** If the host OS forbids user namespaces (some containers do), layer 1 degrades to layers 2–5 only — notebook code could then reach the local network position of the app process (but has no credentials to take with it). For hostile multi-tenant deployments, run ARC Lab itself inside a container (see `Dockerfile`) or a gVisor/Firecracker sandbox, and do not co-locate it with secrets.
- Layer 1 is probed at runtime; the deployment's actual capability is part of your threat model, not silently assumed.
- Notebook code **can** make network calls that succeed only inside the isolated namespace's loopback (e.g. to a solver service you deliberately run alongside). That is the documented HTTP-agent pattern.

### 2. Custom JavaScript agents — untrusted, browser-isolated

Pasted JS runs in a **Web Worker** in *your* browser (no server execution), auto-verified against demonstration pairs. It cannot read the expected test output (server-side) and cannot exceed the browser's Worker sandbox.

### 3. HTTP endpoint agents — trusted by the operator

ARC Lab POSTs `{train, testInputs}` to a URL you configure. The response is scored server-side. Only run endpoints you control.

## Anti-leakage guarantees (evaluator integrity)

- The Academy serves puzzles **without expected outputs**; answers live server-side until submission.
- The Workbench bounded search prunes/ranks **only on demonstration pairs** — it is structurally blind to the test output.
- The Agent Lab and Arena keep expected grids server-side and reveal them **only after the agent commits its prediction**; scoring happens server-side.
- The vendored official ARC-AGI-2 tasks keep `test[0].output` server-side for scoring even though the vendored files contain them (documented in `data/arc-agi-2/SOURCE.md`).

## Data handling

- No authentication, no accounts, no third-party analytics. Player identity is an anonymous UUID stored locally.
- SQLite (local file) stores progress, arena runs and the never-repeat puzzle history. Nothing is sent anywhere except the LLM backend you configure for LLM agents (which receives task grids and must comply with your own privacy standards).
- The optional LLM agents send **task demonstration pairs and test inputs** to the model backend — never expected answers, never your credentials (environments are stripped).

## Supported versions

Only the latest `main` branch is supported. Please update before reporting an issue.
