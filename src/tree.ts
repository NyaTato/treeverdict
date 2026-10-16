import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { FingerprintResult } from "./types.js";
import { getGitHead, getGitStatus, getGitTrackedFiles, toPosix } from "./util.js";

/**
 * Explicit default exclusion policy.
 *
 * Rationale (also written into policy.json `ignoredPolicyNote`):
 * - The tool's own receipt directory is excluded so that writing a receipt
 *   does not change the fingerprint it attests to.
 * - `.git`, `node_modules`, and cache/build outputs are excluded because they
 *   are either reproducible artifacts or huge environment-specific state.
 *   Source truth is the worktree's *source* files.
 * - Everything else on disk is included EVEN IF git-ignored, so an attacker
 *   cannot hide a payload in an ignored file that the runtime actually loads
 *   (e.g. `.env`, ignored `config.local.js`). Teams that need a ignored file
 *   excluded must do so explicitly in policy.json `exclude` — that change
 *   alters the policy hash and therefore STALEs old receipts.
 */
export const DEFAULT_EXCLUDES = [
  ".treeverdict/receipts",
  ".treeverdict/benchmark",
  ".treeverdict/demo-log.txt",
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".nyc_output",
  ".turbo",
  ".parcel-cache",
  ".vite",
  "__pycache__",
  ".pytest_cache",
  "target",
  ".tox",
  ".venv",
  "venv",
  "logs",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
];

function excludeMatcher(excludes: string[]): (relPosix: string) => boolean {
  const normalized = excludes.map((e) => e.replace(/\\/g, "/").replace(/\/+$/, ""));
  return (rel: string) => {
    for (const ex of normalized) {
      if (ex.includes("*")) {
        // Minimal glob: support `*` only (e.g. `*.log`).
        const re = new RegExp(
          "^" + ex.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
        );
        const base = rel.split("/").pop() ?? rel;
        if (re.test(rel) || re.test(base)) return true;
      } else {
        if (rel === ex || rel.startsWith(ex + "/")) return true;
      }
    }
    return false;
  };
}

export function hashFileBytes(filePath: string): { sha256: string; bytes: number } {
  const data = fs.readFileSync(filePath);
  const h = crypto.createHash("sha256").update(data).digest("hex");
  return { sha256: h, bytes: data.length };
}

/**
 * Walk the worktree without ever following a symlink.
 * - Symlinks are never traversed (opendir without follow + lstat).
 * - A symlink whose target resolves outside the repo root is recorded as a
 *   violation; check fails closed on any violation.
 * - Otherwise only the link-target string is hashed (never target contents).
 */
export interface FingerprintDeps {
  readdirSync?: (dir: string, opts: { withFileTypes: true }) => fs.Dirent[];
  lstatSync?: (p: string) => fs.Stats;
  readlinkSync?: (p: string) => string;
  readFileSync?: (p: string) => Buffer;
}

export function fingerprintTree(root: string, excludes: string[], deps: FingerprintDeps = {}): FingerprintResult {
  const readdirSync = deps.readdirSync ?? ((d: string, o: { withFileTypes: true }) => fs.readdirSync(d, o));
  const lstatSync = deps.lstatSync ?? ((p: string) => fs.lstatSync(p));
  const readlinkSync = deps.readlinkSync ?? ((p: string) => fs.readlinkSync(p));
  const readFileSync = deps.readFileSync ?? ((p: string) => fs.readFileSync(p));
  const absRoot = path.resolve(root);
  const isExcluded = excludeMatcher(excludes);
  const files: { path: string; sha256: string; bytes: number }[] = [];
  const symlinkViolations: string[] = [];
  const unreadable: string[] = [];
  const isTransient = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT";

  const stack: string[] = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Transient dir disappearance (deleted mid-walk): skip, do not fail.
      // Anything else (EACCES/EPERM/…) means we cannot prove the tree: fail closed.
      if (!isTransient(err)) {
        const relDir = toPosix(path.relative(absRoot, dir)) || ".";
        unreadable.push(`${relDir}: readdir failed (${(err as NodeJS.ErrnoException)?.code ?? "error"})`);
      }
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = toPosix(path.relative(absRoot, abs));
      if (!rel || isExcluded(rel)) continue;
      let st: fs.Stats;
      try {
        st = lstatSync(abs);
      } catch (err) {
        // ENOENT here = file vanished between readdir and lstat (transient,
        // e.g. temp files, test outputs). Skip without failing: the
        // before/after mid-check guard still catches meaningful mutations,
        // and git-deleted tombstones below catch tracked deletions.
        if (isTransient(err)) continue;
        unreadable.push(`${rel}: lstat failed (${(err as NodeJS.ErrnoException)?.code ?? "error"})`);
        const h = crypto.createHash("sha256").update("unreadable:" + rel).digest("hex");
        files.push({ path: rel, sha256: h, bytes: -1 });
        continue;
      }
      if (st.isSymbolicLink()) {
        let target = "";
        try {
          target = readlinkSync(abs);
        } catch (err) {
          if (isTransient(err)) continue;
          symlinkViolations.push(`${rel}: unreadable symlink`);
          continue;
        }
        // Resolve target against containing dir; outside root => violation.
        const resolved = path.resolve(path.dirname(abs), target);
        const outside =
          resolved !== absRoot && !resolved.startsWith(absRoot + path.sep);
        if (outside) {
          symlinkViolations.push(`${rel} -> ${target} (escapes repo root)`);
          // Still record the link itself so the hash reflects its presence.
          const h = crypto.createHash("sha256").update("symlink:" + target).digest("hex");
          files.push({ path: rel, sha256: h, bytes: target.length });
        } else {
          const h = crypto.createHash("sha256").update("symlink:" + target).digest("hex");
          files.push({ path: rel, sha256: h, bytes: target.length });
        }
        continue;
      }
      if (st.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (st.isFile()) {
        try {
          const data = readFileSync(abs);
          const sha256 = crypto.createHash("sha256").update(data).digest("hex");
          files.push({ path: rel, sha256, bytes: data.length });
        } catch (err) {
          // Transient disappearance: skip (see lstat note above).
          // Real unreadability (EACCES/EPERM/…): record presence AND fail
          // closed via the `unreadable` list — check/status refuse PASS.
          if (isTransient(err)) continue;
          unreadable.push(`${rel}: read failed (${(err as NodeJS.ErrnoException)?.code ?? "error"})`);
          const h = crypto.createHash("sha256").update("unreadable:" + rel).digest("hex");
          files.push({ path: rel, sha256: h, bytes: -1 });
        }
        continue;
      }
      // FIFOs/sockets/devices: record type only, never read.
      const h = crypto.createHash("sha256").update("special:" + rel).digest("hex");
      files.push({ path: rel, sha256: h, bytes: 0 });
    }
  }

  // Catch git-deleted files: present in index but missing on disk.
  // They cannot be hashed; record a tombstone so the fingerprint changes.
  const tracked = getGitTrackedFiles(absRoot);
  if (tracked) {
    const seen = new Set(files.map((f) => f.path));
    for (const t of tracked) {
      const rel = toPosix(t);
      if (!rel || isExcluded(rel) || seen.has(rel)) continue;
      if (!fs.existsSync(path.join(absRoot, t))) {
        const h = crypto.createHash("sha256").update("deleted:" + rel).digest("hex");
        files.push({ path: rel + " (deleted)", sha256: h, bytes: -1 });
      }
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const overall = crypto.createHash("sha256");
  for (const f of files) {
    overall.update(f.path + "\0" + f.sha256 + "\0" + String(f.bytes) + "\n");
  }
  return {
    hash: overall.digest("hex"),
    fileCount: files.length,
    files,
    symlinkViolations,
    unreadable,
    gitHead: getGitHead(absRoot),
    gitStatus: getGitStatus(absRoot),
  };
}
