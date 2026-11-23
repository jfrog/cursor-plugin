#!/usr/bin/env node
// Local Shadow AI trigger.
//   node local-shadow-trigger.mjs session_start        SessionStart hook (any source)
//   node local-shadow-trigger.mjs user_prompt_submit   UserPromptSubmit hook (every prompt)
//
// Flow:
//   1. the default jf CLI server has an access token
//   2. the backend says scanning is enabled (asked through `jf api`, see jpd-get.mjs);
//      the answer is reused for an hour (SCANNING_CACHE_FILE); a 404 counts as off
//   3. read the plugin version from plugin.json ("UNKNOWN" when unreadable)
//   4. build the session's launch (claude-launch.mjs)
//   5. start `agent-guard --local-shadow-scan --server <id> [--session-id <id>] [--workspace <dir>]
//      --plugin-version <v> --harness <h> [--launch-json -]` in the background, with the
//      launch JSON on its stdin. The launch can hold secrets, so it never goes in argv
//      and only its key names are logged.
// The first step that fails ends the run. The hook doesn't decide when a session
// scans: agent-guard scans a session at most once an hour (a run that died is
// retried after about 6 minutes) and skips a session that is already being scanned.
// Each run appends its result to ~/.jfrog/shadow/local-shadow-hook.log.
// Claude Code only; see README "Local Shadow AI scan".

import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildLaunch } from "./claude-launch.mjs";
import { isMainEntry } from "./entry.mjs";
import { detectHarness, readStdin } from "./io.mjs";
import {
  getPlatformIdentity,
  IdentityCause,
  isHttpsIdentityUrl,
  safeErrorMessage,
} from "./jf-identity.mjs";
import { axesFromAdapterIde, envWithHookUserAgent } from "./jf-user-agent.mjs";
import { jpdGet } from "./jpd-get.mjs";
import { writeJsonAtomic } from "./json-file.mjs";
import {
  GOVERNANCE_AGENT_GUARD_SPEC,
  buildNpxSpawnOptions,
  quoteSpawnArgs,
  resolveAgentGuardBin,
  resolveAgentGuardNpmRegistry,
  resolveNpxCommand,
} from "./rewrite-mcp-json.mjs";

export const RESULT = Object.freeze({
  NOT_LOGGED_IN: "not_logged_in",
  UNSUPPORTED_AUTH: "unsupported_auth",
  SCANNING_DISABLED: "scanning_disabled",
  CHECK_FAILED: "check_failed",
  SCANNER_STARTED: "scanner_started",
});

export const SCANNING_ENABLED_PATH =
  "/aisec/api/v1/local-shadow/scanning-enabled";
const REQUEST_TIMEOUT_MS = 30_000;
// How long the launch write to the scanner's stdin may take. agent-guard reads
// it at startup; through npx with a cold cache that can wait for a download.
const LAUNCH_WRITE_TIMEOUT_MS = 60_000;
export const HOOK_LOG_FILE = "local-shadow-hook.log";
export const HOOK_LOG_MAX_BYTES = 5 * 1024 * 1024;
// Each jf server's scanning-enabled answer is reused for an hour, so prompts don't
// ask the backend again; turning scanning on or off takes effect within the hour.
export const SCANNING_CACHE_FILE = "local-shadow-hook-cache.json";
export const SCANNING_CACHE_TTL_MS = 60 * 60 * 1000;
// Any change to the cache format bumps it; a file in another version is ignored.
const SCANNING_CACHE_VERSION = 1;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
export const UNKNOWN_PLUGIN_VERSION = "UNKNOWN";

// This plugin's harness, as detectHarness names it.
export const HARNESS_ID = "claude_code";
// Per harness: the folder its plugin keeps plugin.json in.
const PLUGIN_MANIFEST_DIRS = Object.freeze({
  claude_code: ".claude-plugin",
});

// <plugin>/modules, as in agents-config.mjs.
const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PLUGIN_DIR = path.dirname(PLUGIN_ROOT);

// The scanner's state directory: $JFROG_CLI_HOME_DIR/shadow, or ~/.jfrog/shadow.
export function shadowDir(env) {
  const jfHome =
    env.JFROG_CLI_HOME_DIR?.trim() || path.join(homedir(), ".jfrog");
  return path.join(jfHome, "shadow");
}

// The plugin's version from its plugin.json. Throws when it can't be read.
export function readPluginVersion(pluginDir = PLUGIN_DIR) {
  const manifest = JSON.parse(
    readFileSync(
      path.join(pluginDir, PLUGIN_MANIFEST_DIRS[HARNESS_ID], "plugin.json"),
      "utf8",
    ),
  );
  const version =
    typeof manifest?.version === "string" ? manifest.version.trim() : "";
  if (!version) throw new Error("plugin.json has no version");
  return version;
}

// The cached answers, one { server_id, shadow_ai_enabled, last_updated_at } per
// jf server: [] when the cache file is missing or in another version. Throws
// when it can't be read or isn't JSON.
function readScanningCache(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const cache = JSON.parse(text);
  return cache?.version === SCANNING_CACHE_VERSION &&
    Array.isArray(cache.servers)
    ? cache.servers
    : [];
}

// Whether a cached answer was updated within the last SCANNING_CACHE_TTL_MS. A
// time in the future means the clock moved back, so it isn't fresh.
function isFresh(entry, nowMs) {
  const age = nowMs - Date.parse(entry?.last_updated_at);
  return age >= 0 && age < SCANNING_CACHE_TTL_MS;
}

// Wraps getFn: the scanning-enabled request is answered from the cache when it
// holds a fresh answer for this jf server id, and each new true/false answer is
// cached, dropping the stale ones. A 404 (no endpoint on this server) is cached
// as off; other failures are not cached. note gets what the
// hook line logs: scanningEnabledFromCache, and scanningCacheError when the
// cache can't be read or written (the backend is then asked on every prompt).
function withScanningCache(getFn, file, nowMs, note) {
  return async (apiPath, identity, options) => {
    let servers = [];
    try {
      servers = readScanningCache(file);
    } catch (err) {
      note.scanningCacheError = `read: ${safeErrorMessage(err)}`;
    }
    const cached = servers.find(
      (entry) => entry?.server_id === identity.serverId,
    );
    note.scanningEnabledFromCache =
      typeof cached?.shadow_ai_enabled === "boolean" && isFresh(cached, nowMs);
    if (note.scanningEnabledFromCache) {
      return { status: 200, body: { enabled: cached.shadow_ai_enabled } };
    }
    const answer = await getFn(apiPath, identity, options);
    const enabled =
      answer.status === 404
        ? false
        : answer.status === 200
          ? answer.body?.enabled
          : undefined;
    if (typeof enabled === "boolean") {
      try {
        writeJsonAtomic(file, {
          version: SCANNING_CACHE_VERSION,
          servers: [
            ...servers.filter(
              (entry) =>
                entry?.server_id !== identity.serverId && isFresh(entry, nowMs),
            ),
            {
              server_id: identity.serverId,
              shadow_ai_enabled: enabled,
              last_updated_at: new Date(nowMs).toISOString(),
            },
          ],
        });
      } catch (err) {
        note.scanningCacheError = `write: ${safeErrorMessage(err)}`;
      }
    }
    return answer;
  };
}

// Asks the backend whether scanning is enabled for this account.
// Returns null when enabled, otherwise the { result, error } to log.
async function checkScanningEnabled(identity, { env, timeoutMs, getFn }) {
  const failed = (detail) => ({
    result: RESULT.CHECK_FAILED,
    error: `scanning enabled: ${detail}`,
  });
  const { status, body, error } = await getFn(SCANNING_ENABLED_PATH, identity, {
    env: envWithHookUserAgent(env, axesFromAdapterIde(HARNESS_ID, env)),
    timeoutMs,
  });
  if (error) return failed(error);
  if (status === 401) {
    return { result: RESULT.NOT_LOGGED_IN, error: "token rejected (HTTP 401)" };
  }
  if (status < 200 || status >= 300) return failed(`HTTP ${status}`);
  if (body?.enabled === true) return null;
  if (body?.enabled === false) return { result: RESULT.SCANNING_DISABLED };
  return failed("response has no boolean 'enabled'");
}

// Writes the launch to the scanner's stdin and closes it. Resolves once the OS
// has it, or with the error; it never rejects.
function writeLaunch(stdin, launch, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve("timed out writing the launch"),
      timeoutMs,
    );
    stdin.once("error", (err) => {
      clearTimeout(timer);
      resolve(safeErrorMessage(err));
    });
    stdin.end(JSON.stringify(launch), (err) => {
      clearTimeout(timer);
      resolve(err ? safeErrorMessage(err) : undefined);
    });
  });
}

// Starts `agent-guard --local-shadow-scan` in the background. Resolves as soon as
// the OS has started the process and has the launch; it never waits for the scan
// to finish. Returns the launch write error, if any.
async function startScanner(
  env,
  platform,
  spawnFn,
  serverId,
  session,
  pluginVersion,
  launch,
) {
  const scanArgs = [
    "--local-shadow-scan",
    ...(serverId ? ["--server", serverId] : []),
    ...(session.id ? ["--session-id", session.id] : []),
    ...(session.workspace ? ["--workspace", session.workspace] : []),
    "--plugin-version",
    pluginVersion,
    "--harness",
    HARNESS_ID,
    ...(launch ? ["--launch-json", "-"] : []),
  ];
  const bin = resolveAgentGuardBin(env);
  const command = bin ?? resolveNpxCommand(platform);
  const args = bin
    ? scanArgs
    : quoteSpawnArgs(
        [
          "--yes",
          "--registry",
          resolveAgentGuardNpmRegistry(env),
          GOVERNANCE_AGENT_GUARD_SPEC,
          ...scanArgs,
        ],
        platform,
      );
  const child = spawnFn(command, args, {
    ...buildNpxSpawnOptions(env, platform, { local: Boolean(bin) }),
    stdio: launch ? ["pipe", "ignore", "ignore"] : "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const launchError = launch
    ? await writeLaunch(child.stdin, launch, LAUNCH_WRITE_TIMEOUT_MS)
    : undefined;
  child.unref();
  return launchError;
}

// Appends one JSON line to the trigger log. When the log reaches HOOK_LOG_MAX_BYTES
// it's renamed to <log>.1 (replacing the old backup) and a new log starts.
export function appendHookLog(logPath, entry) {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true, mode: DIR_MODE });
    const size = statSync(logPath, { throwIfNoEntry: false })?.size ?? 0;
    if (size >= HOOK_LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
    appendFileSync(logPath, `${line}\n`, { mode: FILE_MODE });
  } catch {
    // A failed log write must never fail the hook.
  }
}

// The launch to send, and what to log about it: its key names, or why there is
// none.
function launchFor(payload, buildLaunchFn) {
  if (!payload) return { launch: undefined, note: {} };
  try {
    const launch = buildLaunchFn(payload);
    return { launch, note: { launchFields: Object.keys(launch).sort() } };
  } catch (err) {
    return { launch: undefined, note: { launchError: safeErrorMessage(err) } };
  }
}

// Steps 1-5 of the flow at the top. Returns the { result, error? } to log;
// an unreadable plugin version adds pluginVersionError, the launch adds
// launchFields or launchError. The scanning-enabled check fills cacheNote.
async function runChecksAndStartScanner({
  env,
  session,
  payload,
  getIdentityFn,
  getFn,
  timeoutMs,
  spawnFn,
  platform,
  pluginDir,
  buildLaunchFn,
  now,
  cacheNote,
}) {
  const { identity, cause } = getIdentityFn();
  if (
    identity?.auth?.kind === "basic" ||
    cause === IdentityCause.JF_UNSUPPORTED_AUTH
  ) {
    return {
      result: RESULT.UNSUPPORTED_AUTH,
      error: "the scanner needs an access token, not a username and password",
    };
  }
  if (identity?.auth?.kind !== "bearer" || !identity.auth.token) {
    return { result: RESULT.NOT_LOGGED_IN };
  }
  if (!isHttpsIdentityUrl(identity)) {
    return {
      result: RESULT.CHECK_FAILED,
      error: "platform URL is not HTTPS; the token is not sent in cleartext",
    };
  }

  const notEnabled = await checkScanningEnabled(identity, {
    env,
    timeoutMs,
    getFn: withScanningCache(
      getFn,
      path.join(shadowDir(env), SCANNING_CACHE_FILE),
      now(),
      cacheNote,
    ),
  });
  if (notEnabled) return notEnabled;

  let pluginVersion = UNKNOWN_PLUGIN_VERSION;
  let pluginVersionError;
  try {
    pluginVersion = readPluginVersion(pluginDir);
  } catch (err) {
    pluginVersionError = safeErrorMessage(err);
  }
  const versionNote = pluginVersionError ? { pluginVersionError } : {};
  const { launch, note } = launchFor(payload, buildLaunchFn);

  let launchError;
  try {
    launchError = await startScanner(
      env,
      platform,
      spawnFn,
      identity.serverId,
      session,
      pluginVersion,
      launch,
    );
  } catch (err) {
    return {
      result: RESULT.CHECK_FAILED,
      error: `start scanner: ${safeErrorMessage(err)}`,
      ...versionNote,
    };
  }
  return {
    result: RESULT.SCANNER_STARTED,
    ...versionNote,
    ...note,
    ...(launchError && { launchError }),
  };
}

// The stdin payload, or null when it isn't a JSON object.
export function parsePayload(input) {
  try {
    const payload = JSON.parse(input);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

// The session a scan is for, from the SessionStart or UserPromptSubmit payload: its
// session_id and cwd (the project dir when the payload has no cwd). Either may be missing.
export function parseSession(payload, env) {
  const text = (value) =>
    typeof value === "string" && value ? value : undefined;
  return {
    id: text(payload?.session_id),
    workspace: text(payload?.cwd) ?? text(env.CLAUDE_PROJECT_DIR),
  };
}

// One trigger run: the checks, then one line in local-shadow-hook.log.
// trigger is session_start or user_prompt_submit.
export async function runLocalShadowTrigger(trigger, overrides = {}) {
  const deps = {
    env: process.env,
    session: {},
    payload: undefined,
    buildLaunchFn: buildLaunch,
    getIdentityFn: getPlatformIdentity,
    getFn: jpdGet,
    timeoutMs: REQUEST_TIMEOUT_MS,
    spawnFn: spawn,
    platform: process.platform,
    pluginDir: PLUGIN_DIR,
    now: Date.now,
    ...overrides,
  };
  const cacheNote = {};
  const outcome = await runChecksAndStartScanner({ ...deps, cacheNote });
  appendHookLog(path.join(shadowDir(deps.env), HOOK_LOG_FILE), {
    trigger,
    ...outcome,
    ...cacheNote,
  });
}

// Whether this hook input is from this plugin's harness. Cursor also runs
// Claude's hooks; only Claude Code scans, on any SessionStart source.
export function shouldTrigger(input) {
  return detectHarness(input) === HARNESS_ID;
}

if (isMainEntry(import.meta.url)) {
  const trigger = process.argv[2];
  readStdin()
    .then((input) => {
      const payload = parsePayload(input);
      return (
        shouldTrigger(input) &&
        runLocalShadowTrigger(trigger, {
          session: parseSession(payload, process.env),
          payload,
        })
      );
    })
    .catch(() => {})
    .finally(() => process.exit(0));
}
