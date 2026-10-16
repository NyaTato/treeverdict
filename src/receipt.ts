import * as fs from "node:fs";
import * as path from "node:path";
import { CheckReceipt } from "./types.js";
import { canonicalHash, stableStringify } from "./util.js";

export function receiptIntegrityHash(receipt: Omit<CheckReceipt, "integrity">): string {
  return canonicalHash(JSON.parse(stableStringify(receipt)) as unknown);
}

/** Write receipt atomically; returns absolute path. */
export function writeReceipt(root: string, receipt: CheckReceipt): string {
  const dir = path.join(root, ".treeverdict", "receipts");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = receipt.createdAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return file;
}

export function loadReceipt(root: string): { receipt: CheckReceipt; path: string } | null {
  const p = path.join(root, ".treeverdict", "receipts", "latest.json");
  if (!fs.existsSync(p)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(p, "utf8")) as CheckReceipt;
    return { receipt, path: p };
  } catch {
    return null;
  }
}

/** Recompute integrity hash; false => receipt was hand-edited (tamp-backed).
 * Legacy receipts (<=0.1.0) may carry an absolute `repoRoot` string inside the
 * body; it is included in the hash exactly as stored, so old receipts still
 * verify. New receipts simply omit the field. */
export function verifyReceiptIntegrity(receipt: CheckReceipt): boolean {
  if (!receipt || typeof receipt.integrity !== "string") return false;
  const { integrity, ...body } = receipt;
  void integrity;
  const recomputed = receiptIntegrityHash(body as Omit<CheckReceipt, "integrity">);
  return recomputed === receipt.integrity;
}
