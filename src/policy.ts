import * as fs from "node:fs";
import * as path from "node:path";
import { PolicyFile, TestBaselineFile } from "./types.js";
import { canonicalHash, readPackageJson } from "./util.js";
import { DEFAULT_EXCLUDES, hashFileBytes } from "./tree.js";

export const IGNORED_POLICY_NOTE =
  "Fingerprint includes tracked + untracked + deleted files, plus ignored files EXCEPT: " +
  ".treeverdict/receipts (own receipts), .git, node_modules, and standard cache/build outputs " +
  "(dist, build, coverage, .next, etc. — see policy exclude list). " +
  "All other ignored files (e.g. .env, *.local.js) ARE hashed: an ignored file that code loads is still code. " +
  "To exclude anything else, add it to `exclude` explicitly; that changes the policy hash and STALEs old receipts.";

const SHELL_BASENAMES = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const TRIVIAL_BASENAMES = new Set([
  "echo",
  "echo.exe",
  "printf",
  "printf.exe",
  "true",
  "false",
  ":",
  "rem",
  "type",
]);

export function policyHash(policy: PolicyFile): string {
  return canonicalHash(policy);
}

export function baselineHash(baseline: TestBaselineFile): string {
  return canonicalHash(baseline);
}

export function loadPolicy(root: string): PolicyFile {
  const p = path.join(root, ".treeverdict", "policy.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as PolicyFile;
}

export function loadBaseline(root: string): TestBaselineFile {
  const p = path.join(root, ".treeverdict", "test-baseline.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as TestBaselineFile;
}

export interface PolicyProblem {
  fatal: boolean;
  message: string;
}

/** Validate policy commands. Fatal problems block `check`; warnings force NOT_PROVEN. */
export function validatePolicy(policy: PolicyFile): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  if (!policy || !Array.isArray(policy.commands) || policy.commands.length === 0) {
    return [{ fatal: true, message: "Policy defines no commands. Run `treeverdict init` first." }];
  }
  const ids = new Set<string>();
  for (const cmd of policy.commands) {
    if (!cmd.id || ids.has(cmd.id)) {
      problems.push({ fatal: true, message: `Duplicate or empty command id: ${JSON.stringify(cmd.id)}` });
    }
    ids.add(cmd.id);
    if (!Array.isArray(cmd.argv) || cmd.argv.length === 0) {
      problems.push({ fatal: true, message: `Command ${JSON.stringify(cmd.id)} has empty argv.` });
      continue;
    }
    for (const arg of cmd.argv) {
      if (typeof arg !== "string") {
        problems.push({ fatal: true, message: `Command ${cmd.id} has non-string argv entry.` });
      }
    }
    const prog = cmd.argv[0] ?? "";
    const base = prog.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    if (TRIVIAL_BASENAMES.has(base)) {
      problems.push({
        fatal: true,
        message: `Command "${cmd.id}" uses trivial program "${prog}": exit code alone proves nothing. Use a real test runner.`,
      });
    }
    if (SHELL_BASENAMES.has(base)) {
      problems.push({
        fatal: true,
        message:
          `Command "${cmd.id}" invokes a shell ("${prog}"). ` +
          `Shell wrapping hides the real exit code (pipes, \`&&\`, \`;\` mask failures). ` +
          `List the executable and args directly as argv instead.`,
      });
    }
    // Shell metacharacters inside a single argv entry suggest attempted shell masking.
    const joined = cmd.argv.join(" ");
    if (/[|&;`$]|(\$\()|(>\s*\S)/.test(joined)) {
      // Allow `&&`amiss? No: argv runs without a shell so these would be
      // literal args — almost certainly a mistake or masking attempt.
      const looksShell = cmd.argv.some((a) => /[|&;`$]/.test(a) && a.length < 60);
      if (looksShell) {
        problems.push({
          fatal: false,
          message:
            `Command "${cmd.id}" contains shell metacharacters but runs without a shell; ` +
            `it will be passed literally. This usually means a masked/ineffective check (NOT_PROVEN unless test evidence parses).`,
        });
      }
    }
    if (cmd.cwd) {
      if (path.isAbsolute(cmd.cwd) || cmd.cwd.includes("..")) {
        problems.push({ fatal: true, message: `Command "${cmd.id}" has unsafe cwd: ${cmd.cwd}` });
      }
    }
  }
  return problems;
}

/**
 * High-confidence exit-code mask patterns inside a package.json script body.
 * Returns a human-readable reason, or null when the script looks legitimate.
 * Legitimate chaining (`tsc && node --test`, `npm run lint && npm test`) must
 * NOT match: only patterns that force exit 0 / skip tests match.
 */
export function describeMaskedScript(script: string): string | null {
  const s = script.trim();
  if (/\|\|\s*(true|:|exit\s+0)\b/i.test(s)) {
    return `exit-code mask "\|\| …" forces success even when tests fail`;
  }
  if (/;\s*exit\s+0\b/i.test(s)) {
    return `exit-code mask "; exit 0" forces success even when tests fail`;
  }
  if (/--passWithNoTests\b/.test(s)) {
    return `"--passWithNoTests" passes with zero tests (no evidence of real tests)`;
  }
  // Trivial echo-only test: every chained segment is echo/printf/true/exit/rem
  // with no real runner invocation. e.g. `echo ALL TESTS PASSED`, `echo ok || true`.
  const segments = s.split(/&&|\|\||[;|]/).map((x) => x.trim()).filter(Boolean);
  if (segments.length > 0) {
    const trivial = /^(echo|printf|true|false|:|rem\b|type\b|exit\b)/i;
    const runner = /(node\s+--test|node\b.*--test|vitest|jest|mocha|pytest|go\s+test|tap\b|npm\s+(test|run\b)|tsc\b|ts-node\b|tsx\b)/i;
    if (segments.every((seg) => trivial.test(seg)) && !runner.test(s)) {
      return `trivial echo-only test script proves nothing (exit 0 without running tests)`;
    }
  }
  return null;
}

/** Script names reachable from the `npm test` / `npm run <name>` argv commands in policy. */
export function npmScriptsReachable(root: string, policy: PolicyFile): { name: string; script: string }[] {
  const pkg = readPackageJson(root);
  const scripts = ((pkg?.scripts ?? {}) as Record<string, unknown>) as Record<string, string>;
  const out: { name: string; script: string }[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const cmd of policy.commands ?? []) {
    const argv = cmd.argv ?? [];
    const prog = (argv[0] ?? "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    if (prog !== "npm" && prog !== "npm.cmd" && prog !== "npm.exe") continue;
    const sub = argv[1];
    if (sub === "test") queue.push("test");
    else if (sub === "run" && typeof argv[2] === "string") queue.push(argv[2]);
    else if (sub === "t") queue.push("test");
  }
  // Always inspect `test` when any npm command is present but names nothing
  // explicit (e.g. `npm test --silent` is covered above; bare `npm` is not).
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = scripts[name];
    if (typeof body !== "string") continue;
    out.push({ name, script: body });
    // Follow `npm run <other>` / `npm test` references one level deeper so
    // `test: "npm run unit"` chains are still inspected (bounded by `seen`).
    const ref = body.matchAll(/npm\s+(?:run\s+([\w:.-]+)|test\b|t\b)/g);
    for (const m of ref) {
      if (m[1]) queue.push(m[1]);
      else queue.push("test");
    }
  }
  return out;
}

/**
 * Inspect package.json scripts reachable from configured npm test commands
 * for high-confidence failure-masking. Fatal problems block `check`.
 */
export function validateNpmScripts(root: string, policy: PolicyFile): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  for (const { name, script } of npmScriptsReachable(root, policy)) {
    const reason = describeMaskedScript(script);
    if (reason) {
      problems.push({
        fatal: true,
        message:
          `package.json script "${name}" looks failure-masking (${reason}): ${JSON.stringify(script.slice(0, 160))}. ` +
          `Remove the mask so a failing test exits non-zero.`,
      });
    }
  }
  return problems;
}

/** Discover candidate test files with generic patterns (npm + custom commands). */
export function discoverTestFiles(root: string): string[] {
  const patterns = [
    // JS/TS
    /\.test\.[cm]?[jt]sx?$/,
    /\.spec\.[cm]?[jt]sx?$/,
    // Python / Go / Rust / misc
    /^test_.*\.py$/,
    /.*_test\.py$/,
    /.*_test\.go$/,
    /.*Test\.java$/,
    /.*\.t$/,
  ];
  const dirAllow = [/^tests?$/, /^__tests__$/, /^e2e$/, /^integration$/];
  const results: string[] = [];
  const stack: string[] = [root];
  const skipDirs = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".treeverdict",
    ".nyc_output",
    "target",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
  ]);
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === ".treeverdict") continue;
      const abs = path.join(dir, ent.name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // never follow symlinks during discovery
      if (st.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = path.relative(root, abs);
      const base = ent.name;
      const parentBase = path.basename(path.dirname(abs));
      const matchedPattern = patterns.some((re) => re.test(base));
      const inTestDir = dirAllow.some((re) => re.test(parentBase));
      if (matchedPattern || (inTestDir && /\.(js|ts|mjs|cjs|jsx|tsx|py|go|rs|java)$/.test(base))) {
        results.push(rel.split(path.sep).join("/"));
      }
    }
  }
  // package.json-declared test entry points count as evidence even without files.
  return results.sort();
}

export function buildDefaultPolicy(root: string): PolicyFile {
  const pkg = readPackageJson(root);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const hasTestScript = typeof scripts["test"] === "string" && scripts["test"].trim().length > 0;
  const testFiles = discoverTestFiles(root);
  // Prefer running the project's own test entry; fall back to bare
  // `node --test` discovery (bare form: never pass a directory — some Node
  // builds treat a directory positional as an entry point instead of a scan).
  const commands =
    hasTestScript
      ? [{ id: "npm-test", argv: ["npm", "test", "--silent"], timeoutMs: 300000 }]
      : testFiles.length > 0
        ? [{ id: "node-test", argv: ["node", "--test"], timeoutMs: 300000 }]
        : [{ id: "npm-test", argv: ["npm", "test", "--silent"], timeoutMs: 300000 }];
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    commands,
    exclude: [...DEFAULT_EXCLUDES],
    includeUntracked: true,
    ignoredPolicyNote: IGNORED_POLICY_NOTE,
  };
}

export function buildBaseline(root: string, reason?: string): TestBaselineFile {
  const files = discoverTestFiles(root);
  const entries = files.map((rel) => {
    const abs = path.join(root, rel);
    try {
      const { sha256, bytes } = hashFileBytes(abs);
      return { path: rel, sha256, bytes };
    } catch {
      return { path: rel, sha256: "unreadable", bytes: -1 };
    }
  });
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    updateReason: reason,
    files: entries,
  };
}
