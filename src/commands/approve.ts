import * as fs from "node:fs";
import * as path from "node:path";
import { buildBaseline } from "../policy.js";

export interface ApproveOptions {
  json: boolean;
  cwd: string;
  reason: string;
}

export function runApproveTests(
  root: string,
  opts: ApproveOptions
): { exitCode: number; output: unknown } {
  const baselinePath = path.join(root, ".treeverdict", "test-baseline.json");
  if (!fs.existsSync(path.join(root, ".treeverdict", "policy.json"))) {
    const msg = "No policy found. Run `treeverdict init` first.";
    if (opts.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    return { exitCode: 2, output: { ok: false } };
  }
  let previous: { files: { path: string }[] } | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as { files: { path: string }[] };
  } catch {
    previous = null;
  }
  const baseline = buildBaseline(root, opts.reason);
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  const prevSet = new Set((previous?.files ?? []).map((f) => f.path));
  const newSet = new Set(baseline.files.map((f) => f.path));
  const added = [...newSet].filter((f) => !prevSet.has(f));
  const removed = [...prevSet].filter((f) => !newSet.has(f));
  const output = {
    ok: true,
    baseline: ".treeverdict/test-baseline.json",
    testFiles: baseline.files.length,
    added,
    removed,
    warning:
      "Baseline update is NOT a security boundary: it records that a human reviewed the current tests. Old receipts are now STALE.",
  };
  if (opts.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`Approved ${baseline.files.length} test file(s). Old receipts are now STALE (re-run check).`);
    if (added.length) console.log("  added: " + added.join(", "));
    if (removed.length) console.log("  removed: " + removed.join(", "));
    console.log("NOTE: this command trusts you — it is not a security boundary.");
  }
  return { exitCode: 0, output };
}
