/**
 * OPTIONAL competitor comparison: treeverdict vs isitdone@0.8.2 on the
 * `ignored-runtime-input` fixture. NEVER runs in CI; isitdone is NOT a
 * dependency and is only downloaded when you pass --run-competitor.
 *
 * What it does:
 *   1. Builds the same fixture as benchmark case `ignored-runtime-input`:
 *      git-ignored `config.local.js` (VALUE=42) imported by `node --test`.
 *   2. Always runs the treeverdict side (init/check/edit/status + real test).
 *   3. With --run-competitor, runs pinned `isitdone@0.8.2` via `npm exec`
 *      (equivalent of `npx -y isitdone@0.8.2 --json`) and records verdicts.
 *   4. Prints normalized facts only (no absolute local paths) as JSON.
 *
 * Usage:
 *   node benchmark/compare-isitdone.mjs                     # treeverdict side only
 *   node benchmark/compare-isitdone.mjs --run-competitor    # also downloads+runs isitdone@0.8.2
 *
 * Manual reproduction (exact commands, no script):
 *   1. mkdir repro && cd repro
 *   2. printf '{"name":"repro","version":"1.0.0","scripts":{"test":"node --test"}}' > package.json
 *   3. printf 'config.local.js\n' > .gitignore
 *   4. printf 'export const VALUE = 42;\n' > config.local.js
 *   5. printf "import { VALUE } from './config.local.js';\nexport function getValue() { return VALUE; }\n" > main.js
 *   6. mkdir test && printf "import test from 'node:test';\nimport { VALUE } from '../config.local.js';\ntest('runtime config value is 42', (t) => { t.assert.equal(VALUE, 42); });\n" > test/value.test.mjs
 *   7. git init 2>/dev/null; git config user.email t@t 2>/dev/null; git config user.name t 2>/dev/null; true
 *   8. node <treeverdict-checkout>/dist/cli.js init --yes
 *   9. node <treeverdict-checkout>/dist/cli.js check --json            # expect PASS
 *  10. npx -y isitdone@0.8.2 --json                                    # observed PASS on 2026-10-16 (version-specific)
 *  11. printf 'export const VALUE = 7;\n' > config.local.js            # change ONLY the ignored file
 *  12. npm test --silent                                              # expect FAIL (real execution)
 *  13. node <treeverdict-checkout>/dist/cli.js status --json           # expect STALE
 *  14. npx -y isitdone@0.8.2 receipt --json                             # observed PASS on 2026-10-16 (version-specific)
 *  15. npx -y isitdone@0.8.2 --json                                    # observed cached=true PASS on 2026-10-16 (version-specific)
 *
 * Conditions of the 2026-10-16 observation: fixture above, Node as in
 * report, single ignored-file edit 42->7, no other changes. Version-specific:
 * applies to isitdone@0.8.2 only; do not generalize to future releases.
 *
 * Cross-platform: npm is invoked through node's own npm-cli.js (same pattern
 * as scripts/smoke-pack.mjs) so Windows .cmd shims are not spawned directly.
 * Tested platform is recorded in the report; untested platforms are "not tested".
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = process.cwd();
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const COMPETITOR_VERSION = "0.8.2";
const COMPETITOR_SPEC = `isitdone@${COMPETITOR_VERSION}`;
const RUN_COMPETITOR = process.argv.includes("--run-competitor");

// Shell-free npm: same approach as scripts/smoke-pack.mjs.
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const NPM_BASE = fs.existsSync(NPM_CLI) ? [process.execPath, NPM_CLI] : [process.platform === "win32" ? "npm.cmd" : "npm"];

function scrub(s) {
  let out = String(s ?? "");
  for (const p of [fixtureDir, os.tmpdir(), os.homedir()].filter(Boolean)) {
    out = out.split(p).join(p === fixtureDir ? "<fixture>" : p === os.tmpdir() ? "<tmp>" : "<home>");
  }
  // Scrub any remaining drive-letter absolute paths (Windows) conservatively.
  out = out.replace(/[A-Za-z]:\\[^\s"']*/g, "<abs-path>");
  out = out.replace(/\/(?:tmp|Users|home)\/[^\s"']*/g, "<abs-path>");
  return out.slice(0, 1200);
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

function npmExec(dir, ...args) {
  const r = spawnSync(NPM_BASE[0], [...NPM_BASE.slice(1), ...args], { cwd: dir, encoding: "utf8", timeout: 180000 });
  return { code: r.status ?? 99, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error) : null };
}

function parseCompetitorVerdict(stdout) {
  // Normalize without assuming schema: look for JSON with verdict/pass fields.
  try {
    const j = JSON.parse(stdout);
    const flat = JSON.stringify(j).toLowerCase();
    const verdict = j.state ?? j.verdict ?? j.status ?? j.result ?? (j.cached === true ? "PASS(cached)" : null);
    return {
      parsed: true,
      verdict: typeof verdict === "string" ? verdict : "UNKNOWN",
      cached: j.cached ?? null,
      excerpt: scrub(JSON.stringify(j).slice(0, 400)),
    };
  } catch {
    const low = stdout.toLowerCase();
    return {
      parsed: false,
      verdict: low.includes("pass") ? "PASS?(text)" : "UNKNOWN",
      cached: low.includes("cached") ? true : null,
      excerpt: scrub(stdout.slice(0, 400)),
    };
  }
}

// ---- fixture (mirrors benchmark case `ignored-runtime-input`) ----
let fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-compare-"));
{
  const files = {
    "package.json": JSON.stringify({ name: "compare-fx", version: "1.0.0", type: "module", scripts: { test: "node --test" } }),
    ".gitignore": "config.local.js\n",
    "config.local.js": "export const VALUE = 42;\n",
    "main.js": "import { VALUE } from './config.local.js';\nexport function getValue() { return VALUE; }\n",
    "test/value.test.mjs":
      "import test from 'node:test';\n" +
      "import { VALUE } from '../config.local.js';\n" +
      "test('runtime config value is 42', (t) => { t.assert.equal(VALUE, 42); });\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(fixtureDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const git = (...args) => spawnSync("git", args, { cwd: fixtureDir, encoding: "utf8" });
  if (git("init").status !== 0) throw new Error("comparison requires git");
  git("config", "user.email", "bench@example.invalid");
  git("config", "user.name", "Benchmark");
  if (git("check-ignore", "config.local.js").status !== 0) throw new Error("fixture file is not git-ignored");
  if (git("add", ".gitignore", "package.json", "main.js", "test/value.test.mjs").status !== 0) throw new Error("fixture git add failed");
  if (git("commit", "-m", "fixture").status !== 0) throw new Error("fixture git commit failed");
}

if (!fs.existsSync(CLI)) {
  console.error(`compare: ${scrub(CLI)} missing. Run \`npm run build\` first.`);
  process.exit(2);
}

// ---- treeverdict side (always runs, fully local) ----
runTv(fixtureDir, "init", "--yes");
const tvCheck = runTv(fixtureDir, "check", "--json");
const tvCheckVerdict = tvCheck.json?.verdict ?? `exit${tvCheck.code}`;
fs.writeFileSync(path.join(fixtureDir, "config.local.js"), "export const VALUE = 7;\n");
const tvStatus = runTv(fixtureDir, "status", "--json");
const tvStatusVerdict = tvStatus.json?.verdict ?? `exit${tvStatus.code}`;
const realTest = npmExec(fixtureDir, "test", "--silent");
const realTestNode = spawnSync(process.execPath, ["--test"], { cwd: fixtureDir, encoding: "utf8" });

// ---- competitor side (opt-in only) ----
const competitorSteps = [];
let competitorNote = "skipped (re-run with --run-competitor to download and execute pinned isitdone@0.8.2)";
if (RUN_COMPETITOR) {
  competitorNote = `executed via npm exec, pinned ${COMPETITOR_SPEC}; version-specific observation, do not generalize`;
  // NOTE: with VALUE currently 7 (post-edit). To mirror the 2026-10-16
  // observation we need both phases, so restore 42 first for the pre-phase.
  fs.writeFileSync(path.join(fixtureDir, "config.local.js"), "export const VALUE = 42;\n");
  const pre = npmExec(fixtureDir, "exec", "--yes", "--package", COMPETITOR_SPEC, "--", "isitdone", "--json");
  competitorSteps.push({
    phase: "pre (VALUE=42)",
    cmd: `npm exec --yes --package ${COMPETITOR_SPEC} -- isitdone --json`,
    exit: pre.code,
    ...parseCompetitorVerdict(pre.stdout),
    stderrExcerpt: scrub(pre.stderr.slice(0, 200)),
    transportError: pre.error ? scrub(pre.error) : null,
  });
  fs.writeFileSync(path.join(fixtureDir, "config.local.js"), "export const VALUE = 7;\n");
  const receipt = npmExec(fixtureDir, "exec", "--yes", "--package", COMPETITOR_SPEC, "--", "isitdone", "receipt", "--json");
  competitorSteps.push({
    phase: "post (VALUE=7, ONLY ignored file changed)",
    cmd: `npm exec --yes --package ${COMPETITOR_SPEC} -- isitdone receipt --json`,
    exit: receipt.code,
    ...parseCompetitorVerdict(receipt.stdout),
    stderrExcerpt: scrub(receipt.stderr.slice(0, 200)),
    transportError: receipt.error ? scrub(receipt.error) : null,
  });
  const post = npmExec(fixtureDir, "exec", "--yes", "--package", COMPETITOR_SPEC, "--", "isitdone", "--json");
  competitorSteps.push({
    phase: "post (VALUE=7, normal check)",
    cmd: `npm exec --yes --package ${COMPETITOR_SPEC} -- isitdone --json`,
    exit: post.code,
    ...parseCompetitorVerdict(post.stdout),
    stderrExcerpt: scrub(post.stderr.slice(0, 200)),
    transportError: post.error ? scrub(post.error) : null,
  });
}

const report = {
  tool: "treeverdict-competitor-comparison",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  testedPlatformNote: `executed on ${process.platform} ${process.version}; other platforms not tested by this run`,
  competitor: {
    package: COMPETITOR_SPEC,
    ran: RUN_COMPETITOR,
    note: competitorNote,
    steps: competitorSteps,
  },
  treeverdict: {
    checkVerdictPre: tvCheckVerdict,
    statusVerdictPost: tvStatusVerdict,
    statusReasonExcerpt: scrub(((tvStatus.json?.reasons ?? [])[0] ?? "").slice(0, 200)),
  },
  realExecutionPost: {
    npmTestExit: realTest.code,
    nodeTestExit: realTestNode.status ?? 99,
    note: "non-zero means the value drift (42->7) really breaks the suite",
  },
  observedReference: {
    date: "2026-10-16",
    fixture: "git repo, .gitignore=config.local.js, main.js imports it, node --test asserts 42",
    pre: "npx -y isitdone@0.8.2 --json -> PASS (observed, version-specific)",
    postReal: "npm test -> FAIL (observed)",
    postCompetitor: "isitdone receipt --json -> PASS; isitdone --json -> cached=true PASS (both observed, version-specific)",
    postTreeverdict: "treeverdict status -> STALE (observed; now covered by benchmark case ignored-runtime-input)",
    caveat: "Version-specific result for isitdone@0.8.2 only; do not generalize. isitdone does many other things better (hooks, HMAC receipt, larger tamper corpus). No global superiority claimed.",
  },
  // Absolute local paths are never emitted; fixture paths scrubbed to <fixture>.
};

const outDir = path.join(REPO_ROOT, ".treeverdict", "benchmark");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "compare-isitdone.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("\nManual repro: see header comment in benchmark/compare-isitdone.mjs (exact commands, no download needed to read them).");
console.log("Machine-readable report: .treeverdict/benchmark/compare-isitdone.json (paths normalized; never paste absolute paths).");
