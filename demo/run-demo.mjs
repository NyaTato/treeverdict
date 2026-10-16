/**
 * Repeatable terminal demo for treeverdict (~15-30s to watch).
 * Builds a REAL mini-project in os.tmpdir(), runs the REAL CLI end to end:
 * init -> check (PASS) -> status (PASS) -> mutate source -> status (STALE)
 * -> check again (PASS on the new tree).
 *
 * Transcript goes to stdout AND .treeverdict/demo-log.txt (excluded from the
 * source fingerprint, so demoing never dirties the tree). Run: `npm run demo`.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = process.cwd();
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const LOG_PATH = path.join(REPO_ROOT, ".treeverdict", "demo-log.txt");

const logLines = [];
function say(s = "") {
  console.log(s);
  logLines.push(s);
}
function step(n, title) {
  say(`\n--- [${n}] ${title}`);
}
function sh(dir, args) {
  say(`$ treeverdict ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trimEnd();
  for (const line of out.split("\n").slice(0, 14)) say(line);
  if (out.split("\n").length > 14) say(`… (${out.split("\n").length - 14} more lines)`);
  say(`(exit ${r.status})`);
  return r.status;
}

const t0 = Date.now();
say("treeverdict demo — prove the exact code that passed.");
const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), "treeverdict-demo-"));
say("working in a fresh temp dir (path hidden: receipts report repo-relative paths)");

fs.writeFileSync(
  path.join(demoDir, "package.json"),
  JSON.stringify({ name: "demo-cart", version: "1.0.0", scripts: { test: "node --test" } })
);
fs.mkdirSync(path.join(demoDir, "src"), { recursive: true });
fs.mkdirSync(path.join(demoDir, "test"), { recursive: true });
fs.writeFileSync(path.join(demoDir, "src/cart.js"), "export function total(items) { return items.reduce((s, i) => s + i.price, 0); }\n");
fs.writeFileSync(
  path.join(demoDir, "test/cart.test.mjs"),
  "import test from 'node:test';\nimport { total } from '../src/cart.js';\ntest('totals the cart', (t) => { t.assert.equal(total([{ price: 3 }, { price: 4 }]), 7); });\n"
);
say("created demo-cart: src/cart.js + test/cart.test.mjs + npm test script.");

step(1, "init — record human-reviewed policy + test baseline");
sh(demoDir, ["init", "--yes"]);

step(2, "check — run the allowlisted tests without a shell, hash the tree, write a receipt");
sh(demoDir, ["check"]);

step(3, "status — recompute the fingerprint: does the tree still match the receipt?");
sh(demoDir, ["status"]);

step(4, "an agent 'finishes the job' with one more edit AFTER the green run…");
fs.appendFileSync(path.join(demoDir, "src/cart.js"), "export function discount(t, pct) { return t * (1 - pct); }\n");
say("$ echo 'export function discount…' >> src/cart.js");

step(5, "status — the old green no longer vouches for the new code");
sh(demoDir, ["status"]);

step(6, "check again — green follows the code, with a NEW receipt for the NEW tree");
sh(demoDir, ["check"]);

step(7, "someone hand-edits the receipt to hide the change…");
{
  const latest = path.join(demoDir, ".treeverdict", "receipts", "latest.json");
  const receipt = JSON.parse(fs.readFileSync(latest, "utf8"));
  receipt.reasons.push("all good, trust me");
  fs.writeFileSync(latest, JSON.stringify(receipt, null, 2));
  say("$ echo '\"all good, trust me\"' >> .treeverdict/receipts/latest.json");
}
sh(demoDir, ["status"]);

step(8, "machine-readable output for CI/agents: status --json");
{
  const r = spawnSync(process.execPath, [CLI, "status", "--json"], { cwd: demoDir, encoding: "utf8" });
  say("$ treeverdict status --json");
  for (const line of (r.stdout ?? "").split("\n").slice(0, 8)) say(line);
  say(`(exit ${r.status})`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
say(`\ndemo done in ${secs}s. The receipt only ever vouches for the exact tree it hashed.`);
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n");
say(`full transcript: .treeverdict/demo-log.txt`);
