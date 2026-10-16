# Security policy for treeverdict

## What treeverdict guarantees

- A `PASS` receipt names an exact source tree (SHA-256 over file contents),
  the exact validation policy, the exact test baseline, and the exact command
  evidence (exit codes, stdout/stderr excerpts, durations).
- `status` recomputes all three fingerprints. Any drift in code, tests, or
  policy since the receipt → `STALE`. Hand edits to the receipt → `TAMPERED`.
- Shell-based exit-code masking is rejected at policy validation; commands run
  without a user shell with captured (not interpreted) output.
- Symlink escapes fail closed; a changed tree mid-check fails the run.

## What it explicitly does NOT guarantee

1. **Same-user forgery.** Anyone who can write to `.treeverdict/` can run
   `check` on a doctored tree and produce a *valid* receipt for it. The
   integrity hash detects accidental edits and casual tampering only. There is
   no signing key, no transparency log, no trusted third party — by design
   (local tool, no cloud). Never present a treeverdict receipt as cryptographic
   proof against its own author; present it as a *checkable claim* the
   reviewer re-verifies with `treeverdict status` on their own checkout.
2. **Malicious code containment.** There is no sandbox. Verification commands
   execute with your privileges. Only allowlist commands you have reviewed,
   exactly as you would review CI configuration.
3. **Test quality.** treeverdict detects `.skip`/`.only`/empty/missing tests
   and blocks changed/deleted tests, but it cannot tell a meaningful assertion
   from `assert.ok(true)`. `approve-tests` trusts the human reviewer.
4. **Secret safety.** Receipts embed stdout/stderr excerpts (capped). If your
   tests print secrets, your receipts contain secrets. Keep `.treeverdict/`
   out of public pastes when tests are chatty.

## Threat-model summary

| actor | capability | treeverdict's answer |
|---|---|---|
| sloppy agent | edits after green, weakens tests, wraps cmds in shells | STALE / BLOCKED / NOT_PROVEN |
| sneaky artifact | ignored-file payload, out-of-repo symlink, mid-run mutation | hashed / fail-closed / FAIL |
| casual receipt editor | hand-edits JSON to fake green | TAMPERED (integrity hash) |
| same-user forger | regenerates a valid receipt for bad code | **not prevented** — re-verify on your own checkout |
| remote attacker | no built-in network service; executed test commands may use the network | review commands and dependencies; no sandbox is provided |

## Reporting

Found a way to obtain an unjustified `PASS` (not same-user forgery, which is
documented as out of scope)? Please open an issue with a minimal fixture
(`benchmark/` case format preferred) so it can become a regression case.
No credentials, no private data: all verification is local.

## Supported versions

0.1.x — initial release. Security fixes will be released as patch versions
with CHANGELOG entries.
