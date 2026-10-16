/**
 * Adversarial benchmark for treeverdict.
 *
 * Every case builds a REAL fixture repo in os.tmpdir(), runs the REAL built
 * CLI (`dist/cli.js`) as a subprocess, and records expected vs ACTUAL
 * verdicts with evidence excerpts. Nothing is faked: pass = actual verdict is
 * in the declared acceptable set, where the sets below encode "any refusal is
 * correct, PASS is the bug" for refusal-class cases.
 *
 * Output: machine-readable JSON to stdout + .treeverdict/benchmark/results.json
 * (excluded from the source fingerprint so benchmarking never dirties the tree).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = process.cwd();
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
if (!fs.existsSync(CLI)) {
  console.error(`benchmark: ${CLI} missing. Run \`npm run build\` first.`);
  process.exit(2);
}

function runTv(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* text output */
  }
  return { code: r.status ?? 99, stdout: r.stdout ?? "", stderr: r.stderr ?? "", json };
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-bench-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const PASSING_TEST = `import test from 'node:test';\ntest('adds', (t) => { t.assert.equal(1 + 1, 2); });\n`;

function npmProject(extra = {}) {
  return {
    "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", scripts: { test: "node --test" } }),
    "src/add.js": "export function add(a, b) { return a + b; }\n",
    "test/add.test.mjs": PASSING_TEST,
    ...extra,
  };
}

function shortHash(h) {
  return typeof h === "string" ? h.slice(0, 12) : String(h);
}

/** @type {{id:string,title:string,rationale:string,expected:string[],run:(dir:string)=>{actual:string,evidence:string[]}}[]} */
const CASES = [
  {
    id: "stale-green",
    title: "Previously-green receipt must go STALE after source edit",
    rationale: "The core promise: 'done' on old code is not 'done' on new code.",
    expected: ["STALE"],
    run(dir) {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      if (c.json?.verdict !== "PASS") return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: ["setup check did not PASS", c.stdout.slice(0, 300)] };
      fs.appendFileSync(path.join(fx, "src/add.js"), "// sneaky fix\n");
      const s = runTv(fx, "status", "--json");
      return { actual: s.json?.verdict ?? `exit${s.code}`, evidence: [`status.verdict=${s.json?.verdict}`, `reason=${(s.json?.reasons ?? [])[0] ?? ""}`.slice(0, 160)] };
    },
  },
  {
    id: "deleted-test",
    title: "Deleted test file blocks check until approve-tests",
    rationale: "A missing test must never silently pass.",
    expected: ["BLOCKED"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      fs.rmSync(path.join(fx, "test/add.test.mjs"));
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 220)}`] };
    },
  },
  {
    id: "weakened-assertion",
    title: "Weakened (edited) test file blocks check until approve-tests",
    rationale: "Changing `equal(x, 2)` to `ok(true)` must not slide through.",
    expected: ["BLOCKED"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      fs.writeFileSync(path.join(fx, "test/add.test.mjs"), "import test from 'node:test';\ntest('adds', (t) => { t.assert.ok(true); });\n");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `changed=${JSON.stringify(c.json?.changed ?? [])}`] };
    },
  },
  {
    id: "skipped-test",
    title: ".skip in a test forces NOT_PROVEN, never PASS",
    rationale: "A suite that skips the hard test proves nothing.",
    expected: ["NOT_PROVEN"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      // Edit the test to skip, then re-baseline (human reviewed the skip and
      // wrongly approved it) — check must STILL refuse PASS.
      fs.writeFileSync(path.join(fx, "test/add.test.mjs"), "import test from 'node:test';\ntest.skip('adds', (t) => { t.assert.equal(1 + 1, 2); });\n");
      runTv(fx, "approve-tests", "-m", "benchmark: approved a skipped test (should still not pass)");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "only-test",
    title: ".only in a test forces NOT_PROVEN, never PASS",
    rationale: "Running one focused test is not running the suite. (Both tests below pass on their own, so any FAIL would be a surprise; the .only marker alone must block PASS.)",
    expected: ["NOT_PROVEN"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      fs.writeFileSync(
        path.join(fx, "test/add.test.mjs"),
        "import test from 'node:test';\ntest.only('adds', (t) => { t.assert.equal(1 + 1, 2); });\ntest('subtracts', (t) => { t.assert.equal(5 - 3, 2); });\n"
      );
      runTv(fx, "approve-tests", "-m", "benchmark: approved an .only test");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "masked-exit-code",
    title: "Shell-wrapped command (exit-code masking) is BLOCKED at policy validation",
    rationale: "`sh -c 'npm test || true'` always exits 0. Shells are rejected.",
    expected: ["BLOCKED"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      const polPath = path.join(fx, ".treeverdict/policy.json");
      const pol = JSON.parse(fs.readFileSync(polPath, "utf8"));
      pol.commands = [{ id: "masked", argv: ["sh", "-c", "npm test || true"] }];
      fs.writeFileSync(polPath, JSON.stringify(pol, null, 2));
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 220)}`] };
    },
  },
  {
    id: "wrong-cwd",
    title: "Tests run from the wrong directory cannot PASS",
    rationale: "A green run against the wrong tree/dir proves nothing about this tree.",
    expected: ["FAIL", "NOT_PROVEN"],
    run() {
      const fx = fixture(npmProject({ "src/empty/.keep": "" }));
      runTv(fx, "init", "--yes");
      const polPath = path.join(fx, ".treeverdict/policy.json");
      const pol = JSON.parse(fs.readFileSync(polPath, "utf8"));
      pol.commands = [{ id: "wrongdir", argv: ["node", "--test"], cwd: "src/empty" }];
      fs.writeFileSync(polPath, JSON.stringify(pol, null, 2));
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "source-changed-after-test",
    title: "Tree mutated BY the test run fails the check",
    rationale: "Codegen/tests that rewrite sources mid-check invalidate the before-hash.",
    expected: ["FAIL"],
    run() {
      const fx = fixture({
        "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", scripts: { test: "node run-tests.cjs" } }),
        "run-tests.cjs": `const fs=require('fs');fs.appendFileSync('src/add.js','// mutated by test run\\n');console.log('# pass 1\\n# fail 0');\n`,
        "src/add.js": "export function add(a, b) { return a + b; }\n",
        "test/add.test.mjs": PASSING_TEST,
      });
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      const reasons = JSON.stringify(c.json?.reasons ?? []);
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `mid-check-change=${/CHANGED DURING CHECK/.test(reasons)}`] };
    },
  },
  {
    id: "changed-validation-command",
    title: "Editing the validation command STALEs old receipts",
    rationale: "Swapping the test command after a green run must void the green.",
    expected: ["STALE"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      runTv(fx, "check", "--json");
      const polPath = path.join(fx, ".treeverdict/policy.json");
      const pol = JSON.parse(fs.readFileSync(polPath, "utf8"));
      pol.commands[0].timeoutMs = 60000;
      fs.writeFileSync(polPath, JSON.stringify(pol, null, 2));
      const s = runTv(fx, "status", "--json");
      return { actual: s.json?.verdict ?? `exit${s.code}`, evidence: [`reason=${(s.json?.reasons ?? [])[0] ?? ""}`.slice(0, 160)] };
    },
  },
  {
    id: "empty-test",
    title: "Empty test file cannot PASS",
    rationale: "Zero assertions, zero tests: exit 0 proves nothing.",
    expected: ["NOT_PROVEN", "FAIL"],
    run() {
      const fx = fixture(npmProject({ "test/add.test.mjs": "" }));
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "missing-test",
    title: "No test files at all cannot PASS",
    rationale: "init on a test-less project must not yield a green receipt.",
    expected: ["NOT_PROVEN", "FAIL"],
    run() {
      const fx = fixture({
        "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", type: "module", scripts: { test: "node --test" } }),
        "src/add.js": "export function add(a, b) { return a + b; }\n",
      });
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "untracked-file",
    title: "New untracked file after green STALEs the receipt",
    rationale: "Untracked files are hashed: hidden payloads can't ride along.",
    expected: ["STALE"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      runTv(fx, "check", "--json");
      fs.writeFileSync(path.join(fx, "src", "backdoor.js"), "export const admin = true;\n");
      const s = runTv(fx, "status", "--json");
      return { actual: s.json?.verdict ?? `exit${s.code}`, evidence: [`reason=${(s.json?.reasons ?? [])[0] ?? ""}`.slice(0, 160)] };
    },
  },
  {
    id: "symlink-escape",
    title: "Symlink pointing outside the repo fails closed",
    rationale: "Never traverse out-of-repo links; refuse instead.",
    expected: ["FAIL", "SKIP"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tv-outside-"));
      fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
      try {
        fs.symlinkSync(outside, path.join(fx, "evil-link"), "junction");
      } catch (err) {
        return { actual: "SKIP", evidence: [`symlink creation blocked by OS: ${String(err).slice(0, 120)}`] };
      }
      const c = runTv(fx, "check", "--json");
      const reasons = JSON.stringify(c.json?.reasons ?? []);
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `escape-flagged=${/SYMLINK_ESCAPE|escapes repo/.test(reasons)}`] };
    },
  },
  {
    id: "false-all-tests",
    title: "'ALL TESTS PASSED' echo with exit 0 is NOT_PROVEN, never PASS",
    rationale: "Exit code alone (and banner strings) prove nothing without runner evidence.",
    expected: ["NOT_PROVEN"],
    run() {
      const fx = fixture({
        "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", scripts: { test: "node -e \"console.log('ALL TESTS PASSED')\"" } }),
        "src/add.js": "export function add(a, b) { return a + b; }\n",
        "test/add.test.mjs": PASSING_TEST,
      });
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `runner=${c.json?.testEvidence?.runner ?? "null"} (must not claim a runner)`] };
    },
  },
  {
    id: "build-pass-then-source-change",
    title: "A second check after a source edit greens the NEW tree, not the old one",
    rationale: "The verifier must follow the code: STALE in between, then new receipt, new hash.",
    expected: ["PASS"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      const first = runTv(fx, "check", "--json");
      const h1 = first.json?.treeHash;
      if (first.json?.verdict !== "PASS" || !h1) {
        return { actual: first.json?.verdict ?? `exit${first.code}`, evidence: ["setup: first check did not PASS", first.stdout.slice(0, 200)] };
      }
      fs.appendFileSync(path.join(fx, "src/add.js"), "// v2\n");
      const mid = runTv(fx, "status", "--json");
      if (mid.json?.verdict !== "STALE") {
        return { actual: `status=${mid.json?.verdict ?? `exit${mid.code}`}`, evidence: [`STALE phase not asserted (got ${mid.json?.verdict})`, (mid.stdout ?? "").slice(0, 200)] };
      }
      const second = runTv(fx, "check", "--json");
      const h2 = second.json?.treeHash;
      const ok = second.json?.verdict === "PASS" && h1 && h2 && h1 !== h2;
      if (!ok) {
        return { actual: second.json?.verdict ?? `exit${second.code}`, evidence: [`first=${shortHash(h1)}`, `second=${shortHash(h2)}`, "second check did not PASS on a different hash"] };
      }
      return { actual: "PASS", evidence: [`first=${shortHash(h1)}`, `stale-between=yes`, `second=${shortHash(h2)}`, `hash-followed-code=${ok}`] };
    },
  },
  {
    id: "added-test",
    title: "Newly added test file blocks check until approve-tests",
    rationale: "An unreviewed test can weaken the suite; conservatively BLOCK like changed/deleted tests.",
    expected: ["BLOCKED"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      fs.writeFileSync(path.join(fx, "test", "extra.test.mjs"), PASSING_TEST);
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `added=${JSON.stringify(c.json?.added ?? [])}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 220)}`] };
    },
  },
  {
    id: "masked-npm-test",
    title: "package.json test script with `|| true` mask is BLOCKED (real npm test path)",
    rationale: "Masking inside the npm script (not argv) still forces exit 0 on failure; high-confidence patterns BLOCK.",
    expected: ["BLOCKED"],
    run() {
      const fx = fixture({
        "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", scripts: { test: "node --test || true" } }),
        "src/add.js": "export function add(a, b) { return a + b; }\n",
        "test/add.test.mjs": "import test from 'node:test';\ntest('fails', (t) => { t.assert.equal(1 + 1, 3); });\n",
      });
      runTv(fx, "init", "--yes");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `reasons=${JSON.stringify(c.json?.reasons ?? []).slice(0, 260)}`] };
    },
  },
  {
    id: "receipt-manually-edited",
    title: "Hand-edited receipt is reported TAMPERED",
    rationale: "Integrity hash detects casual edits (same-user crypto forgery out of scope, documented).",
    expected: ["TAMPERED"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      runTv(fx, "check", "--json");
      const latest = path.join(fx, ".treeverdict", "receipts", "latest.json");
      const receipt = JSON.parse(fs.readFileSync(latest, "utf8"));
      receipt.reasons.push("hand-edited by benchmark");
      fs.writeFileSync(latest, JSON.stringify(receipt, null, 2));
      const s = runTv(fx, "status", "--json");
      return { actual: s.json?.verdict ?? `exit${s.code}`, evidence: [`exit=${s.code}`, `reason=${(s.json?.reasons ?? [])[0] ?? ""}`.slice(0, 140)] };
    },
  },
  {
    id: "approve-tests-flow",
    title: "approve-tests unblocks a reviewed test change (escape hatch works)",
    rationale: "Conservative blocking needs a legitimate, recorded way forward.",
    expected: ["PASS"],
    run() {
      const fx = fixture(npmProject());
      runTv(fx, "init", "--yes");
      fs.appendFileSync(path.join(fx, "test/add.test.mjs"), "// reviewed: extra comment\n");
      const blocked = runTv(fx, "check", "--json");
      if (blocked.json?.verdict !== "BLOCKED") {
        return { actual: blocked.json?.verdict ?? `exit${blocked.code}`, evidence: ["expected BLOCKED before approve"] };
      }
      runTv(fx, "approve-tests", "-m", "benchmark: reviewed comment-only test change");
      const c = runTv(fx, "check", "--json");
      return { actual: c.json?.verdict ?? `exit${c.code}`, evidence: [`exit=${c.code}`, `tree=${shortHash(c.json?.treeHash)}`] };
    },
  },
  {
    id: "ignored-runtime-input",
    title: "Edit to a git-ignored runtime file STALEs the receipt (ignored files are in scope)",
    rationale: "A test can import an ignored file (e.g. config.local.js): changing only that file changes what the tests prove, so the old green must not vouch for the new tree. Real execution must then fail when the value drifts.",
    expected: ["STALE"],
    run() {
      const fx = fixture({
        "package.json": JSON.stringify({ name: "bench-fx", version: "1.0.0", type: "module", scripts: { test: "node --test" } }),
        ".gitignore": "config.local.js\n",
        "config.local.js": "export const VALUE = 42;\n",
        "main.js": "import { VALUE } from './config.local.js';\nexport function getValue() { return VALUE; }\n",
        "test/value.test.mjs":
          "import test from 'node:test';\n" +
          "import { VALUE } from '../config.local.js';\n" +
          "test('runtime config value is 42', (t) => { t.assert.equal(VALUE, 42); });\n",
      });
      // Best-effort `git init` so config.local.js is genuinely git-ignored
      // (mirrors the observed competitor fixture). Not required: treeverdict
      // hashes in-scope ignored files with or without a git repo.
      try {
        const g = spawnSync("git", ["init"], { cwd: fx, encoding: "utf8" });
        if (g.status === 0) {
          spawnSync("git", ["config", "user.email", "bench@example"], { cwd: fx, encoding: "utf8" });
          spawnSync("git", ["config", "user.name", "bench"], { cwd: fx, encoding: "utf8" });
        }
      } catch {
        /* git unavailable: fixture still exercises the ignored-file path */
      }
      runTv(fx, "init", "--yes");
      const first = runTv(fx, "check", "--json");
      if (first.json?.verdict !== "PASS") {
        return { actual: first.json?.verdict ?? `exit${first.code}`, evidence: ["setup: init/check did not PASS", first.stdout.slice(0, 300)] };
      }
      const h1 = first.json?.treeHash;
      // Change ONLY the ignored runtime file: 42 -> 7.
      fs.writeFileSync(path.join(fx, "config.local.js"), "export const VALUE = 7;\n");
      const s = runTv(fx, "status", "--json");
      const statusVerdict = s.json?.verdict ?? `exit${s.code}`;
      // Real execution: the suite must now actually fail (value drift is real).
      const t = spawnSync(process.execPath, ["--test"], { cwd: fx, encoding: "utf8" });
      const testExit = t.status ?? 99;
      const combined = ((t.stdout ?? "") + (t.stderr ?? "")).slice(-400);
      const evidence = [
        `check.tree=${shortHash(h1)}`,
        `status.verdict=${s.json?.verdict}`,
        `reason=${(s.json?.reasons ?? [])[0] ?? ""}`.slice(0, 160),
        `edited=config.local.js only (42->7)`,
        `real-node-test.exit=${testExit} (must be non-zero)`,
        `real-node-test.tail=${JSON.stringify(combined.slice(-160))}`,
      ];
      if (statusVerdict !== "STALE") return { actual: statusVerdict, evidence };
      if (testExit === 0) return { actual: "TEST_STILL_PASSES", evidence };
      return { actual: "STALE", evidence };
    },
  },
];

const started = Date.now();
const results = [];
let failures = 0;
for (const cs of CASES) {
  const t0 = Date.now();
  let actual;
  let evidence = [];
  try {
    ({ actual, evidence } = cs.run());
  } catch (err) {
    actual = `ERROR: ${String(err).slice(0, 200)}`;
  }
  const pass = cs.expected.includes(actual);
  if (!pass) failures++;
  results.push({
    id: cs.id,
    title: cs.title,
    expected: cs.expected,
    actual,
    pass,
    durationMs: Date.now() - t0,
    evidence,
  });
  console.log(`${pass ? "PASS" : "FAIL"}  ${cs.id}: expected [${cs.expected.join("|")}] actual ${actual}`);
}

const report = {
  tool: "treeverdict",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cases: results.length,
  passed: results.length - failures,
  failed: failures,
  durationMs: Date.now() - started,
  results,
};

const outDir = path.join(REPO_ROOT, ".treeverdict", "benchmark");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\n${report.passed}/${report.cases} benchmark cases passed in ${(report.durationMs / 1000).toFixed(1)}s.`);
console.log(`Machine-readable report: .treeverdict/benchmark/results.json`);
process.exit(failures === 0 ? 0 : 1);
