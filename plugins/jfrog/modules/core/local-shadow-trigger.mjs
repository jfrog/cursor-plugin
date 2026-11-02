#!/usr/bin/env node
// Local Shadow AI trigger.
//   node local-shadow-trigger.mjs session_start   runs once per new session (SessionStart hook)
//
// Flow:
//   1. the default jf CLI server has an access token
//   2. the backend says scanning is enabled (asked through `jf api`, see jpd-get.mjs)
//   3. read the plugin version from plugin.json ("UNKNOWN" when unreadable)
//   4. start `agent-guard --local-shadow-scan --server <id> [--session-id <id>] [--workspace <dir>]
//      --plugin-version <v> --harness <h>` in the background
// The first step that fails ends the run. Each run appends its result to
// ~/.jfrog/shadow/local-shadow-hook.log. Claude Code only; see README
// "Local Shadow AI scan".

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
import {
  AGENT_GUARD_PACKAGE,
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
export const HOOK_LOG_FILE = "local-shadow-hook.log";
export const HOOK_LOG_MAX_BYTES = 5 * 1024 * 1024;
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

// Starts `agent-guard --local-shadow-scan` in the background. Resolves as soon as
// the OS has started the process; it never waits for the scan to finish.
async function startScanner(
  env,
  platform,
  spawnFn,
  serverId,
  session,
  pluginVersion,
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
  ];
  const bin = resolveAgentGuardBin(env);
  const command = bin ?? resolveNpxCommand(platform);
  const args = bin
    ? scanArgs
    : quoteSpawnArgs(
        [
          "--yes",
          "--prefer-offline",
          "--registry",
          resolveAgentGuardNpmRegistry(env),
          AGENT_GUARD_PACKAGE,
          ...scanArgs,
        ],
        platform,
      );
  const child = spawnFn(command, args, {
    ...buildNpxSpawnOptions(env, platform, { local: Boolean(bin) }),
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
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

// Steps 1-4 of the flow at the top. Returns the { result, error? } to log;
// an unreadable plugin version adds pluginVersionError.
async function runChecksAndStartScanner({
  env,
  session,
  getIdentityFn,
  getFn,
  timeoutMs,
  spawnFn,
  platform,
  pluginDir,
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
    getFn,
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

  try {
    await startScanner(
      env,
      platform,
      spawnFn,
      identity.serverId,
      session,
      pluginVersion,
    );
  } catch (err) {
    return {
      result: RESULT.CHECK_FAILED,
      error: `start scanner: ${safeErrorMessage(err)}`,
      ...versionNote,
    };
  }
  return { result: RESULT.SCANNER_STARTED, ...versionNote };
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

// Claude Code also fires SessionStart on resume, /clear and compaction; those
// don't scan. New sessions are "startup" (Claude, Codex) or "new" (VS Code
// Copilot). No source always scans.
const NEW_SESSION_SOURCES = new Set([undefined, "startup", "new"]);
export function isNewSession(payload) {
  return NEW_SESSION_SOURCES.has(payload?.source);
}

// The session a scan is for, from the SessionStart payload: its session_id and cwd (the
// project dir when the payload has no cwd). Either may be missing.
export function parseSession(payload, env) {
  const text = (value) =>
    typeof value === "string" && value ? value : undefined;
  return {
    id: text(payload?.session_id),
    workspace: text(payload?.cwd) ?? text(env.CLAUDE_PROJECT_DIR),
  };
}

// One trigger run: the checks, then one line in local-shadow-hook.log.
// trigger is session_start.
export async function runLocalShadowTrigger(trigger, overrides = {}) {
  const deps = {
    env: process.env,
    session: {},
    getIdentityFn: getPlatformIdentity,
    getFn: jpdGet,
    timeoutMs: REQUEST_TIMEOUT_MS,
    spawnFn: spawn,
    platform: process.platform,
    pluginDir: PLUGIN_DIR,
    ...overrides,
  };
  const outcome = await runChecksAndStartScanner(deps);
  appendHookLog(path.join(shadowDir(deps.env), HOOK_LOG_FILE), {
    trigger,
    ...outcome,
  });
}

if (isMainEntry(import.meta.url)) {
  const trigger = process.argv[2];
  readStdin()
    .then((input) => {
      const payload = parsePayload(input);
      // Cursor also runs Claude's hooks; only this plugin's harness scans.
      return (
        detectHarness(input) === HARNESS_ID &&
        isNewSession(payload) &&
        runLocalShadowTrigger(trigger, {
          session: parseSession(payload, process.env),
        })
      );
    })
    .catch(() => {})
    .finally(() => process.exit(0));
}
