import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CommandEvidence } from "./types.js";

const MAX_CAPTURE = 1024 * 1024; // 1 MiB per stream; rest truncated with flag.

export interface ResolvedCommand {
  /** Absolute path to the executable (or original program if not found). */
  file: string;
  /** Human-readable launch note recorded in evidence. */
  via: string;
}

function pathext(): string[] {
  if (process.platform !== "win32") return ["", ".exe", ".sh"];
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").map((s) => s.toLowerCase());
}

/** Minimal `which`: search PATH (plus cwd-relative) honoring PATHEXT on Windows. */
export function resolveOnPath(program: string, cwd: string): string | null {
  const exts = pathext();
  const candidates: string[] = [];
  if (program.includes("/") || program.includes(path.sep)) {
    const abs = path.resolve(cwd, program);
    candidates.push(abs);
  } else {
    const pathVar = process.env.PATH ?? "";
    for (const dir of pathVar.split(path.delimiter)) {
      if (!dir) continue;
      candidates.push(path.join(dir, program));
    }
  }
  for (const base of candidates) {
    if (process.platform === "win32") {
      for (const ext of exts) {
        const full = ext && !base.toLowerCase().endsWith(ext) ? base + ext : base;
        try {
          const st = fs.statSync(full);
          if (st.isFile()) return full;
        } catch {
          /* next */
        }
      }
    } else {
      try {
        fs.accessSync(base, fs.constants.X_OK);
        if (fs.statSync(base).isFile()) return base;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/**
 * Quote one argv element for cmd.exe /s /c so shell operators stay literal.
 * Each element is individually quoted; `|`, `&`, `;` etc. inside quotes are
 * data, never control operators. `%` is doubled to defeat env expansion.
 */
export function quoteForCmd(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"()%!^<>&|;,=\]]/.test(arg)) return arg;
  let escaped = arg.replace(/(\\*)"/g, "$1$1\\\"");
  escaped = escaped.replace(/(\\+)$/, "$1$1");
  escaped = escaped.replace(/%/g, "%%");
  return `"${escaped}"`;
}

/**
 * Resolve argv[0] to an absolute executable.
 * - Direct binaries (.exe, extensionless POSIX) run with shell:false.
 * - On Windows, .CMD/.BAT shims cannot be CreateProcess-ed directly; they are
 *   launched as `cmd.exe /d /s /c "<individually-quoted argv>"`. Quoting keeps
 *   every element literal, so policy arguments still cannot inject shell
 *   operators — the property the verifier relies on. The launch path is
 *   recorded in evidence (`via: "cmd-shim"`).
 */
export function resolveCommand(program: string, cwd: string): ResolvedCommand {
  const found = resolveOnPath(program, cwd);
  const file = found ?? program;
  if (process.platform === "win32") {
    const lower = file.toLowerCase();
    if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
      return { file, via: "cmd-shim" };
    }
  }
  return { file, via: "direct" };
}

/**
 * Harness-plumbing variables that must NOT leak into a verified run.
 * `NODE_TEST_CONTEXT` is set inside `node --test` child processes; if it
 * leaks through, an inner `node --test` refuses to run ("called recursively")
 * — so the verdict would depend on HOW treeverdict itself was invoked.
 * The verifier strips these (recorded in evidence) for hermetic runs.
 * Everything else (PATH, user config, CI vars) passes through untouched.
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; removed: string[] } {
  const removed: string[] = [];
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^NODE_TEST_/i.test(key) || /^NODE_CHANNEL_/i.test(key)) {
      removed.push(key);
      delete clean[key];
    }
  }
  return { env: clean, removed };
}

/**
 * Execute argv directly WITHOUT a user shell. No `shell: true`, no string
 * concatenation of untrusted input — the OS receives the argument vector
 * (or an exactly-quoted equivalent for Windows .cmd shims), so shell
 * operators (`|`, `&&`, `;`, backticks, `$()`) cannot mask the exit code.
 */
export function runCommand(
  root: string,
  argv: string[],
  cwdRel: string | undefined,
  timeoutMs: number | undefined
): Promise<CommandEvidence> {
  const cwd = cwdRel ? path.resolve(root, cwdRel) : root;
  // Evidence is portable: the exact working directory is expressed relative
  // to the repository root, while spawn still receives the absolute path.
  const evidenceCwd = path.relative(root, cwd).split(path.sep).join("/") || ".";
  const timeout = timeoutMs ?? 300000;
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (ev: CommandEvidence) => {
      if (done) return;
      done = true;
      resolve(ev);
    };
    let stdout = "";
    let stderr = "";
    let truncated = false;

    const resolved = resolveCommand(argv[0], cwd);
    let file = resolved.file;
    let args = argv.slice(1);
    let via = resolved.via;
    let verbatim = false;
    if (resolved.via === "cmd-shim") {
      // Windows .CMD/.BAT shims cannot be CreateProcess-ed directly. Launch via
      // `cmd.exe /d /s /c "<individually-quoted argv>"`. Two details matter:
      //  - The OUTER quote pair is consumed by /s; inner per-element quotes stay
      //    intact, so every argv element remains literal (no operator injection).
      //  - windowsVerbatimArguments skips libuv's own quoting (which would add
      //    backslash escapes cmd.exe does not understand); we own the raw line.
      const line = [file, ...args].map(quoteForCmd).join(" ");
      file = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
      args = ["/d", "/s", "/c", `"${line}"`];
      verbatim = true;
    }

    let child;
    const { env: cleanEnv, removed: sanitizedEnv } = sanitizeEnv(process.env);
    try {
      child = spawn(file, args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: cleanEnv,
        ...(verbatim ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (err) {
      finish({
        id: "",
        argv: [...argv, ` [via=${via}]`],
        cwd: evidenceCwd,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        timedOut: false,
        stdout: "",
        stderr: `[spawn error: ${String(err)}]`,
        truncated: false,
        sanitizedEnv,
      });
      return;
    }
    const append = (store: "out" | "err", chunk: Buffer | string) => {
      const s = chunk.toString("utf8");
      if (store === "out") {
        if (stdout.length + s.length > MAX_CAPTURE) {
          truncated = true;
          stdout += s.slice(0, Math.max(0, MAX_CAPTURE - stdout.length));
        } else stdout += s;
      } else {
        if (stderr.length + s.length > MAX_CAPTURE) {
          truncated = true;
          stderr += s.slice(0, Math.max(0, MAX_CAPTURE - stderr.length));
        } else stderr += s;
      }
    };
    child.stdout?.on("data", (c) => append("out", c));
    child.stderr?.on("data", (c) => append("err", c));
    child.on("error", (err) => {
      finish({
        id: "",
        argv: [...argv, ` [via=${via}]`],
        cwd: evidenceCwd,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        timedOut: false,
        stdout,
        stderr: stderr + `\n[spawn error: ${String(err)}]`,
        truncated,
        sanitizedEnv,
      });
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeout);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const timedOut = durationMs >= timeout && code === null;
      finish({
        id: "",
        argv: [...argv, ` [via=${via}]`],
        cwd: evidenceCwd,
        exitCode: code,
        signal: signal ? String(signal) : null,
        durationMs,
        timedOut,
        stdout,
        stderr,
        truncated,
        sanitizedEnv,
      });
    });
  });
}
