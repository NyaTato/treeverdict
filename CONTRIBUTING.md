# Contributing to treeverdict

## Setup

- Node.js ≥ 20, no other runtime dependencies (`npm ci` fetches dev-only TypeScript).
- `npm run build` — compile `src/` to `dist/`.
- `npm run typecheck` — strict type check, no emit.
- `npm test` — build + unit + integration tests (real CLI subprocesses, temp fixtures).
- `npm run benchmark` — 20 adversarial cases, must be 20/20 with real runs (`--json` exercised throughout).
- `npm run demo` — repeatable end-to-end transcript + `.treeverdict/demo-log.txt`.
- `npm run smoke` — `npm pack` tarball smoke test (install elsewhere, `--help` + mini verify cycle).

## Rules of the road

1. **Evidence before synthesis.** Every verdict change needs a fixture + a test or benchmark case first. Never tune `expected` to match a bug — fix the bug.
2. **Exit code alone is never PASS.** New runner parsers must extract real pass/fail counts and come with positive + negative unit tests (including mangled-glyph variants for console output).
3. **Keep runtime dependencies at zero.** Dev dependencies need justification.
4. **No shell, ever.** New execution paths must preserve argv-vector semantics; Windows `.cmd` shims keep per-element quoting. Add a benchmark case for any new launch path.
5. **Document limits honestly.** If a guarantee has an exception (same-user forgery, no sandbox), it goes in README limitations + SECURITY.md, not just code comments.
6. **Generated logs stay out of the fingerprint.** New artifacts belong under `.treeverdict/` excluded paths (see `DEFAULT_EXCLUDES` in `src/tree.ts`) or temp dirs.

## Pull requests

- Small, one behavior per PR. Include: code, test/benchmark coverage, docs touch-up, CHANGELOG entry.
- CI must be green: install → typecheck → test → benchmark → pack smoke → dogfood `check`+`status`.
- Unjustified-PASS bugs are treated as security bugs: minimal fixture, regression case, SECURITY.md review.
