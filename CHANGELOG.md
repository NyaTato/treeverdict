# Changelog

All notable changes to treeverdict are documented here. Format follows Keep a Changelog; versions follow SemVer.

## [0.1.0] — 2026-10-16

Initial independent release (MIT © 2026 NyaTato).

- `init` / `check` / `status` / `approve-tests` CLI with `--json` output; Node ≥ 20; zero runtime dependencies.
- No-shell execution of allowlisted policy argv (Windows `.cmd` shims via exactly-quoted `cmd.exe /d /s /c`; launch path recorded).
- Whole-tree SHA-256 fingerprint: tracked + untracked + deleted tombstones + in-scope ignored files; receipts/`node_modules`/`.git`/build outputs excluded by explicit policy.
- Symlink escapes fail closed (never traversed); mid-check tree changes FAIL the run.
- Test integrity: human-reviewed baseline blocks changed/deleted tests; `.skip`/`.only`/empty/missing detection; runner-count parsing (node --test TAP+spec, vitest, jest, mocha, pytest, go, TAP) with NOT_PROVEN fallback — exit code alone never PASS.
- Receipts with integrity hash (`TAMPERED` on hand edits); `status` recomputes policy/baseline/tree → `STALE` on any drift; `git HEAD` preserved in evidence.
- 20-case adversarial benchmark with machine-readable report, including ignored runtime inputs; repeatable demo; self-dogfooded (`status` STALE after mutation, PASS after re-check).
- Opt-in version-pinned `isitdone@0.8.2` comparison for the ignored runtime input case; it is never a runtime dependency or CI step.
- Receipts use repository-relative paths and do not store absolute repository roots.
