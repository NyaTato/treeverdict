import * as fs from "node:fs";
import * as path from "node:path";
import { buildBaseline, buildDefaultPolicy } from "../policy.js";

export interface InitOptions {
  json: boolean;
  cwd: string;
  yes: boolean;
  reason?: string;
}

export function runInit(root: string, opts: InitOptions): { exitCode: number; output: unknown } {
  const dir = path.join(root, ".treeverdict");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "receipts"), { recursive: true });
  const policy = buildDefaultPolicy(root);
  const baseline = buildBaseline(root, opts.reason ?? "initial human-reviewed baseline");
  const policyPath = path.join(dir, "policy.json");
  const baselinePath = path.join(dir, "test-baseline.json");
  const existed = fs.existsSync(policyPath) || fs.existsSync(baselinePath);
  if (existed && !opts.yes) {
    const msg =
      "treeverdict is already initialized in this directory. " +
      "Review .treeverdict/policy.json and .treeverdict/test-baseline.json, then re-run with --yes to overwrite.";
    if (opts.json) return { exitCode: 2, output: { ok: false, error: msg } };
    console.error(msg);
    return { exitCode: 2, output: {} };
  }
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n", "utf8");
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  const output = {
    ok: true,
    policy: ".treeverdict/policy.json",
    baseline: ".treeverdict/test-baseline.json",
    commands: policy.commands,
    testFiles: baseline.files.map((f) => f.path),
    next: "Review policy.json + test-baseline.json, then run `treeverdict check`.",
  };
  if (opts.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("Initialized treeverdict.");
    console.log(`  policy:   .treeverdict/policy.json (${policy.commands.length} command(s))`);
    for (const c of policy.commands) console.log(`    - ${c.id}: ${c.argv.join(" ")}`);
    console.log(`  baseline: .treeverdict/test-baseline.json (${baseline.files.length} test file(s))`);
    if (baseline.files.length === 0) {
      console.log("  WARNING: no test files discovered. `check` will return NOT_PROVEN until tests exist.");
    }
    console.log("Next: human-review both files, then run `treeverdict check`.");
  }
  return { exitCode: 0, output };
}
