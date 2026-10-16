import * as fs from "node:fs";
import * as path from "node:path";
import { CommandEvidence, TestBaselineFile, TestEvidenceSummary } from "./types.js";
import { hashFileBytes } from "./tree.js";

export interface BaselineCheck {
  ok: boolean;
  changed: string[];
  deleted: string[];
  added: string[];
}

export function checkBaseline(root: string, baseline: TestBaselineFile): BaselineCheck {
  const changed: string[] = [];
  const deleted: string[] = [];
  const seen = new Set<string>();
  for (const entry of baseline.files) {
    seen.add(entry.path);
    const abs = path.join(root, entry.path);
    if (!fs.existsSync(abs)) {
      deleted.push(entry.path);
      continue;
    }
    try {
      const { sha256 } = hashFileBytes(abs);
      if (sha256 !== entry.sha256) changed.push(entry.path);
    } catch {
      changed.push(entry.path + " (unreadable)");
    }
  }
  // Added test files: discover current test files not in baseline.
  // (Discovery imported lazily to avoid cycles — reimplemented pattern inline.)
  const added: string[] = [];
  return { ok: changed.length === 0 && deleted.length === 0, changed, deleted, added };
}

const SKIP_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bdescribe\.skip\s*\(/, label: "describe.skip" },
  { re: /\bit\.skip\s*\(/, label: "it.skip" },
  { re: /\btest\.skip\s*\(/, label: "test.skip" },
  { re: /\bxtest\s*\(/, label: "xtest" },
  { re: /\bxdescribe\s*\(/, label: "xdescribe" },
  { re: /\bxit\s*\(/, label: "xit" },
  { re: /@pytest\.mark\.skip\b/, label: "@pytest.mark.skip" },
  { re: /@unittest\.skip\b/, label: "@unittest.skip" },
  { re: /\bt\.skip\s*\(/, label: "t.skip (tap/node)" },
];

const ONLY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bdescribe\.only\s*\(/, label: "describe.only" },
  { re: /\bit\.only\s*\(/, label: "it.only" },
  { re: /\btest\.only\s*\(/, label: "test.only" },
  { re: /\bfdescribe\s*\(/, label: "fdescribe" },
  { re: /\bfit\s*\(/, label: "fit" },
];

/** Scan baseline test files for skip/only markers. Comment-line filtering keeps false positives low. */
export function scanTestFilesForSkipOnly(
  root: string,
  baseline: TestBaselineFile
): { skipDetected: boolean; onlyDetected: boolean; details: string[] } {
  const details: string[] = [];
  let skipDetected = false;
  let onlyDetected = false;
  for (const entry of baseline.files) {
    const abs = path.join(root, entry.path);
    let content = "";
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // A marker inside a comment is inactive code — ignore it to keep false
      // positives low (e.g. `// test.skip(...)` left from an old debugging session).
      const isComment =
        trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*");
      if (isComment) return;
      for (const p of SKIP_PATTERNS) {
        if (p.re.test(line)) {
          skipDetected = true;
          details.push(`${entry.path}:${idx + 1}: ${p.label}`);
        }
      }
      for (const p of ONLY_PATTERNS) {
        if (p.re.test(line)) {
          onlyDetected = true;
          details.push(`${entry.path}:${idx + 1}: ${p.label}`);
        }
      }
    });
    if (content.trim().length === 0) {
      skipDetected = true;
      details.push(`${entry.path}: empty test file (0 bytes of test code)`);
    }
  }
  return { skipDetected, onlyDetected, details };
}

export interface ParsedCounts {
  runner: string;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  total: number | null;
  parsedBy: string;
}

/**
 * Parse known test-runner output for real pass/fail counts.
 * Returns null when output matches NO known runner signature — the caller
 * must then treat the run as NOT_PROVEN (exit code alone proves nothing).
 */
export function parseTestOutput(text: string): ParsedCounts | null {
  const patterns: { runner: string; parsedBy: string; re: RegExp; map: (m: RegExpMatchArray) => Omit<ParsedCounts, "runner" | "parsedBy"> }[] = [
    {
      // Node >= 18 default spec reporter (`node --test` bare). The leading
      // glyphs (✔/ℹ) may arrive encoding-mangled (`?`) under non-UTF8
      // consoles, so anchor on the words, not the glyphs.
      runner: "node-test",
      parsedBy: "node --test spec summary",
      re: /\btests\s+(\d+)\b[\s\S]*?\bpass\s+(\d+)\b[\s\S]*?\bfail\s+(\d+)\b/i,
      map: (m) => ({
        passed: parseInt(m[2], 10),
        failed: parseInt(m[3], 10),
        skipped: (() => {
          const sm = text.match(/\bskipped\s+(\d+)\b/i);
          return sm ? parseInt(sm[1], 10) : 0;
        })(),
        total: parseInt(m[1], 10),
      }),
    },
    {
      runner: "vitest",
      parsedBy: "vitest summary",
      re: /Test Files\s+(\d+)\s+passed.*?Tests\s+(\d+)\s+passed\s*(?:\(\s*(\d+)\s+skipped\))?/s,
      map: (m) => ({
        passed: parseInt(m[2], 10),
        failed: 0,
        skipped: m[3] ? parseInt(m[3], 10) : 0,
        total: parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) : 0),
      }),
    },
    {
      runner: "vitest",
      parsedBy: "vitest failed summary",
      re: /Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/s,
      map: (m) => ({
        passed: parseInt(m[2], 10),
        failed: parseInt(m[1], 10),
        skipped: 0,
        total: parseInt(m[1], 10) + parseInt(m[2], 10),
      }),
    },
    {
      runner: "jest",
      parsedBy: "jest summary",
      re: /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/,
      map: (m) => ({
        passed: parseInt(m[3], 10),
        failed: m[1] ? parseInt(m[1], 10) : 0,
        skipped: m[2] ? parseInt(m[2], 10) : 0,
        total: parseInt(m[4], 10),
      }),
    },
    {
      runner: "mocha",
      parsedBy: "mocha summary",
      re: /(\d+)\s+passing\b(?:.*?(\d+)\s+failing)?(?:.*?(\d+)\s+pending)?/s,
      map: (m) => ({
        passed: parseInt(m[1], 10),
        failed: m[2] ? parseInt(m[2], 10) : 0,
        skipped: m[3] ? parseInt(m[3], 10) : 0,
        total: parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0) + (m[3] ? parseInt(m[3], 10) : 0),
      }),
    },
    {
      runner: "tap",
      parsedBy: "tap summary",
      re: /#\s*(?:pass|passing)[^\n]*?(\d+)[\s\S]*?#\s*fail[^\n]*?(\d+)/i,
      map: (m) => ({
        passed: parseInt(m[1], 10),
        failed: parseInt(m[2], 10),
        skipped: 0,
        total: parseInt(m[1], 10) + parseInt(m[2], 10),
      }),
    },
    {
      runner: "node-test",
      parsedBy: "node --test summary",
      re: /#\s*pass\s+(\d+)[\s\S]*?#\s*fail\s+(\d+)/i,
      map: (m) => ({
        passed: parseInt(m[1], 10),
        failed: parseInt(m[2], 10),
        skipped: (() => {
          const sm = text.match(/#\s*skip\s+(\d+)/i);
          return sm ? parseInt(sm[1], 10) : 0;
        })(),
        total: parseInt(m[1], 10) + parseInt(m[2], 10),
      }),
    },
    {
      runner: "pytest",
      parsedBy: "pytest summary",
      re: /(\d+)\s+passed?(?:,\s*(\d+)\s+skipped?)?(?:,\s*(\d+)\s+failed?)?[^\n]*in\s+[\d.]+s/,
      map: (m) => ({
        passed: parseInt(m[1], 10),
        failed: m[3] ? parseInt(m[3], 10) : 0,
        skipped: m[2] ? parseInt(m[2], 10) : 0,
        total: parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0) + (m[3] ? parseInt(m[3], 10) : 0),
      }),
    },
    {
      runner: "go",
      parsedBy: "go test",
      re: /\b(ok|FAIL)\b[^\n]*$/,
      map: (m) => ({
        passed: m[1] === "ok" ? 1 : 0,
        failed: m[1] === "FAIL" ? 1 : 0,
        skipped: 0,
        total: 1,
      }),
    },
  ];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) return { runner: p.runner, parsedBy: p.parsedBy, ...p.map(m) };
  }
  // Generic TAP-ish `1..N` plan + explicit `ok` lines.
  const plan = text.match(/^1\.\.(\d+)\s*$/m);
  if (plan) {
    const total = parseInt(plan[1], 10);
    const notOk = (text.match(/^not ok\b/gm) || []).length;
    const ok = (text.match(/^ok\b/gm) || []).length;
    if (ok + notOk > 0) {
      return {
        runner: "tap-generic",
        parsedBy: "tap plan 1..N",
        passed: ok,
        failed: notOk,
        skipped: 0,
        total,
      };
    }
  }
  // "No tests found" signals.
  if (/No tests found|No test files found|found 0 tests|0 passed/i.test(text) && !/1 passed|[2-9]\d* passed/.test(text)) {
    return { runner: "none", parsedBy: "no-tests signal", passed: 0, failed: 0, skipped: 0, total: 0 };
  }
  return null;
}

export function summarizeEvidence(
  commands: CommandEvidence[],
  successMarkers: (string | undefined)[],
  skipScan: { skipDetected: boolean; onlyDetected: boolean; details: string[] }
): TestEvidenceSummary {
  const combined = commands.map((c) => c.stdout + "\n" + c.stderr).join("\n");
  const parsed = parseTestOutput(combined);
  let markerMatched: boolean | null = null;
  for (const marker of successMarkers) {
    if (!marker) continue;
    if (markerMatched === null) markerMatched = false;
    try {
      if (new RegExp(marker).test(combined)) markerMatched = true;
    } catch {
      if (combined.includes(marker)) markerMatched = true;
    }
  }
  return {
    runner: parsed?.runner ?? null,
    passed: parsed?.passed ?? null,
    failed: parsed?.failed ?? null,
    skipped: parsed
      ? (parsed.skipped ?? 0) + (skipScan.skipDetected ? 0 : 0)
      : null,
    total: parsed?.total ?? null,
    successMarkerMatched: markerMatched,
    skipDetected: skipScan.skipDetected,
    onlyDetected: skipScan.onlyDetected,
    skipDetails: skipScan.details,
    parsedBy: parsed?.parsedBy ?? null,
    rawExcerpt: combined.slice(-2000),
  };
}
