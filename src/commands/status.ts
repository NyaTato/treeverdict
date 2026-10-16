import * as path from "node:path";
import { baselineHash, loadBaseline, loadPolicy, policyHash } from "../policy.js";
import { fingerprintTree } from "../tree.js";
import { loadReceipt, verifyReceiptIntegrity } from "../receipt.js";

export interface StatusOptions {
  json: boolean;
  cwd: string;
}

export function runStatus(
  root: string,
  opts: StatusOptions
): { exitCode: number; output: unknown } {
  const fail = (exitCode: number, output: unknown, text?: string) => {
    if (opts.json) console.log(JSON.stringify(output, null, 2));
    else if (text) console.log(text);
    return { exitCode, output };
  };

  const loaded = loadReceipt(root);
  if (!loaded) {
    return fail(
      2,
      { ok: false, verdict: "STALE", reasons: ["No receipt found. Run `treeverdict check` first."] },
      "STALE: no receipt. Run `treeverdict check` first."
    );
  }
  const { receipt } = loaded;
  if (!verifyReceiptIntegrity(receipt)) {
    const out = {
      ok: false,
      verdict: "TAMPERED",
      reasons: ["Receipt integrity hash mismatch: .treeverdict/receipts/latest.json was hand-edited. Re-run `treeverdict check`."],
    };
    return fail(3, out, "TAMPERED: receipt integrity mismatch (hand-edited). Re-run `check`.");
  }

  let policy;
  let baseline;
  try {
    policy = loadPolicy(root);
    baseline = loadBaseline(root);
  } catch {
    return fail(
      2,
      { ok: false, verdict: "STALE", reasons: ["Policy or baseline missing."] },
      "STALE: policy/baseline missing."
    );
  }

  const currentPolicyHash = policyHash(policy);
  const currentBaselineHash = baselineHash(baseline);
  const reasons: string[] = [];

  if (currentPolicyHash !== receipt.policyHash) {
    reasons.push("Policy changed since receipt (validation command changed => old receipt invalid).");
  }
  if (currentBaselineHash !== receipt.baselineHash) {
    reasons.push("Test baseline changed since receipt (approve-tests ran => old receipt invalid).");
  }

  const current = fingerprintTree(root, policy.exclude ?? []);
  if (current.unreadable.length > 0) {
    return fail(
      1,
      { ok: false, verdict: "FAIL", reasons: ["UNREADABLE: refusing to verify a tree with files that cannot be read (fail closed):", ...current.unreadable.slice(0, 20)] },
      "FAIL: unreadable files present (fail closed)."
    );
  }
  if (current.symlinkViolations.length > 0) {
    return fail(
      1,
      { ok: false, verdict: "FAIL", reasons: ["Symlink escape present:", ...current.symlinkViolations] },
      "FAIL: symlink escape present."
    );
  }
  if (current.hash !== receipt.treeHashAfter) {
    reasons.push(
      `Source tree changed since receipt (before: ${receipt.treeHashAfter.slice(0, 12)}…, now: ${current.hash.slice(0, 12)}…).`
    );
  }
  if (receipt.treeHashBefore !== receipt.treeHashAfter) {
    reasons.push("Receipt itself records a mid-check tree change.");
  }
  // git HEAD is preserved evidence, not part of the fingerprint: a HEAD move
  // with an identical tree (e.g. committing the receipt itself, or an
  // excluded file) keeps the verdict PASS with a note. Any tree/policy/
  // baseline drift above still forces STALE.
  const notes: string[] = [];
  if (receipt.gitHead && current.gitHead && receipt.gitHead !== current.gitHead) {
    if (current.hash !== receipt.treeHashAfter) {
      reasons.push(`git HEAD moved (${receipt.gitHead.slice(0, 8)} → ${current.gitHead.slice(0, 8)}).`);
    } else {
      notes.push(`git HEAD moved (${receipt.gitHead.slice(0, 8)} → ${current.gitHead.slice(0, 8)}); tree identical.`);
    }
  }
  if (receipt.verdict !== "PASS") {
    const out = {
      ok: false,
      verdict: receipt.verdict,
      reasons: [`Last check verdict was ${receipt.verdict}:`, ...receipt.reasons],
      receipt: path.join(".treeverdict", "receipts", "latest.json"),
      treeHash: current.hash,
    };
    return fail(1, out, `${receipt.verdict}: last check did not pass.`);
  }
  if (reasons.length > 0) {
    const out = {
      ok: false,
      verdict: "STALE",
      reasons,
      receipt: path.join(".treeverdict", "receipts", "latest.json"),
      treeHash: current.hash,
      receiptTree: receipt.treeHashAfter,
    };
    return fail(
      1,
      out,
      "STALE:\n" + reasons.map((r) => "  - " + r).join("\n")
    );
  }
  const out = {
    ok: true,
    verdict: "PASS",
    reasons: [],
    notes,
    treeHash: current.hash,
    receiptTree: receipt.treeHashAfter,
    gitHead: current.gitHead,
    checkedAt: receipt.createdAt,
  };
  return fail(
    0,
    out,
    `PASS — tree ${current.hash.slice(0, 12)}… matches receipt from ${receipt.createdAt}.` +
      (notes.length ? `\nNotes:\n${notes.map((n) => "  - " + n).join("\n")}` : "")
  );
}
