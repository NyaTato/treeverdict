import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseTestOutput } from "../dist/evidence.js";
import { describeMaskedScript, validateNpmScripts, validatePolicy } from "../dist/policy.js";
import { fingerprintTree } from "../dist/tree.js";

test("parseTestOutput: node --test TAP summary", () => {
  const out = "# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n";
  const p = parseTestOutput(out);
  assert.ok(p);
  assert.equal(p.passed, 5);
  assert.equal(p.failed, 0);
});

test("parseTestOutput: node --test spec summary (node >=20 default)", () => {
  const out = "✔ ok (0.7ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 58\n";
  const p = parseTestOutput(out);
  assert.ok(p);
  assert.equal(p.runner, "node-test");
  assert.equal(p.passed, 1);
  assert.equal(p.failed, 0);
  assert.equal(p.total, 1);
});

test("parseTestOutput: node --test spec summary with mangled glyphs (non-UTF8 console)", () => {
  const out = "? ok (0.5ms)\n?tests 2\n?suites 0\n?pass 1\n?fail 1\n?cancelled 0\n?skipped 0\n?todo 0\n";
  const p = parseTestOutput(out);
  assert.ok(p);
  assert.equal(p.passed, 1);
  assert.equal(p.failed, 1);
});

test("parseTestOutput: unknown echo output returns null (never PASS on exit code alone)", () => {
  const p = parseTestOutput("ALL TESTS PASSED\n");
  assert.equal(p, null);
});

test("parseTestOutput: zero tests detected", () => {
  const p = parseTestOutput("No tests found, exiting with code 0");
  assert.ok(p);
  assert.equal(p.total, 0);
});

test("validatePolicy blocks echo and shells", () => {
  const probs = validatePolicy({
    version: 1,
    createdAt: new Date().toISOString(),
    commands: [
      { id: "a", argv: ["echo", "hello"] },
      { id: "b", argv: ["sh", "-c", "npm test"] },
    ],
    exclude: [],
    includeUntracked: true,
    ignoredPolicyNote: "",
  });
  assert.ok(probs.filter((p) => p.fatal).length >= 2);
});

test("describeMaskedScript flags high-confidence masks, keeps legit chaining usable", () => {
  assert.ok(describeMaskedScript("node --test || true") !== null);
  assert.ok(describeMaskedScript("node run-tests.cjs || exit 0") !== null);
  assert.ok(describeMaskedScript("node --test; exit 0") !== null);
  assert.ok(describeMaskedScript("echo ALL TESTS PASSED") !== null);
  assert.ok(describeMaskedScript("jest --passWithNoTests") !== null);
  // Legitimate chaining must stay usable.
  assert.equal(describeMaskedScript("tsc && node --test"), null);
  assert.equal(describeMaskedScript("npm run lint && npm test"), null);
  assert.equal(describeMaskedScript("node --test"), null);
});

test("validateNpmScripts BLOCKS masked test script reachable from npm test", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-unit-mask-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { test: "node test.mjs || true" } })
  );
  const probs = validateNpmScripts(dir, {
    version: 1,
    createdAt: new Date().toISOString(),
    commands: [{ id: "npm-test", argv: ["npm", "test", "--silent"] }],
    exclude: [],
    includeUntracked: true,
    ignoredPolicyNote: "",
  });
  assert.ok(probs.some((p) => p.fatal), "masked script must be fatal");
});

test("validateNpmScripts allows legit chained test script", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-unit-legit-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { test: "tsc && node --test" } })
  );
  const probs = validateNpmScripts(dir, {
    version: 1,
    createdAt: new Date().toISOString(),
    commands: [{ id: "npm-test", argv: ["npm", "test", "--silent"] }],
    exclude: [],
    includeUntracked: true,
    ignoredPolicyNote: "",
  });
  assert.equal(probs.filter((p) => p.fatal).length, 0);
});

test("fingerprintTree records unreadable (EACCES) instead of silently continuing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-unit-unread-"));
  fs.writeFileSync(path.join(dir, "ok.js"), "x\n");
  fs.writeFileSync(path.join(dir, "blocked.js"), "y\n");
  const realRead = fs.readFileSync;
  const fp = fingerprintTree(dir, [], {
    readFileSync: (p) => {
      if (String(p).endsWith("blocked.js")) {
        const err = new Error("EACCES: permission denied");
        err.code = "EACCES";
        throw err;
      }
      return realRead(p);
    },
  });
  assert.ok(fp.unreadable.some((u) => u.includes("blocked.js")), `expected blocked.js in unreadable, got ${JSON.stringify(fp.unreadable)}`);
});

test("fingerprintTree skips transient ENOENT without unreadable false positives", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-unit-enoent-"));
  fs.writeFileSync(path.join(dir, "gone.js"), "x\n");
  const realLstat = fs.lstatSync;
  const fp = fingerprintTree(dir, [], {
    lstatSync: (p) => {
      if (String(p).endsWith("gone.js")) {
        const err = new Error("ENOENT: no such file or directory");
        err.code = "ENOENT";
        throw err;
      }
      return realLstat(p);
    },
  });
  assert.equal(fp.unreadable.length, 0, `transient ENOENT must not fail closed: ${JSON.stringify(fp.unreadable)}`);
});
