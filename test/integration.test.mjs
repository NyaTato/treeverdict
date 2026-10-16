import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

function mkFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-it-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

async function tv(dir, ...args) {
  try {
    const r = await execFileAsync(process.execPath, [CLI, ...args], { cwd: dir });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function nodePassingFixture(extraTest = "test('ok', (t) => { t.assert.equal(1, 1); });") {
  return {
    "package.json": JSON.stringify({
      name: "fx",
      version: "1.0.0",
      // NOTE: bare `node --test` (no directory arg): some Node builds treat a
      // directory positional as an entry point instead of a scan.
      scripts: { test: "node --test" },
    }),
    "src/add.js": "export function add(a, b) { return a + b; }\n",
    "test/add.test.mjs": `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${extraTest}\n`,
  };
}

test("init -> check PASS -> status PASS; mutation -> STALE", async () => {
  const dir = mkFixture(nodePassingFixture());
  assert.equal((await tv(dir, "init", "--yes")).code, 0);
  // init policy runs npm test; ensure it passes
  const check = await tv(dir, "check", "--json");
  assert.equal(check.code, 0, check.stdout + check.stderr);
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.verdict, "PASS");
  const status = await tv(dir, "status", "--json");
  assert.equal(status.code, 0, status.stdout);
  assert.equal(JSON.parse(status.stdout).verdict, "PASS");
  // mutate source -> STALE
  fs.appendFileSync(path.join(dir, "src/add.js"), "// mutation\n");
  const stale = await tv(dir, "status", "--json");
  assert.notEqual(stale.code, 0);
  assert.equal(JSON.parse(stale.stdout).verdict, "STALE");
});

test("deleted test blocks check until approve-tests", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  fs.rmSync(path.join(dir, "test/add.test.mjs"));
  const blocked = await tv(dir, "check", "--json");
  assert.equal(blocked.code, 2);
  assert.equal(JSON.parse(blocked.stdout).verdict, "BLOCKED");
  const appr = await tv(dir, "approve-tests", "-m", "test intentionally removed in e2e");
  assert.equal(appr.code, 0);
});

test("newly added test file BLOCKS check until approve-tests", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  fs.writeFileSync(path.join(dir, "test/extra.test.mjs"), "import test from 'node:test';\ntest('extra', () => {});\n");
  const blocked = await tv(dir, "check", "--json");
  assert.equal(blocked.code, 2, blocked.stdout + blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).verdict, "BLOCKED");
  const appr = await tv(dir, "approve-tests", "-m", "reviewed new test");
  assert.equal(appr.code, 0);
  const after = await tv(dir, "check", "--json");
  assert.equal(JSON.parse(after.stdout).verdict, "PASS", after.stdout);
});

test("masked package.json test script (|| true) BLOCKS via real npm test path", async () => {
  const dir = mkFixture({
    "package.json": JSON.stringify({ name: "fx", version: "1.0.0", scripts: { test: "node --test || true" } }),
    "src/add.js": "export function add(a, b) { return a + b; }\n",
    "test/add.test.mjs": "import test from 'node:test';\ntest('fails', (t) => { t.assert.equal(1 + 1, 3); });\n",
  });
  await tv(dir, "init", "--yes");
  const r = await tv(dir, "check", "--json");
  assert.equal(JSON.parse(r.stdout).verdict, "BLOCKED", r.stdout);
});

test("echo command is BLOCKED at policy validation", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  const polPath = path.join(dir, ".treeverdict/policy.json");
  const pol = JSON.parse(fs.readFileSync(polPath, "utf8"));
  pol.commands = [{ id: "fake", argv: ["echo", "ALL TESTS PASSED"] }];
  fs.writeFileSync(polPath, JSON.stringify(pol, null, 2));
  const r = await tv(dir, "check", "--json");
  assert.equal(JSON.parse(r.stdout).verdict, "BLOCKED");
});

test("exit-0 with no test evidence is NOT_PROVEN, not PASS", async () => {
  const dir = mkFixture({
    "package.json": JSON.stringify({
      name: "fx",
      version: "1.0.0",
      scripts: { test: "node -e \"console.log('ALL TESTS PASSED')\"" },
    }),
    "src/a.js": "export const x = 1;\n",
    "test/a.test.mjs": "import test from 'node:test';\ntest('ok', () => {});\n",
  });
  await tv(dir, "init", "--yes");
  const r = await tv(dir, "check", "--json");
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, "NOT_PROVEN", r.stdout);
});

test("fingerprint ignores own receipts (re-check stays PASS)", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  assert.equal((await tv(dir, "check", "--json")).code, 0);
  assert.equal((await tv(dir, "check", "--json")).code, 0);
  assert.equal(JSON.parse((await tv(dir, "status", "--json")).stdout).verdict, "PASS");
});

test("check receipt path in output is repo-relative, never absolute", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  const check = await tv(dir, "check", "--json");
  const out = JSON.parse(check.stdout);
  assert.equal(out.verdict, "PASS", check.stdout);
  assert.ok(typeof out.receipt === "string" && out.receipt.length > 0);
  assert.ok(!path.isAbsolute(out.receipt), `receipt path must be repo-relative, got ${out.receipt}`);
  assert.ok(out.receipt.startsWith(".treeverdict/"), `unexpected receipt path ${out.receipt}`);
});

test("new receipts carry no absolute repoRoot (portable, no path leak)", async () => {
  const dir = mkFixture(nodePassingFixture());
  await tv(dir, "init", "--yes");
  const check = await tv(dir, "check", "--json");
  assert.equal(JSON.parse(check.stdout).verdict, "PASS", check.stdout);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, ".treeverdict", "receipts", "latest.json"), "utf8"));
  assert.ok(!("repoRoot" in receipt), "new receipts must not store absolute repoRoot");
  assert.ok(receipt.commands.every((c) => !path.isAbsolute(c.cwd)), "command cwd must be repo-relative");
  assert.equal(receipt.commands[0].cwd, ".");
  const raw = JSON.stringify(receipt);
  assert.ok(!raw.includes(JSON.stringify(dir).slice(1, -1)), "receipt body must not leak the absolute fixture path");
});

test("git HEAD move with identical tree stays PASS (HEAD is evidence, not fingerprint)", async () => {
  const dir = mkFixture(nodePassingFixture());
  const git = (await tv(dir, "init", "--yes")).code;
  assert.equal(git, 0);
  try {
    execFileSync("git", ["init"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  } catch {
    return; // git unavailable: nothing to assert
  }
  assert.equal((await tv(dir, "check", "--json")).code, 0);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "x"], { cwd: dir });
  // Committing changed HEAD but no fingerprinted file: verdict must hold.
  const s = await tv(dir, "status", "--json");
  assert.equal(JSON.parse(s.stdout).verdict, "PASS", s.stdout);
});
