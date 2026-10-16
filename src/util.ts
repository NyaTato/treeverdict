import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export const TOOL_VERSION = "0.1.0";
export const STATE_DIR = ".treeverdict";
export const POLICY_PATH = ".treeverdict/policy.json";
export const BASELINE_PATH = ".treeverdict/test-baseline.json";
export const RECEIPTS_DIR = ".treeverdict/receipts";
export const LATEST_RECEIPT = ".treeverdict/receipts/latest.json";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    // A treeverdict repo root = dir containing .treeverdict/policy.json,
    // or a git worktree root, or filesystem root fallback.
    if (fs.existsSync(path.join(dir, ".treeverdict", "policy.json"))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function getGitHead(root: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : out || null;
  } catch {
    return null;
  }
}

export function getGitStatus(root: string): string | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out;
  } catch {
    return null;
  }
}

export function getGitTrackedFiles(root: string): string[] | null {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    }) as unknown as Buffer;
    if (!out || out.length === 0) return [];
    return out
      .toString("utf8")
      .split("\0")
      .filter((s) => s.length > 0)
      .map((s) => s.split("/").join(path.sep));
  } catch {
    return null;
  }
}

export function readPackageJson(root: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
