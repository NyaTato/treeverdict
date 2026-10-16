/**
 * Pack smoke test: `npm pack`, install the tarball into a temp project,
 * and run a full init/check/status cycle with the PACKED binary.
 * Guards against missing files[] entries and broken bin wiring.
 */
import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = process.cwd();
// Shell-free npm: run npm's own CLI through this node (Windows .cmd shims
// cannot be spawned directly; shell:true would raise DEP0190 noise).
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const NPM = fs.existsSync(NPM_CLI) ? [process.execPath, NPM_CLI] : ["npm"];
function npmIn(dir, ...args) {
  return execFileSync(NPM[0], [...NPM.slice(1), ...args], { cwd: dir, encoding: "utf8" });
}
const packOut = npmIn(root, "pack", "--silent").trim().split("\n").pop().trim();
const tarball = path.join(root, packOut);
console.log(`packed: ${packOut}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-smoke-"));
execFileSync(NPM[0], [...NPM.slice(1), "init", "-y"], { cwd: dir, stdio: "ignore" });
execFileSync(NPM[0], [...NPM.slice(1), "install", "--no-audit", "--no-fund", tarball], { cwd: dir, stdio: "ignore" });
// Run the PACKED dist entry with this node (exercises packed files[] + bin wiring).
const packedCli = path.join(dir, "node_modules", "treeverdict", "dist", "cli.js");
if (!fs.existsSync(packedCli)) throw new Error("smoke: packed dist/cli.js missing from tarball");

function tv(...args) {
  const r = spawnSync(process.execPath, [packedCli, ...args], { cwd: dir, encoding: "utf8" });
  console.log(`$ treeverdict ${args.join(" ")} -> exit ${r.status}`);
  return r.status;
}
if (tv("--help") !== 0) throw new Error("smoke: --help failed");

fs.mkdirSync(path.join(dir, "test"), { recursive: true });
fs.writeFileSync(path.join(dir, "test", "s.test.mjs"), "import test from 'node:test';\ntest('ok', (t) => { t.assert.equal(1, 1); });\n");
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
pkg.scripts = { ...(pkg.scripts ?? {}), test: "node --test" };
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));

if (tv("init", "--yes") !== 0) throw new Error("smoke: init failed");
if (tv("check") !== 0) throw new Error("smoke: check failed");
if (tv("status") !== 0) throw new Error("smoke: status failed");
console.log("smoke: packed CLI verifies a project end to end. OK");
fs.rmSync(tarball);
