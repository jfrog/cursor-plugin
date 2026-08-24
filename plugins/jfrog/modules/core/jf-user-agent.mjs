// Thin JFROG_CLI_USER_AGENT for jf spawned by APR (eager setup + heartbeat).
//
// Stamp only what sessionStart actually knows right now:
//   - trigger=hook
//   - jfrog-skills/<hooks-pkg> (Coralogix product filter unity)
//   - jfrog-cli-go/<probed>
//   - tool= from adapter ctx.ide (via JFROG_APR_UA_TOOL)
//   - client= from TERM_PROGRAM when present in this process
//
// Do NOT stamp model= — skills/agent own the model slug and set it when the
// agent is actually running with a known model (usually a later bash tool).
// Spawn env is inherited so CLI DetectExecutionContext can append
// ai-agent/ / ai-client/ / ai-model/ when those signals exist at jf start.

import { spawnSync } from "node:child_process";

// Plugin sync stamps this literal with the release semver (jfrog-sync-modules.py
// stamp). Only `modules/` is vendored, so nothing outside this tree is readable
// at runtime. Unstamped trees (this repo, local dev) report 0.0.0.
const PKG_VERSION = "0.11.1";

const MAX_TOKEN_LEN = 64;

/** @type {string | undefined} */
let cachedCliVersion;

/**
 * @param {string | undefined | null} raw
 * @returns {string}
 */
export function sanitizeToken(raw) {
  if (raw == null || raw === "") return "";
  let s = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
  if (s.length > MAX_TOKEN_LEN) s = s.slice(0, MAX_TOKEN_LEN);
  return s;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveCliVersion(env = process.env) {
  if (env.JFROG_TEST_CLI_VERSION) return String(env.JFROG_TEST_CLI_VERSION);
  if (cachedCliVersion) return cachedCliVersion;
  try {
    // Keep process PATH/HOME even when callers pass a sparse env object
    // (unit tests often pass only UA-related keys).
    const res = spawnSync("jf", ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, ...env },
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const m = out.match(/(\d+\.\d+\.\d+(?:-[^\s]+)?)/);
    cachedCliVersion = m?.[1] || "unknown";
  } catch {
    cachedCliVersion = "unknown";
  }
  return cachedCliVersion;
}

/**
 * Axes present on the hook process itself (not invented, not model).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ tool?: string }} [opts]
 * @returns {{ tool?: string, client?: string }}
 */
export function resolveHookUaAxes(env = process.env, opts = {}) {
  const tool =
    sanitizeToken(opts.tool) ||
    sanitizeToken(env.JFROG_APR_UA_TOOL) ||
    undefined;
  const client = sanitizeToken(env.TERM_PROGRAM) || undefined;
  return { tool, client };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ tool?: string }} [opts]
 * @returns {string}
 */
export function buildHookJfUserAgent(env = process.env, opts = {}) {
  const axes = resolveHookUaAxes(env, opts);
  const parts = ["trigger=hook"];
  if (axes.tool) parts.push(`tool=${axes.tool}`);
  if (axes.client) parts.push(`client=${axes.client}`);
  return `jfrog-skills/${PKG_VERSION} (${parts.join("; ")}) jfrog-cli-go/${resolveCliVersion(env)}`;
}

/**
 * Spawn env: full inherit + hook UA override.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ tool?: string }} [opts]
 * @returns {NodeJS.ProcessEnv}
 */
export function envWithHookUserAgent(env = process.env, opts = {}) {
  return { ...env, JFROG_CLI_USER_AGENT: buildHookJfUserAgent(env, opts) };
}

/** @internal test helper */
export function _resetCliVersionCacheForTests() {
  cachedCliVersion = undefined;
}
