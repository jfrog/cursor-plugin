// JFrog CLI process boundary shared by coding-agent hooks.
//
// Production runs the CLI found on PATH: `jf` elsewhere, and on Windows
// `jf.exe` or npm's `jf.cmd` shim (`npm install -g jfrog-cli-v2-jf`). Windows
// gets a full path from our own PATH scan, never a bare name: Node looks a
// bare name up in the working directory (the opened repo) before PATH. Node
// won't spawn a `.cmd` without a shell (CVE-2024-27980), so `jf.cmd` runs
// through cmd.exe with its arguments screened and quoted. Tests may substitute
// the Node fake only when the explicit test harness gate is active; normal
// production environments ignore the driver.

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Characters cmd.exe could act on, plus `%` and `!` (expanded even inside
// quotes). Spaces are fine: every argument is quoted.
const CMD_ARG_UNSAFE = /[&|;$<>`"'\\^%!\r\n]/;
// For the jf.cmd path: cmd.exe expands `%` and `!` even inside our quotes, and
// npm's shim sets `dp0=%~dp0` unquoted, where `&` splits the line and `^`
// escapes. Other characters are fine, and every path has `\`.
const CMD_PATH_UNSAFE = /[%!"&^\r\n]/;

/** `error.code` from spawnJfSync when jf was found but not run (see `refused`). */
export const JF_REFUSED = "EJFREFUSED";

// Windows env keys are case-insensitive (`Path`, `SystemRoot`), but a copied
// env object is a plain object.
function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// The first `jf.exe` in the PATH directories, else the first `jf.cmd`, else "".
// A `jf.exe` anywhere on PATH wins over an earlier `jf.cmd`: hooks that ran a
// native jf.exe before jf.cmd support keep running it, never switching to
// npm's shim and its cmd.exe argument screen. Windows allows a quoted entry
// (`"C:\Tools\jf"`), so surrounding quotes are dropped. Relative entries are
// skipped: they resolve against the working directory.
function resolveJfPath(env) {
  const dirs = String(envValue(env, "PATH") ?? "")
    .split(path.delimiter)
    .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
    .filter((dir) => path.isAbsolute(dir));
  for (const name of ["jf.exe", "jf.cmd"]) {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      if (isFile(file)) return file;
    }
  }
  return "";
}

/**
 * Resolve the executable, argv and shell for a JFrog CLI invocation.
 * `command` is "" when jf can't be run, and callers spawn nothing: jf is not
 * on PATH, or `refused` says why the jf.cmd line would be unsafe for cmd.exe
 * ("unsafe-arg" or "unsafe-path").
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {{ command: string, args: string[], shell: string | false, refused?: "unsafe-arg" | "unsafe-path" }}
 */
export function jfInvocation(
  args,
  { env = process.env, platform = process.platform } = {},
) {
  const testDriver =
    env.JFROG_TEST_HARNESS === "1" ? env.JFROG_TEST_JF_DRIVER : undefined;
  if (testDriver) {
    return {
      command: process.execPath,
      args: [testDriver, ...args],
      shell: false,
    };
  }
  if (platform !== "win32") return { command: "jf", args, shell: false };

  const jfPath = resolveJfPath(env);
  if (!jfPath.endsWith(".cmd")) {
    return { command: jfPath, args, shell: false };
  }
  if (CMD_PATH_UNSAFE.test(jfPath)) {
    return { command: "", args, shell: false, refused: "unsafe-path" };
  }
  if (args.some((arg) => CMD_ARG_UNSAFE.test(arg))) {
    return { command: "", args, shell: false, refused: "unsafe-arg" };
  }
  // One quoted command line and no args array: spaces survive, and Node
  // doesn't warn (DEP0190). cmd.exe by full path, not ComSpec or a bare name.
  const root = envValue(env, "SYSTEMROOT");
  const systemRoot = root && path.win32.isAbsolute(root) ? root : "C:\\Windows";
  return {
    command: [jfPath, ...args].map((arg) => `"${arg}"`).join(" "),
    args: [],
    shell: path.win32.join(systemRoot, "System32", "cmd.exe"),
  };
}

/**
 * Synchronously invoke the JFrog CLI. When jf can't be run, returns a failed
 * spawn result without spawning: `error.code` is ENOENT when jf is not on
 * PATH, or JF_REFUSED when it was refused for cmd.exe.
 *
 * Test-only injection requires both:
 *   JFROG_TEST_HARNESS=1
 *   JFROG_TEST_JF_DRIVER=/absolute/path/to/fake-jf.mjs
 *
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding & { platform?: NodeJS.Platform }} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export function spawnJfSync(args, options = {}) {
  const env = options.env ?? process.env;
  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const rest = { ...options };
  delete rest.spawnSyncFn;
  delete rest.platform;
  const invocation = jfInvocation(args, { env, platform: options.platform });
  if (!invocation.command) {
    const error = invocation.refused
      ? Object.assign(
          new Error(`jf not run: ${invocation.refused} for cmd.exe`),
          { code: JF_REFUSED },
        )
      : Object.assign(new Error("spawn jf ENOENT"), { code: "ENOENT" });
    return {
      pid: 0,
      output: [],
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      error,
    };
  }
  return spawnSyncFn(invocation.command, invocation.args, {
    windowsHide: true,
    shell: invocation.shell,
    ...rest,
    env,
  });
}
