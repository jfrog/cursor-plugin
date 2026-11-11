// Plugin install telemetry runner (epic WNGM-5915) — the only telemetry code an
// adapter calls. Checks the opt-out, starts telemetry-worker.mjs in a detached,
// hidden process and returns. No other file I/O, no network, never waits.
//
// Unlike eager setup there is no synchronous fallback: if the spawn fails the
// event is dropped, so telemetry can never hold up session start. It must be a
// process, not a worker thread — a thread dies with the hook process.

import { spawn as nodeSpawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAgentsConfigLoadMeta, loadAgentsConfig } from "./agents-config.mjs";
import { hooksPackageVersion } from "./jf-user-agent.mjs";
import { createLogger } from "./logger.mjs";

const log = createLogger("telemetry");

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(CORE_DIR, "telemetry-worker.mjs");

/**
 * Opt-out (spec "Opt-out"): any one switch turns telemetry off.
 * JFROG_CLI_REPORT_USAGE is deliberately not read. A tree the release sync
 * hasn't stamped (hooks version 0.0.0: a dev install, an eval, a staged copy)
 * reports only with JF_AGENT_TELEMETRY_DEV=1, so it isn't counted as an install.
 */
function telemetryDisabled(env, hooksVersion) {
  if (env.JF_AGENT_TELEMETRY_DISABLE === "1" || env.DO_NOT_TRACK === "1") {
    return true;
  }
  if (hooksVersion === "0.0.0" && env.JF_AGENT_TELEMETRY_DEV !== "1") {
    return true;
  }
  // A file that exists but can't be read or parsed may hold an admin's "off":
  // fail closed rather than fall back to the template's default (on).
  if (getAgentsConfigLoadMeta().parseFailed) return true;
  return !loadAgentsConfig().telemetry.enabled;
}

/** Test hook: a missing executable, so the spawn fails like it would for real. */
function workerCommand(env) {
  return env.JFROG_TEST_HARNESS === "1" &&
    env.JFROG_TEST_TELEMETRY_SPAWN_FAIL === "1"
    ? path.join(CORE_DIR, "telemetry-missing-node")
    : process.execPath;
}

/**
 * Start the telemetry worker for this adapter and return at once. Never
 * throws.
 * @param {string} harnessId — the adapter's HARNESS_ID
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   spawn?: typeof nodeSpawn,
 *   hooksVersion?: string,
 * }} [opts]
 * @returns {boolean} true when a spawn was attempted
 */
export function startTelemetry(harnessId, opts = {}) {
  const env = opts.env ?? process.env;
  const spawn = opts.spawn ?? nodeSpawn;
  try {
    if (telemetryDisabled(env, opts.hooksVersion ?? hooksPackageVersion())) {
      return false;
    }
    const child = spawn(workerCommand(env), [WORKER_PATH, harnessId], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      // Not the session's cwd (the opened repo): on Windows a bare `jf.exe`
      // resolves from the cwd before PATH, and the detached child would also
      // hold the repo folder open.
      cwd: os.homedir(),
      env,
    });
    // Without a listener an async spawn error (ENOENT, EACCES) would be an
    // uncaught exception that kills the adapter before it prints its stdout.
    child.on("error", (err) => {
      log.debug("telemetry worker spawn failed", {
        error: err?.message ?? String(err),
      });
    });
    child.unref();
    return true;
  } catch (err) {
    log.debug("telemetry worker spawn failed", {
      error: err?.message ?? String(err),
    });
    return false;
  }
}
