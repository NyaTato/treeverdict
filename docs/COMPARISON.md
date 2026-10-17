# Comparison — version-pinned, observed only

This document records **what was actually run**, with the exact versions. It is not a feature-scorecard and makes no superiority claim: each tool makes different trade-offs, and a different guarantee is not a better one.

A row appears here only if someone executed it and kept the log. Inferred behavior, vendor documentation, and "should work the same" reasoning are excluded by design.

## The one recorded cross-tool observation

Fixture: a git repo whose `.gitignore` contains `config.local.js`; `main.js` imports `config.local.js`; `node --test` asserts the exported value is `42`.

- **Environment:** Windows (`win32`), Node `v24.13.0` — executed **2026-10-16**. Other platforms were not tested by this run, and the result is **version-specific to `isitdone@0.8.2`**. Do not generalize it to other versions, platforms, or to isitdone as a project.
- **Repro (opt-in, never in CI, never a dependency):** `node benchmark/compare-isitdone.mjs --run-competitor`. The script pins `isitdone@0.8.2`, installs and runs it via `npm exec` only when explicitly requested, and normalizes absolute local paths out of the report. Raw artifacts: `.treeverdict/benchmark/compare-isitdone.json` (gitignored, regenerate locally).

| phase | command | result |
|---|---|---|
| value = 42 (green) | `npm exec --yes --package isitdone@0.8.2 -- isitdone --json` | `PASS`, `cached=false` |
| change **only** the ignored file to 7; `npm test` now **fails** | `… isitdone receipt --json` | `PASS` |
| same state | `… isitdone --json` | `PASS`, `cached=true` |
| same fixture, treeverdict | `check` before the edit → `PASS`; `status` after → **`STALE`** |

The reported git tree hash is identical before and after the edit (`09dcf6e4e25f…`) because the changed file is gitignored — that is the observable mechanism behind the divergence, not an accusation of a bug.

**Scope of this observation:** it shows one reproducible ignored-file case in which a separate verifier earns its keep. It does **not** show that treeverdict is globally better. Recorded in the same logs: isitdone does several things better — agent hooks, an HMAC (keyed) receipt, and a larger tamper corpus. treeverdict has no hooks and only an unkeyed integrity hash.

## treeverdict's own behavior (no competitor involved)

Version `v0.1.0`, from `npm run benchmark` — 20 adversarial cases, each a real fixture plus a real CLI run. Observed 20/20, ~14 s on Windows/Node 24 (timing is machine-dependent). Machine-readable output: `.treeverdict/benchmark/results.json`.

The cases cover: edit-after-green (`STALE`), deleted/added/weakened tests (`BLOCKED`), `.skip`/`.only` (`NOT_PROVEN`), `sh -c '… || true'` and `npm test → node --test || true` (`BLOCKED`), wrong cwd, tests that rewrite source (`FAIL`), command swapped post-green (`STALE`), untracked file after green (`STALE`), symlink escape (`FAIL`, closed), `echo ALL TESTS PASSED` exiting 0 (`NOT_PROVEN`), hand-edited receipt (`TAMPERED`), the `approve-tests` unblock flow, and `ignored-runtime-input` (`STALE`).

Per-case expectations are the "must return" column in the [README benchmark table](../README.md#benchmark). These are first-party results for treeverdict only; they say nothing about any other tool.

## Other projects

The [prior-art table](../README.md#prior-art-named-comparison) in the README lists other agent-verification projects by **design**, not by measurement. None of them were executed for this document, and the table says so explicitly ("not tested"). Do not cite them as benchmark results.
