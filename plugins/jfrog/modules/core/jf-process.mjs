// Shell-free JFrog CLI process boundary shared by coding-agent hooks.
//
// Production invokes the native CLI directly (`jf.exe` on Windows, `jf`
// elsewhere). Tests may substitute the Node fake only when the explicit test
// harness gate is active; normal production environments ignore the driver.

import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Resolve the shell-free executable and argv for a JFrog CLI invocation.
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {{ command: string, args: string[] }}
 */
export function jfInvocation(
  args,
  { env = process.env, platform = process.platform } = {},
) {
  const testDriver =
    env.JFROG_TEST_HARNESS === "1" ? env.JFROG_TEST_JF_DRIVER : undefined;
  return testDriver
    ? { command: process.execPath, args: [testDriver, ...args] }
    : { command: platform === "win32" ? "jf.exe" : "jf", args };
}

/**
 * Synchronously invoke the JFrog CLI without a shell.
 *
 * Test-only injection requires both:
 *   JFROG_TEST_HARNESS=1
 *   JFROG_TEST_JF_DRIVER=/absolute/path/to/fake-jf.mjs
 *
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export function spawnJfSync(args, options = {}) {
  const env = options.env ?? process.env;
  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const rest = { ...options };
  delete rest.spawnSyncFn;
  const invocation = jfInvocation(args, { env });
  return spawnSyncFn(invocation.command, invocation.args, {
    windowsHide: true,
    shell: false,
    ...rest,
    env,
  });
}
