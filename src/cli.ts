#!/usr/bin/env node
import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runStatus } from "./commands/status.js";
import { runApproveTests } from "./commands/approve.js";
import { findRepoRoot } from "./util.js";

const HELP = `treeverdict — prove the exact code tree that passed your tests.

Usage:
  treeverdict init [--yes] [--json]            record policy + test baseline (human-review both)
  treeverdict check [--json]                   run allowlisted commands w/o shell, write receipt
  treeverdict status [--json]                  recompute fingerprint; PASS or STALE/TAMPERED/FAIL
  treeverdict approve-tests -m <reason> [--json]  accept current tests as new baseline (not a security boundary)

Options:
  --json        machine-readable output
  --cwd <dir>   run as if started in <dir>
  -h, --help    show this help
  -v, --version show version

Receipts: .treeverdict/receipts/latest.json (excluded from fingerprint).
Docs: README.md, SECURITY.md.`;

function parseArgs(argv: string[]): { cmd: string; json: boolean; yes: boolean; cwd?: string; msg?: string } {
  const rest = argv.slice(2);
  const cmd = rest[0] ?? "--help";
  let json = false;
  let yes = false;
  let cwd: string | undefined;
  let msg: string | undefined;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") json = true;
    else if (a === "--yes") yes = true;
    else if (a === "--cwd" && i + 1 < rest.length) cwd = rest[++i];
    else if ((a === "-m" || a === "--message") && i + 1 < rest.length) msg = rest[++i];
    else if (a === "-h" || a === "--help") return { cmd: "--help", json, yes, cwd, msg };
  }
  return { cmd, json, yes, cwd, msg };
}

async function main(): Promise<void> {
  const { cmd, json, yes, cwd, msg } = parseArgs(process.argv);
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    const { TOOL_VERSION } = await import("./util.js");
    console.log(TOOL_VERSION);
    process.exit(0);
  }
  const start = cwd ?? process.cwd();
  const root = findRepoRoot(start);
  if (cmd === "init") {
    const { exitCode } = runInit(root, { json, cwd: root, yes });
    process.exit(exitCode);
  } else if (cmd === "check") {
    const { exitCode } = await runCheck(root, { json, cwd: root });
    process.exit(exitCode);
  } else if (cmd === "status") {
    const { exitCode } = runStatus(root, { json, cwd: root });
    process.exit(exitCode);
  } else if (cmd === "approve-tests") {
    if (!msg) {
      const m = "approve-tests requires -m <reason> so the review is on record.";
      if (json) console.log(JSON.stringify({ ok: false, error: m }));
      else console.error(m);
      process.exit(2);
    }
    const { exitCode } = runApproveTests(root, { json, cwd: root, reason: msg });
    process.exit(exitCode);
  } else {
    if (json) console.log(JSON.stringify({ ok: false, error: `Unknown command: ${cmd}` }));
    else {
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("treeverdict: unexpected error:", err);
  process.exit(99);
});
