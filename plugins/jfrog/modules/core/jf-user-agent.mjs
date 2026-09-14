// Thin JFROG_CLI_USER_AGENT for jf spawned by APR (eager setup + heartbeat).
//
// Stamp only what sessionStart actually knows right now:
//   - trigger=hook
//   - jfrog-skills/<hooks-pkg> (Coralogix product filter unity)
//   - jfrog-cli-go/<probed>
//   - tool= from adapter ctx.ide (via JFROG_APR_UA_TOOL)
//   - client= from host env (same order as skills detect_host_client / CLI
//     detectClient), then adapter default (cursor→cursor, copilot→vscode).
//     Inherited TERM_PROGRAM=vscode is omitted; known terminals map to short
//     names. CURSOR_VERSION is hook-only (sessionStart).
//
// Do NOT stamp model= — skills/agent own the model slug and set it when the
// agent is actually running with a known model (usually a later bash tool).
// Spawn env is inherited so CLI DetectExecutionContext can append
// ai-agent/ / ai-client/ / ai-model/ when those signals exist at jf start.

import { spawnSync } from "node:child_process";

// Plugin sync stamps this literal with the release semver (jfrog-sync-modules.py
// stamp). Only `modules/` is vendored, so nothing outside this tree is readable
// at runtime. Unstamped trees (this repo, local dev) report 0.0.0.
const PKG_VERSION = "0.12.1";

/** Product UA for plugin `fetch()` (no trigger, no jfrog-cli-go). */
export function skillsProductUserAgent() {
  return `jfrog-skills/${PKG_VERSION}`;
}

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

const IDE_TOOL = {
  claude_code: "claude",
  cursor: "cursor",
  copilot: "copilot",
  codex: "codex",
};
// Fallback window when no host env proves otherwise: the adapter only ships for
// these two, and each has a default home.
const IDE_CLIENT = {
  cursor: "cursor",
  copilot: "vscode",
};

// The window is read from env the *editor* owns, because the same agent runs in
// IntelliJ, Zed and VS Code. Order matters: every VS Code fork copies the
// VSCODE_* names verbatim, so forks must resolve before anything says "vscode".
// Mirrors detectClient in jfrog-cli-core so both layers agree on the wire value.
const ASKPASS_ENV_VARS = ["VSCODE_GIT_ASKPASS_MAIN", "VSCODE_GIT_ASKPASS_NODE"];
const COPILOT_VSCODE_PLUGIN_ALIAS = "github_copilot_vscode_agent";

const TERMINAL_NAME_ALIASES = {
  "iterm.app": "iterm",
  iterm: "iterm",
  apple_terminal: "terminal",
  warpterminal: "warp",
  warp: "warp",
  tmux: "tmux",
  wezterm: "wezterm",
  alacritty: "alacritty",
  kitty: "kitty",
  ghostty: "ghostty",
  hyper: "hyper",
};

function normalizeAskpassPath(raw) {
  return String(raw || "")
    .toLowerCase()
    .replaceAll("\\", "/");
}

// VSCODE_GIT_ASKPASS_* embeds the application name (…/Cursor.app/…).
// GIT_ASKPASS is generic git and is excluded.
function askpassPathContains(env, app) {
  const needle = String(app).toLowerCase();
  return ASKPASS_ENV_VARS.some((key) => {
    const p = normalizeAskpassPath(env[key]);
    if (!p) return false;
    return (
      p.includes(`/${needle}.app`) ||
      p.includes(`/${needle}/resources`) ||
      p.includes(`/.${needle}-server`)
    );
  });
}

function askpassLooksLikeStockVSCode(env) {
  return ASKPASS_ENV_VARS.some((key) => {
    const p = normalizeAskpassPath(env[key]);
    if (!p) return false;
    return (
      p.includes("/visual studio code") ||
      p.includes("/microsoft vs code") ||
      p.includes("/.vscode-server") ||
      p.includes("/code/resources")
    );
  });
}

function foldAgentName(raw) {
  if (raw == null || raw === "") return "";
  const name = String(raw).trim().toLowerCase();
  const i = name.indexOf("@");
  return i >= 0 ? name.slice(0, i) : name;
}

function isCopilotVSCodePluginAlias(env) {
  return (
    foldAgentName(env.AI_AGENT) === COPILOT_VSCODE_PLUGIN_ALIAS ||
    foldAgentName(env.AGENT) === COPILOT_VSCODE_PLUGIN_ALIAS
  );
}

function canonicalTerminalName(raw) {
  let name = sanitizeToken(raw);
  if (!name) return undefined;
  if (TERMINAL_NAME_ALIASES[name]) return TERMINAL_NAME_ALIASES[name];
  name = name.replace(/\.app$/, "");
  if (TERMINAL_NAME_ALIASES[name]) return TERMINAL_NAME_ALIASES[name];
  // Unmapped values (including inherited TERM_PROGRAM=vscode) stay empty.
  return undefined;
}

function fallbackTerminalName(env) {
  if (env.TMUX) return "tmux";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.TERM === "xterm-ghostty") return "ghostty";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.ALACRITTY_LOG) return "alacritty";
  return undefined;
}

function hostTerminalName(env) {
  return canonicalTerminalName(env.TERM_PROGRAM) || fallbackTerminalName(env);
}

/**
 * Env keys `hostClientFromEnv` reads. Tests must strip these so the developer
 * IDE / tmux / TERM_PROGRAM does not leak into assertions.
 * Keep in lockstep with this function and skills `detect_host_client`.
 * `CURSOR_VERSION` is hook-only; skills do not read it.
 */
export const HOST_WINDOW_ENV_KEYS = Object.freeze([
  "ZED_TERM",
  "TERMINAL_EMULATOR",
  "CURSOR_TRACE_ID",
  "CURSOR_VERSION",
  "VSCODE_GIT_ASKPASS_MAIN",
  "VSCODE_GIT_ASKPASS_NODE",
  "WINDSURF_CASCADE_TERMINAL",
  "ANTIGRAVITY_AGENT",
  "TRAE_AI_SHELL_ID",
  "VisualStudioVersion",
  "COPILOT_AGENT",
  "AI_AGENT",
  "AGENT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_IS_COWORK",
  "TERM_PROGRAM",
  "TMUX",
  "WT_SESSION",
  "TERM",
  "KITTY_WINDOW_ID",
  "ALACRITTY_LOG",
]);

/**
 * Host editor window from editor-owned env; undefined when unproven.
 * Same order as skills `detect_host_client` (plus `CURSOR_VERSION`).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function hostClientFromEnv(env = process.env) {
  if (env.ZED_TERM) return "zed";
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return "jetbrains";
  if (env.CURSOR_TRACE_ID || askpassPathContains(env, "cursor"))
    return "cursor";
  // Hook-only: Cursor IDE sets CURSOR_VERSION on sessionStart; CLI uses
  // TRACE_ID / askpass and never treats CURSOR_AGENT as the window.
  if (env.CURSOR_VERSION) return "cursor";
  if (env.WINDSURF_CASCADE_TERMINAL || askpassPathContains(env, "windsurf")) {
    return "windsurf";
  }
  if (env.ANTIGRAVITY_AGENT || askpassPathContains(env, "antigravity")) {
    return "antigravity";
  }
  if (env.TRAE_AI_SHELL_ID || askpassPathContains(env, "trae")) return "trae";
  if (
    askpassPathContains(env, "vscodium") ||
    askpassPathContains(env, "codium")
  ) {
    return "codium";
  }
  if (env.VisualStudioVersion) return "visualstudio";
  if (askpassLooksLikeStockVSCode(env)) return "vscode";
  if (env.COPILOT_AGENT === "1" || isCopilotVSCodePluginAlias(env)) {
    return hostTerminalName(env) || "vscode";
  }
  if (env.CLAUDE_CODE_CHILD_SESSION || env.CLAUDE_CODE_IS_COWORK)
    return "claude";
  return hostTerminalName(env);
}

/**
 * Adapter `ctx.ide` → wire tool/client. Unknown ide omits both (never "unknown").
 * The window comes from host env when proven, so Copilot in IntelliJ is not
 * reported as vscode; the adapter default applies only as a fallback.
 * @param {string | undefined} ide
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ tool?: string, client?: string }}
 */
export function axesFromAdapterIde(ide, env = process.env) {
  if (!ide) return {};
  const tool = IDE_TOOL[ide];
  if (!tool) return {};
  const client = hostClientFromEnv(env) || IDE_CLIENT[ide];
  return { tool, ...(client ? { client } : {}) };
}

/**
 * Direct sessionStart (print-policy / test harness) has no adapter `ctx.ide`.
 * Strong env only — never CLAUDECODE, CLAUDE_PROJECT_DIR, or CURSOR_PROJECT_DIR.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ tool?: string, client?: string }}
 */
export function inferDirectSessionAxes(env = process.env) {
  const client = hostClientFromEnv(env);
  if (env.CURSOR_AGENT || env.CURSOR_VERSION) {
    return { tool: "cursor", ...(client ? { client } : {}) };
  }
  if (env.CLAUDE_CODE_CHILD_SESSION) {
    return { tool: "claude", ...(client ? { client } : {}) };
  }
  if (env.COPILOT_CLI) {
    return { tool: "copilot", ...(client ? { client } : {}) };
  }
  if (env.COPILOT_AGENT === "1") {
    return { tool: "copilot", ...(client ? { client } : {}) };
  }
  if (env.CODEX_HOME || env.CODEX_API_KEY) {
    return { tool: "codex", ...(client ? { client } : {}) };
  }
  return {};
}

/**
 * Adapter stamp when `ctx.ide` is set; otherwise print-policy inference.
 * @param {{ ide?: string }} [ctx]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ tool?: string, client?: string }}
 */
export function axesForSessionStart(ctx = {}, env = process.env) {
  if (ctx.ide) return axesFromAdapterIde(ctx.ide, env);
  return inferDirectSessionAxes(env);
}

/**
 * Axes present on the hook process itself (not invented, not model).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ tool?: string, client?: string }} [opts]
 * @returns {{ tool?: string, client?: string }}
 */
export function resolveHookUaAxes(env = process.env, opts = {}) {
  const tool =
    sanitizeToken(opts.tool) ||
    sanitizeToken(env.JFROG_APR_UA_TOOL) ||
    undefined;
  const client =
    sanitizeToken(opts.client) ||
    sanitizeToken(env.JFROG_APR_UA_CLIENT) ||
    undefined;
  return { tool, client };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ tool?: string, client?: string }} [opts]
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
 * @param {{ tool?: string, client?: string }} [opts]
 * @returns {NodeJS.ProcessEnv}
 */
export function envWithHookUserAgent(env = process.env, opts = {}) {
  return { ...env, JFROG_CLI_USER_AGENT: buildHookJfUserAgent(env, opts) };
}

/** @internal test helper */
export function _resetCliVersionCacheForTests() {
  cachedCliVersion = undefined;
}
