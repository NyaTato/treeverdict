export type Verdict =
  | "PASS"
  | "FAIL"
  | "NOT_PROVEN"
  | "STALE"
  | "TAMPERED"
  | "BLOCKED";

export interface PolicyCommand {
  id: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  /** Optional human-reviewed regex (string) that must match combined stdout+stderr. */
  successMarker?: string;
}

export interface PolicyFile {
  version: 1;
  createdAt: string;
  commands: PolicyCommand[];
  /** Directories/files always excluded from fingerprint (relative POSIX paths or basenames). */
  exclude: string[];
  /** Include untracked files (default true). */
  includeUntracked: boolean;
  /** Note about ignored-file policy, human readable. */
  ignoredPolicyNote: string;
}

export interface TestBaselineEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface TestBaselineFile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  updateReason?: string;
  files: TestBaselineEntry[];
}

export interface CommandEvidence {
  id: string;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** Harness-plumbing env vars removed before spawn (hermetic runs). */
  sanitizedEnv: string[];
}

export interface CheckReceipt {
  kind: "treeverdict-receipt";
  version: 1;
  createdAt: string;
  toolVersion: string;
  // NOTE: no repoRoot field by design. Receipts must stay portable and must
  // not leak absolute local user paths. Legacy receipts (<=0.1.0) may still
  // carry a `repoRoot` string; readers must tolerate and ignore it.
  gitHead: string | null;
  gitStatus: string | null;
  treeHashBefore: string;
  treeHashAfter: string;
  fileCount: number;
  policyHash: string;
  baselineHash: string;
  testBaseline: TestBaselineEntry[];
  policy: PolicyFile;
  commands: CommandEvidence[];
  verdict: Verdict;
  reasons: string[];
  testEvidence: TestEvidenceSummary;
  /** Integrity hash over canonical receipt body (everything except this field). Detects accidental edits. */
  integrity: string;
}

export interface TestEvidenceSummary {
  runner: string | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  total: number | null;
  successMarkerMatched: boolean | null;
  skipDetected: boolean;
  onlyDetected: boolean;
  skipDetails: string[];
  parsedBy: string | null;
  rawExcerpt: string;
}

export interface FingerprintResult {
  hash: string;
  fileCount: number;
  files: { path: string; sha256: string; bytes: number }[];
  symlinkViolations: string[];
  /** Paths that could not be read (EACCES/EPERM/etc). ENOENT (transient deletion) is skipped, not listed. */
  unreadable: string[];
  gitHead: string | null;
  gitStatus: string | null;
}
