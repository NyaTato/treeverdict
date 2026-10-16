import * as fs from "node:fs";
import * as path from "node:path";
import { CheckReceipt, CommandEvidence, PolicyFile, TestBaselineFile, Verdict } from "../types.js";
import { TOOL_VERSION, toPosix } from "../util.js";
import { baselineHash, loadBaseline, loadPolicy, policyHash, validateNpmScripts, validatePolicy } from "../policy.js";
import { fingerprintTree } from "../tree.js";
import { runCommand } from "../exec.js";
import {
  checkBaseline,
  scanTestFilesForSkipOnly,
  summarizeEvidence,
} from "../evidence.js";
import { discoverTestFiles } from "../policy.js";
import { receiptIntegrityHash, writeReceipt } from "../receipt.js";

export interface CheckOptions {
  json: boolean;
  cwd: string;
}

export async function runCheck(
  root: string,
  opts: CheckOptions
): Promise<{ exitCode: number; output: unknown }> {
  const fail = (exitCode: number, output: unknown, text?: string) => {
    if (opts.json) console.log(JSON.stringify(output, null, 2));
    else if (text) console.log(text);
    return { exitCode, output };
  };

  // 0. Load policy + baseline.
  let policy: PolicyFile;
  let baseline: TestBaselineFile;
  try {
    policy = loadPolicy(root);
  } catch {
    return fail(
      2,
      { ok: false, verdict: "BLOCKED", reasons: ["No .treeverdict/policy.json. Run `treeverdict init` first."] },
      "BLOCKED: no policy. Run `treeverdict init` first."
    );
  }
  try {
    baseline = loadBaseline(root);
  } catch {
    return fail(
      2,
      { ok: false, verdict: "BLOCKED", reasons: ["No .treeverdict/test-baseline.json. Run `treeverdict init` first."] },
      "BLOCKED: no test baseline. Run `treeverdict init` first."
    );
  }

  // 1. Validate policy (trivial/shell commands blocked) + package.json
  // scripts reachable from configured npm test (mask patterns blocked).
  const problems = [...validatePolicy(policy), ...validateNpmScripts(root, policy)];
  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length > 0) {
    return fail(
      2,
      { ok: false, verdict: "BLOCKED", reasons: fatal.map((p) => p.message) },
      "BLOCKED:\n" + fatal.map((p) => "  - " + p.message).join("\n")
    );
  }
  const warnings = problems.filter((p) => !p.fatal).map((p) => p.message);

  // 2. Fingerprint BEFORE.
  const before = fingerprintTree(root, policy.exclude ?? []);
  const relReceipt = (abs: string): string => toPosix(path.relative(root, abs)) || abs;
  if (before.unreadable.length > 0) {
    const receipt = buildReceipt(policy, baseline, before, before, [], "FAIL", [
      "UNREADABLE: refusing to verify a tree with files that cannot be read (fail closed):",
      ...before.unreadable.slice(0, 20),
      "Fix permissions so every in-scope file is readable, then re-run `check`.",
    ]);
    const file = writeReceipt(root, receipt);
    const rel = relReceipt(file);
    return fail(
      1,
      { ok: false, verdict: "FAIL", reasons: receipt.reasons, receipt: rel },
      `FAIL (unreadable files — fail closed). Receipt: ${rel}`
    );
  }

  if (before.symlinkViolations.length > 0) {
    const receipt = buildReceipt(policy, baseline, before, before, [], "FAIL", [
      "SYMLINK_ESCAPE: refusing to verify a tree with links outside the repo root:",
      ...before.symlinkViolations,
    ]);
    const file = writeReceipt(root, receipt);
    const rel = relReceipt(file);
    return fail(
      1,
      { ok: false, verdict: "FAIL", reasons: receipt.reasons, receipt: rel },
      `FAIL (symlink escape — fail closed). Receipt: ${rel}`
    );
  }

  // 3. Test-baseline integrity: block on changed/deleted tests.
  const baseCheck = checkBaseline(root, baseline);
  // Newly added test files (absent from the baseline) are conservatively
  // BLOCKED like changed/deleted tests: an unreviewed test can weaken the
  // suite (e.g. a passing stub that shadows a real test) just as easily.
  const currentTests = new Set(discoverTestFiles(root));
  const known = new Set(baseline.files.map((f) => f.path));
  const addedTests = [...currentTests].filter((t) => !known.has(t));
  if (!baseCheck.ok) {
    const reasons = [
      "TEST BASELINE CHANGED — refusing to check. A test was deleted or modified since human review.",
      ...baseCheck.deleted.map((f) => `  deleted test: ${f}`),
      ...baseCheck.changed.map((f) => `  changed test: ${f}`),
      "If the change is legitimate, human-review it and run `treeverdict approve-tests`.",
    ];
    return fail(
      2,
      { ok: false, verdict: "BLOCKED", reasons, deleted: baseCheck.deleted, changed: baseCheck.changed },
      "BLOCKED (test files changed since baseline):\n" + reasons.join("\n")
    );
  }
  if (addedTests.length > 0) {
    const reasons = [
      "TEST BASELINE CHANGED — refusing to check. New test file(s) present that human review has not approved:",
      ...addedTests.map((f) => `  added test: ${f}`),
      "If the addition is legitimate, human-review it and run `treeverdict approve-tests`.",
    ];
    return fail(
      2,
      { ok: false, verdict: "BLOCKED", reasons, added: addedTests },
      "BLOCKED (new test files since baseline):\n" + reasons.join("\n")
    );
  }

  // 4. Skip/only + empty/missing tests.
  const scan = scanTestFilesForSkipOnly(root, baseline);
  const noTests = baseline.files.length === 0;

  // 5. Execute commands without a shell.
  const evidences: CommandEvidence[] = [];
  for (const cmd of policy.commands) {
    const ev = await runCommand(root, cmd.argv, cmd.cwd, cmd.timeoutMs);
    ev.id = cmd.id;
    evidences.push(ev);
    if (ev.exitCode !== 0) break; // stop on first failure; record what ran.
  }

  // 6. Fingerprint AFTER; reject a tree that changed mid-check.
  const after = fingerprintTree(root, policy.exclude ?? []);
  if (after.unreadable.length > 0) {
    const receipt = buildReceipt(policy, baseline, before, after, evidences, "FAIL", [
      "UNREADABLE detected after test execution — fail closed:",
      ...after.unreadable.slice(0, 20),
    ]);
    const file = writeReceipt(root, receipt);
    const rel = relReceipt(file);
    return fail(1, { ok: false, verdict: "FAIL", reasons: receipt.reasons, receipt: rel }, `FAIL (unreadable files). Receipt: ${rel}`);
  }
  if (after.symlinkViolations.length > 0) {
    const receipt = buildReceipt(policy, baseline, before, after, evidences, "FAIL", [
      "SYMLINK_ESCAPE detected after test execution — fail closed.",
      ...after.symlinkViolations,
    ]);
    const file = writeReceipt(root, receipt);
    const rel = relReceipt(file);
    return fail(1, { ok: false, verdict: "FAIL", reasons: receipt.reasons, receipt: rel }, `FAIL. Receipt: ${rel}`);
  }
  if (after.hash !== before.hash) {
    const receipt = buildReceipt(policy, baseline, before, after, evidences, "FAIL", [
      "TREE CHANGED DURING CHECK: the code after tests differs from the code before tests.",
      `  before: ${before.hash.slice(0, 16)}… (${before.fileCount} files)`,
      `  after:  ${after.hash.slice(0, 16)}… (${after.fileCount} files)`,
      "This rejects 'build pass then source change' and dirty test side-effects. Re-run `check` on a clean tree.",
    ]);
    const file = writeReceipt(root, receipt);
    const rel = relReceipt(file);
    return fail(
      1,
      { ok: false, verdict: "FAIL", reasons: receipt.reasons, receipt: rel },
      `FAIL (tree changed during check). Receipt: ${rel}`
    );
  }

  // 7. Decide verdict from evidence. Exit code alone NEVER implies PASS.
  const reasons: string[] = [...warnings];
  let verdict: Verdict = "PASS";
  const demote = (v: Verdict, reason: string) => {
    reasons.push(reason);
    // Severity order: FAIL > NOT_PROVEN > PASS. BLOCKED handled earlier.
    if (v === "FAIL") verdict = "FAIL";
    else if (verdict !== "FAIL" && v === "NOT_PROVEN") verdict = "NOT_PROVEN";
  };

  const anySpawnFailure = evidences.some((e) => e.exitCode === null);
  const anyNonZero = evidences.some((e) => e.exitCode !== 0);
  const anyTimeout = evidences.some((e) => e.timedOut);
  if (anySpawnFailure) demote("FAIL", "FAIL: a verification command could not be spawned (missing binary?).");
  if (anyTimeout) demote("FAIL", "FAIL: a verification command timed out.");
  if (anyNonZero) demote("FAIL", "FAIL: a verification command exited non-zero.");

  const summary = summarizeEvidence(
    evidences,
    policy.commands.map((c) => c.successMarker),
    scan
  );
  const hasMarkerPolicy = policy.commands.some((c) => c.successMarker);
  const parsedSomething =
    summary.runner !== null && summary.total !== null && summary.total > 0;

  if (noTests) demote("NOT_PROVEN", "NOT_PROVEN: no test files in baseline (missing tests). Add tests, then `approve-tests`.");
  if (summary.total === 0) demote("NOT_PROVEN", "NOT_PROVEN: runner reported 0 tests (empty test suite).");
  if (scan.onlyDetected) demote("NOT_PROVEN", "NOT_PROVEN: `.only` detected — only a subset ran: " + scan.details.join("; "));
  if (scan.skipDetected) demote("NOT_PROVEN", "NOT_PROVEN: `.skip`/empty-test marker detected: " + scan.details.join("; "));
  if ((summary.failed ?? 0) > 0) demote("FAIL", `FAIL: runner reported ${summary.failed} failed test(s) (${summary.parsedBy}).`);

  if (verdict === "PASS") {
    if (hasMarkerPolicy) {
      if (summary.successMarkerMatched !== true) {
        demote("NOT_PROVEN", "NOT_PROVEN: required successMarker did not match command output.");
      } else if (!parsedSomething && (summary.passed ?? 0) <= 0) {
        // Marker matched but no counts: accept ONLY because a human reviewed
        // the marker in policy. Still require exit 0 (already checked).
      }
    } else {
      // No custom marker: require parsed counts from a known runner.
      if (!parsedSomething) {
        demote(
          "NOT_PROVEN",
          "NOT_PROVEN: exit code was 0 but output matches no known test-runner signature " +
            `(raw tail: ${JSON.stringify(summary.rawExcerpt.slice(-300))}). ` +
            "Add a human-reviewed `successMarker` to the policy or use a standard runner. " +
            "Refusing to claim ALL TESTS on exit code alone."
        );
      } else if ((summary.passed ?? 0) <= 0) {
        demote("NOT_PROVEN", "NOT_PROVEN: runner reported zero passing tests.");
      }
    }
  }
  const receipt = buildReceipt(policy, baseline, before, after, evidences, verdict, reasons, summary);
  const file = writeReceipt(root, receipt);
  const rel = relReceipt(file);
  const ok = verdict === "PASS";
  const text =
    `${verdict} — tree ${after.hash.slice(0, 12)}… (${after.fileCount} files), ` +
    `runner=${summary.runner ?? "unknown"}, passed=${summary.passed ?? "?"} failed=${summary.failed ?? "?"}\n` +
    `Receipt: ${rel}` +
    (reasons.length ? `\nReasons:\n${reasons.map((r) => "  - " + r).join("\n")}` : "");
  return fail(ok ? 0 : 1, { ok, verdict, reasons, receipt: rel, treeHash: after.hash, testEvidence: summary }, text);

  function buildReceipt(
    pol: PolicyFile,
    base: TestBaselineFile,
    bef: { hash: string; gitHead: string | null; gitStatus: string | null },
    aft: { hash: string; files: { path: string; sha256: string; bytes: number }[]; gitHead: string | null; gitStatus: string | null },
    cmds: CommandEvidence[],
    v: Verdict,
    rs: string[],
    testEvidence?: CheckReceipt["testEvidence"]
  ): CheckReceipt {
    const body = {
      kind: "treeverdict-receipt" as const,
      version: 1 as const,
      createdAt: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
      gitHead: aft.gitHead,
      gitStatus: aft.gitStatus,
      treeHashBefore: bef.hash,
      treeHashAfter: aft.hash,
      fileCount: aft.files.length,
      policyHash: policyHash(pol),
      baselineHash: baselineHash(base),
      testBaseline: base.files,
      policy: pol,
      commands: cmds,
      verdict: v,
      reasons: rs,
      testEvidence: testEvidence ?? {
        runner: null,
        passed: null,
        failed: null,
        skipped: null,
        total: null,
        successMarkerMatched: null,
        skipDetected: false,
        onlyDetected: false,
        skipDetails: [],
        parsedBy: null,
        rawExcerpt: "",
      },
    };
    return { ...body, integrity: receiptIntegrityHash(body) };
  }
}

// Re-export for tests (keeps tree-shaking simple).
export { fingerprintTree as _fingerprintTree };
export function _placeholder(): void {
  void fs;
}
