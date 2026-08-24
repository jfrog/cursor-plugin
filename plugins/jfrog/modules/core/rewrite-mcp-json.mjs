// Shared Agent Guard `--rewrite-mcp-json` runner for harness adapters.
//
// Harness plugins own path discovery; this module owns:
//   resolve server/project → discover → skip-if-current → Step 0 gate →
//   spawn/timeout, soft-fail orchestration with structured outcomes.
// Server id is resolved once for both the gate and AG --server (always passed).
//
// Usage (from a thin Cursor/Claude script next to synced modules/):
//   import { runRewriteMcpJsonPipeline } from "./modules/core/rewrite-mcp-json.mjs";
//   const result = await runRewriteMcpJsonPipeline({
//     discover: () => [...absoluteMcpJsonPaths],
//     allowRoots: [...],
//   });
//   // result: { exitCode, outcome, reason } — exitCode is 0 unless STRICT=1
//
// Kill switch: JF_AGENT_REWRITE_MCP_JSON_DISABLE=1 → soft no-op (exit 0).
// Force refresh: JF_AGENT_REWRITE_MCP_JSON_FORCE=1 → ignore skip marker.
// Strict: JF_AGENT_REWRITE_MCP_JSON_STRICT=1 → failed_* outcomes exit 1.
// Local binary: JFROG_AGENT_GUARD_BIN=/path/to/agent-guard (skips npx).
// Version pin: JFROG_AGENT_GUARD_VERSION (default DEFAULT_AGENT_GUARD_VERSION).

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { EXIT_ENABLED, runAgentGuardCheck } from "./agent-guard-check.mjs";
import { createLogger } from "./logger.mjs";

const log = createLogger("rewrite-mcp-json");

export const AGENT_GUARD_PACKAGE = "@jfrog/agent-guard";
export const DISABLE_ENV = "JF_AGENT_REWRITE_MCP_JSON_DISABLE";
export const FORCE_ENV = "JF_AGENT_REWRITE_MCP_JSON_FORCE";
export const STRICT_ENV = "JF_AGENT_REWRITE_MCP_JSON_STRICT";
export const AGENT_GUARD_BIN_ENV = "JFROG_AGENT_GUARD_BIN";
/**
 * Default npm registry for `npx @jfrog/agent-guard` during mcp.json rewrite.
 *
 * Exception to the usual "no runtime hard-dep on releases.jfrog.io" bundling
 * rule: package-resolution hooks are fully vendored, but Agent Guard's MCP
 * rewrite intentionally fetches `@jfrog/agent-guard` at session start via
 * npx from the public `coding-agents-npm` channel (override with
 * JFROG_AGENT_GUARD_REPO / JFROG_AGENT_GUARD_BIN). See .cursor/rules/bundling.mdc.
 */
export const DEFAULT_AGENT_GUARD_NPM_REGISTRY =
  "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";
/**
 * Pinned so a session start cannot execute whatever the registry currently
 * tags as latest. Bump deliberately; JFROG_AGENT_GUARD_VERSION overrides
 * (including "latest"). First release validated with `--rewrite-mcp-json`.
 */
export const DEFAULT_AGENT_GUARD_VERSION = "1.6.0";
/**
 * Shared budget for rewriting all discovered files in one hook invocation.
 * Kept under the harness hook timeout (Cursor sessionStart is 60s); do not
 * raise this to match the hook timeout.
 */
export const DEFAULT_REWRITE_TIMEOUT_MS = 35_000;
/** SIGTERM → SIGKILL escalation window for a child that ignores the first signal. */
export const DEFAULT_KILL_GRACE_MS = 2_000;

/** Newest setup.json "version" this code understands (best-effort on mismatch). */
export const SUPPORTED_SETUP_FILE_VERSION = 1;

export const OUTCOME = Object.freeze({
  DISABLED: "disabled",
  SKIPPED_CURRENT: "skipped_current",
  SKIPPED_NO_PATHS: "skipped_no_paths",
  SKIPPED_NO_PROJECT: "skipped_no_project",
  SKIPPED_NO_SERVER: "skipped_no_server",
  SKIPPED_UNSAFE_PROJECT: "skipped_unsafe_project",
  SKIPPED_UNSAFE_SERVER: "skipped_unsafe_server",
  SKIPPED_GATE: "skipped_gate",
  FAILED_DISCOVER: "failed_discover",
  FAILED_GATE: "failed_gate",
  FAILED_ALLOW_ROOTS: "failed_allow_roots",
  FAILED_SPAWN: "failed_spawn",
  REWRITTEN: "rewritten",
});

/**
 * @param {string} outcome
 * @param {string} [reason]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ exitCode: number, outcome: string, reason: string }}
 */
export function pipelineResult(outcome, reason = "", env = process.env) {
  const failed = String(outcome).startsWith("failed_");
  const exitCode = failed && env[STRICT_ENV] === "1" ? 1 : 0;
  return { exitCode, outcome, reason };
}

export function isRewriteDisabled(env = process.env) {
  return env[DISABLE_ENV] === "1";
}

export function isRewriteForced(env = process.env) {
  return env[FORCE_ENV] === "1";
}

/**
 * True when JFROG_URL/JF_URL + access token are set.
 * Used by the gate (Path A); plugin rewrite always passes `--server` separately.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function hasJfrogUrlTokenEnv(env = process.env) {
  const url = env.JFROG_URL?.trim() || env.JF_URL?.trim();
  const token = env.JFROG_ACCESS_TOKEN?.trim() || env.JF_ACCESS_TOKEN?.trim();
  return Boolean(url && token);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} [url]
 * @returns {string}
 */
export function normalizeJpdUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveJfrogHomeDir(env = process.env) {
  const fromEnv = env.JFROG_CLI_HOME_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(homedir(), ".jfrog");
}

/**
 * Default skip-if-current marker under the jf CLI home.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultRewriteMarkerPath(env = process.env) {
  return path.join(
    resolveJfrogHomeDir(env),
    "agent-hooks",
    "rewrite-mcp-json.marker",
  );
}

/**
 * Mirror of Agent Guard `ActiveProjectFromSetupFile`: read
 * `{JFROG_CLI_HOME}/setup.json` → servers[id].currentActiveProject.
 * Never throws; returns "" when missing/unreadable/no match.
 *
 * @param {string} serverId
 * @param {string} [jpdUrl]
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   readFileSyncFn?: typeof readFileSync,
 *   setupPath?: string,
 * }} [opts]
 * @returns {string}
 */
export function activeProjectFromSetupFile(serverId, jpdUrl = "", opts = {}) {
  const env = opts.env ?? process.env;
  const readFn = opts.readFileSyncFn ?? readFileSync;
  const setupPath =
    opts.setupPath ?? path.join(resolveJfrogHomeDir(env), "setup.json");
  const wantUrl = normalizeJpdUrl(jpdUrl);
  const id = String(serverId ?? "").trim();

  let raw;
  try {
    raw = readFn(setupPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      log.debug("setup file: not found", { path: setupPath });
    }
    return "";
  }

  /** @type {{ version?: number, servers?: Record<string, { jpdUrl?: string, currentActiveProject?: string }> }} */
  let sf = {};
  try {
    sf = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!isPlainObject(sf) || !isPlainObject(sf.servers)) return "";
  if (
    typeof sf.version === "number" &&
    sf.version !== SUPPORTED_SETUP_FILE_VERSION
  ) {
    // Best-effort parse (matches AG).
  }

  const servers = sf.servers;
  if (id) {
    const entry = servers[id];
    const project = entry?.currentActiveProject?.trim?.() || "";
    if (project) {
      const entryUrl = normalizeJpdUrl(entry.jpdUrl);
      if (wantUrl === "" || entryUrl === wantUrl) return project;
    }
  }

  if (wantUrl) {
    const ids = Object.keys(servers).sort();
    for (const sid of ids) {
      const entry = servers[sid];
      const project = entry?.currentActiveProject?.trim?.() || "";
      if (project && normalizeJpdUrl(entry.jpdUrl) === wantUrl) return project;
    }
  }
  return "";
}

/**
 * Parse `jf config show --format=json` into a server list.
 * @param {string} stdout
 * @returns {{ serverId: string, jpdUrl: string, isDefault: boolean }[]}
 */
export function parseJfConfigShowJson(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.servers)
      ? parsed.servers
      : parsed
        ? [parsed]
        : [];
  /** @type {{ serverId: string, jpdUrl: string, isDefault: boolean }[]} */
  const out = [];
  for (const s of list) {
    if (!isPlainObject(s)) continue;
    const serverId = String(s.serverId ?? "").trim();
    if (!serverId) continue;
    const jpdUrl = normalizeJpdUrl(
      s.url || s.Url || s.artifactoryUrl || s.platformUrl || "",
    );
    out.push({
      serverId,
      jpdUrl,
      isDefault: Boolean(s.isDefault),
    });
  }
  return out;
}

/**
 * Exactly one server, or the isDefault entry. Otherwise { error }.
 * @param {{ serverId: string, jpdUrl: string, isDefault: boolean }[]} servers
 * @returns {{ serverId: string, jpdUrl: string } | { error: "missing" | "no_default" }}
 */
export function pickDefaultJfCliServer(servers) {
  const list = servers ?? [];
  if (list.length === 0) return { error: "missing" };
  if (list.length === 1) {
    return { serverId: list[0].serverId, jpdUrl: list[0].jpdUrl };
  }
  const def = list.find((s) => s.isDefault);
  if (def) return { serverId: def.serverId, jpdUrl: def.jpdUrl };
  return { error: "no_default" };
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   spawnSyncFn?: typeof spawnSync,
 * }} [opts]
 * @returns {{ serverId: string, jpdUrl: string }[]}
 */
export function listJfCliServers(opts = {}) {
  const env = opts.env ?? process.env;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  let res;
  try {
    res = spawnSyncFn("jf", ["config", "show", "--format=json"], {
      encoding: "utf8",
      timeout: 5_000,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return [];
  }
  if (res?.error || res.status !== 0) return [];
  return parseJfConfigShowJson(res.stdout ?? "");
}

/**
 * Resolve server for gate + rewrite. Always expects a concrete server id
 * for plugin MCP (Shay): hint → jf config (one / isDefault) → env.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{
 *   serverIdHint?: string,
 *   spawnSyncFn?: typeof spawnSync,
 * }} [opts]
 * @returns {{
 *   serverId: string,
 *   jpdUrl: string,
 * } | {
 *   error: "missing" | "no_default",
 * }}
 */
export function resolveRewriteServer(env = process.env, opts = {}) {
  const servers = listJfCliServers({
    env,
    spawnSyncFn: opts.spawnSyncFn,
  });

  const hint = opts.serverIdHint?.trim();
  if (hint) {
    const match = servers.find((s) => s.serverId === hint);
    return {
      serverId: hint,
      jpdUrl: match?.jpdUrl ?? "",
    };
  }

  const picked = pickDefaultJfCliServer(servers);
  if (!("error" in picked)) return picked;

  const fromEnv = env.JF_SERVER?.trim() || env.JFROG_SERVER_ID?.trim() || "";
  if (fromEnv) {
    const match = servers.find((s) => s.serverId === fromEnv);
    return { serverId: fromEnv, jpdUrl: match?.jpdUrl ?? "" };
  }
  return picked.error === "no_default"
    ? { error: "no_default" }
    : { error: "missing" };
}

/**
 * Resolve JFrog project key: env → setup.json (AG-compatible) → "".
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{
 *   serverId?: string,
 *   jpdUrl?: string,
 *   readFileSyncFn?: typeof readFileSync,
 *   setupPath?: string,
 * }} [opts]
 * @returns {string}
 */
export function resolveRewriteProject(env = process.env, opts = {}) {
  const fromEnv = env.JF_PROJECT?.trim() || env.JFROG_PROJECT?.trim() || "";
  if (fromEnv) return fromEnv;
  return activeProjectFromSetupFile(opts.serverId ?? "", opts.jpdUrl ?? "", {
    env,
    readFileSyncFn: opts.readFileSyncFn,
    setupPath: opts.setupPath,
  });
}

/**
 * @deprecated Use resolveRewriteServer. Kept for callers that only need the id.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ serverIdHint?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {string}
 */
export function resolveRewriteServerId(env = process.env, opts = {}) {
  const resolved = resolveRewriteServer(env, opts);
  if ("error" in resolved) return "";
  return resolved.serverId;
}

/**
 * @param {NodeJS.Platform} [platform]
 */
export function resolveNpxCommand(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} [platform]
 * @param {{ local?: boolean }} [opts]
 */
export function buildNpxSpawnOptions(
  env,
  platform = process.platform,
  opts = {},
) {
  const isWin = platform === "win32";
  const useShell = isWin && !opts.local;
  return {
    stdio: /** @type {const} */ (["pipe", "pipe", "pipe"]),
    env,
    // Pin cmd.exe — shell: true would honor ComSpec (e.g. PowerShell).
    shell: useShell ? "cmd.exe" : false,
    detached: !isWin,
  };
}

/**
 * Safe grammar for JF project keys / server IDs passed on a Windows cmd.exe
 * command line (and as a general injection guard on all platforms).
 * @param {string} value
 * @returns {boolean}
 */
export function isSafeRewriteIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value ?? ""));
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {string}
 * @throws {Error} when value is not a safe identifier
 */
export function assertSafeRewriteIdentifier(value, label = "identifier") {
  const trimmed = String(value ?? "").trim();
  if (!isSafeRewriteIdentifier(trimmed)) {
    throw new Error(
      `rewrite-mcp-json ${label} must be a safe identifier (A-Za-z0-9._-): ${JSON.stringify(trimmed)}`,
    );
  }
  return trimmed;
}

/**
 * Quote a single argv token for Node spawn under shell: "cmd.exe".
 * Uses cmd.exe rules: wrap in ", double embedded quotes, escape % as %%.
 * CRT-style backslash-escaping is NOT safe under cmd.exe (a quote can break
 * out and leave metacharacters like & executable).
 * @param {string} arg
 * @returns {string}
 * @throws {Error} when the arg contains CR/LF
 */
export function quoteWindowsArg(arg) {
  const value = String(arg ?? "");
  if (/[\r\n]/.test(value)) {
    throw new Error("Windows spawn arg must not contain CR/LF");
  }
  // Neutralize %VAR% expansion, then double any embedded quotes for cmd.exe.
  const escaped = value.replace(/%/g, "%%").replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * @param {string[]} args
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function quoteSpawnArgs(args, platform = process.platform) {
  return platform === "win32" ? args.map(quoteWindowsArg) : args;
}

/**
 * @param {{ pid?: number, kill?: (signal?: string) => boolean }} child
 * @param {{
 *   platform?: NodeJS.Platform,
 *   killFn?: (pid: number, signal?: string) => true,
 *   spawnFn?: typeof spawn,
 *   graceMs?: number,
 *   isAlive?: () => boolean,
 *   waitForExit?: Promise<unknown>,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function killRewriteChildTree(child, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const killFn = opts.killFn ?? process.kill;
  const spawnFn = opts.spawnFn ?? spawn;
  const graceMs = opts.graceMs ?? DEFAULT_KILL_GRACE_MS;
  const isAlive = opts.isAlive ?? (() => true);

  const signalChild = (signal) => {
    try {
      child?.kill?.(signal);
    } catch {
      // Already gone.
    }
  };

  const signalTree = (signal) => {
    if (platform === "win32") {
      if (child?.pid) {
        try {
          const killer = spawnFn(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { stdio: "ignore" },
          );
          killer?.on?.("error", () => {});
          return;
        } catch {
          // fall through
        }
      }
      signalChild(signal);
      return;
    }

    if (child?.pid) {
      try {
        killFn(-child.pid, signal);
        return;
      } catch {
        // Fall through to child.kill when the group is already gone.
      }
    }
    signalChild(signal);
  };

  signalTree("SIGTERM");

  if (graceMs <= 0 || !isAlive()) return;
  await waitForExitOrTimeout(opts.waitForExit, graceMs);
  if (!isAlive()) return;

  log.warn("rewrite child ignored SIGTERM; escalating to SIGKILL", {
    graceMs,
  });
  signalTree("SIGKILL");

  // Wait for confirmed exit so callers do not process.exit while AG is
  // mid-write (truncated mcp.json). Cap at the same grace window.
  if (graceMs <= 0 || !isAlive()) return;
  await waitForExitOrTimeout(opts.waitForExit, graceMs);
}

/**
 * @param {Promise<unknown> | undefined} exited
 * @param {number} graceMs
 */
function waitForExitOrTimeout(exited, graceMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, graceMs);
    exited?.then(
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveAgentGuardNpmRegistry(env = process.env) {
  const fromEnv = env.JFROG_AGENT_GUARD_REPO?.trim();
  return fromEnv || DEFAULT_AGENT_GUARD_NPM_REGISTRY;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveAgentGuardSpec(env = process.env) {
  const version =
    env.JFROG_AGENT_GUARD_VERSION?.trim() || DEFAULT_AGENT_GUARD_VERSION;
  return `${AGENT_GUARD_PACKAGE}@${version}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function resolveAgentGuardBin(env = process.env) {
  return env[AGENT_GUARD_BIN_ENV]?.trim() || undefined;
}

/**
 * @param {{
 *   paths: string[],
 *   project: string,
 *   serverId: string,
 *   agSpec: string,
 *   statSyncFn?: typeof statSync,
 * }} opts
 * @returns {string}
 */
export function computeRewriteFingerprint(opts) {
  const statFn = opts.statSyncFn ?? statSync;
  const pathParts = [...(opts.paths ?? [])].sort().map((p) => {
    try {
      const st = statFn(p);
      return `${p}:${st.mtimeMs}:${st.size}`;
    } catch {
      return `${p}:missing`;
    }
  });
  const payload = JSON.stringify({
    paths: pathParts,
    project: opts.project,
    serverId: opts.serverId,
    agSpec: opts.agSpec,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * @param {string} markerPath
 * @param {{ readFileSyncFn?: typeof readFileSync }} [opts]
 * @returns {string}
 */
export function readRewriteMarker(markerPath, opts = {}) {
  const readFn = opts.readFileSyncFn ?? readFileSync;
  try {
    return String(readFn(markerPath, "utf8")).trim();
  } catch {
    return "";
  }
}

/**
 * @param {string} markerPath
 * @param {string} fingerprint
 * @param {{ writeFileSyncFn?: typeof writeFileSync, mkdirSyncFn?: typeof mkdirSync }} [opts]
 */
export function writeRewriteMarker(markerPath, fingerprint, opts = {}) {
  const writeFn = opts.writeFileSyncFn ?? writeFileSync;
  const mkdirFn = opts.mkdirSyncFn ?? mkdirSync;
  mkdirFn(path.dirname(markerPath), { recursive: true });
  writeFn(markerPath, `${fingerprint}\n`, "utf8");
}

/**
 * @param {{
 *   paths: string[],
 *   project?: string,
 *   serverId?: string,
 *   allowRoots?: string[],
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 * @returns {string[]}
 * @throws {Error} when project/server missing or paths are empty
 */
export function buildAgentGuardRewriteArgs(opts) {
  const env = opts.env ?? process.env;
  const paths = opts.paths ?? [];
  if (paths.length === 0) {
    throw new Error("rewrite-mcp-json requires at least one mcp.json path");
  }
  const project = opts.project?.trim() || resolveRewriteProject(env, {});
  if (!project) {
    throw new Error("rewrite-mcp-json requires --project (or JF_PROJECT)");
  }
  assertSafeRewriteIdentifier(project, "project");

  const args = ["--rewrite-mcp-json", ...paths, "--project", project];

  const server =
    opts.serverId !== undefined
      ? opts.serverId.trim()
      : resolveRewriteServerId(env);
  if (!server) {
    throw new Error("rewrite-mcp-json requires --server (or JF_SERVER)");
  }
  assertSafeRewriteIdentifier(server, "server");
  args.push("--server", server);

  const agentGuardRegistry = env.JFROG_AGENT_GUARD_REPO?.trim();
  if (agentGuardRegistry) {
    args.push("--registry", agentGuardRegistry);
  }

  for (const root of opts.allowRoots ?? []) {
    if (root) args.push("--allow-root", root);
  }

  args.push("--format", "json");
  return args;
}

/**
 * @param {{
 *   paths: string[],
 *   project?: string,
 *   serverId?: string,
 *   allowRoots?: string[],
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 * @returns {string[]}
 */
export function buildNpxArgs(opts) {
  const env = opts.env ?? process.env;
  return [
    "--yes",
    "--registry",
    resolveAgentGuardNpmRegistry(env),
    resolveAgentGuardSpec(env),
    ...buildAgentGuardRewriteArgs(opts),
  ];
}

/**
 * @param {{
 *   paths: string[],
 *   project?: string,
 *   serverId?: string,
 *   allowRoots?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 * }} opts
 * @returns {{ command: string, args: string[], local: boolean }}
 */
export function resolveAgentGuardCommand(opts) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const bin = resolveAgentGuardBin(env);
  if (bin) {
    return {
      command: bin,
      args: buildAgentGuardRewriteArgs(opts),
      local: true,
    };
  }
  return {
    command: resolveNpxCommand(platform),
    args: buildNpxArgs(opts),
    local: false,
  };
}

/**
 * Spawn Agent Guard `--rewrite-mcp-json`. AG writes files; stdout is JSON
 * summary when `--format json` is passed.
 * @param {{
 *   paths: string[],
 *   project?: string,
 *   serverId?: string,
 *   allowRoots?: string[],
 *   spawnFn?: typeof spawn,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   graceMs?: number,
 *   platform?: NodeJS.Platform,
 *   killFn?: (pid: number, signal?: string) => true,
 * }} opts
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runAgentGuardRewriteMcpJson(opts) {
  const spawnFn = opts.spawnFn ?? spawn;
  const env = opts.env ?? process.env;
  const timeoutMs =
    opts.timeoutMs === undefined ? DEFAULT_REWRITE_TIMEOUT_MS : opts.timeoutMs;
  const platform = opts.platform ?? process.platform;

  let command;
  let args;
  let spawnOpts;
  try {
    const resolved = resolveAgentGuardCommand({
      paths: opts.paths,
      project: opts.project,
      serverId: opts.serverId,
      allowRoots: opts.allowRoots,
      env,
      platform,
    });
    command = resolved.command;
    spawnOpts = buildNpxSpawnOptions(env, platform, { local: resolved.local });
    args = spawnOpts.shell
      ? quoteSpawnArgs(resolved.args, platform)
      : resolved.args;
  } catch (err) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: err?.message ?? String(err),
    });
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exited = false;
    let timedOut = false;
    let markExited = () => {};
    const exitedPromise = new Promise((r) => {
      markExited = r;
    });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawnFn(command, args, spawnOpts);
    } catch (err) {
      finish({
        code: 1,
        stdout: "",
        stderr: err?.message ?? String(err),
      });
      return;
    }

    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      exited = true;
      markExited();
      finish({
        code: 1,
        stdout,
        stderr: err?.message ?? String(err),
      });
    });
    child.on("close", (code) => {
      exited = true;
      markExited();
      if (timedOut) return;
      finish({ code: code ?? 1, stdout, stderr });
    });

    child.stdin?.on?.("error", () => {});
    try {
      child.stdin?.end();
    } catch {
      // Child may already have exited.
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        const finishTimedOut = () => {
          finish({
            code: 1,
            stdout,
            stderr: `${stderr ? `${stderr.trim()}\n` : ""}rewrite timed out after ${timeoutMs}ms`,
          });
        };
        killRewriteChildTree(child, {
          platform,
          killFn: opts.killFn,
          spawnFn,
          graceMs: opts.graceMs,
          isAlive: () => !exited,
          waitForExit: exitedPromise,
        }).then(finishTimedOut, finishTimedOut);
      }, timeoutMs);
    }
  });
}

/**
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function tryParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Parse AG `--format json` summary. Tolerates leading npx noise by trying the
 * last non-empty line, then the last `{...}` slice.
 * @param {string} raw
 * @returns {{ scanned?: number, rewritten?: number, files?: string[], errors?: string[], dryRun?: boolean } | null}
 */
export function parseRewriteMcpJsonResult(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  const direct = tryParseJsonObject(trimmed);
  if (direct) return direct;

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParseJsonObject(lines[i]);
    if (parsed) return parsed;
  }

  const start = trimmed.lastIndexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParseJsonObject(trimmed.slice(start, end + 1));
  }
  return null;
}

/**
 * Strip userinfo from URLs before logging.
 * @param {string} text
 * @returns {string}
 */
export function redactUrlCredentials(text) {
  return String(text ?? "").replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi,
    "$1***@",
  );
}

/**
 * Orchestration: kill switch → server/project → discover → skip-if-current →
 * Step 0 gate → rewrite. Server id is resolved once and reused for both the
 * gate and AG `--server` (always passed). Returns a structured result; exitCode
 * is 0 unless JF_AGENT_REWRITE_MCP_JSON_STRICT=1 and outcome is failed_*.
 *
 * @param {{
 *   discover: () => string[] | Promise<string[]>,
 *   allowRoots?: string[] | ((paths: string[]) => string[]),
 *   env?: NodeJS.ProcessEnv,
 *   spawnFn?: typeof spawn,
 *   spawnSyncFn?: typeof spawnSync,
 *   timeoutMs?: number,
 *   graceMs?: number,
 *   platform?: NodeJS.Platform,
 *   killFn?: (pid: number, signal?: string) => true,
 *   runAgentGuardCheckFn?: typeof runAgentGuardCheck,
 *   readFileSyncFn?: typeof readFileSync,
 *   writeFileSyncFn?: typeof writeFileSync,
 *   mkdirSyncFn?: typeof mkdirSync,
 *   statSyncFn?: typeof statSync,
 *   serverIdHint?: string,
 *   markerPath?: string,
 *   setupPath?: string,
 * }} opts
 * @returns {Promise<{ exitCode: number, outcome: string, reason: string }>}
 */
export async function runRewriteMcpJsonPipeline(opts) {
  const env = opts.env ?? process.env;
  const checkFn = opts.runAgentGuardCheckFn ?? runAgentGuardCheck;

  if (isRewriteDisabled(env)) {
    log.info("rewrite disabled via env", { env: DISABLE_ENV });
    return pipelineResult(OUTCOME.DISABLED, DISABLE_ENV, env);
  }

  const serverResolved = resolveRewriteServer(env, {
    serverIdHint: opts.serverIdHint,
    spawnSyncFn: opts.spawnSyncFn,
  });
  if ("error" in serverResolved) {
    const reason =
      serverResolved.error === "no_default"
        ? "multiple jf config servers and none isDefault"
        : "no jf config server / JF_SERVER";
    log.info("rewrite skipped; missing server", { reason });
    return pipelineResult(OUTCOME.SKIPPED_NO_SERVER, reason, env);
  }
  const { serverId, jpdUrl } = serverResolved;
  if (!isSafeRewriteIdentifier(serverId)) {
    log.info("rewrite skipped; unsafe server id", {});
    return pipelineResult(
      OUTCOME.SKIPPED_UNSAFE_SERVER,
      "unsafe server id",
      env,
    );
  }

  const project = resolveRewriteProject(env, {
    serverId,
    jpdUrl,
    readFileSyncFn: opts.readFileSyncFn,
    setupPath: opts.setupPath,
  });
  if (!project) {
    log.info("rewrite skipped; missing project", {});
    return pipelineResult(
      OUTCOME.SKIPPED_NO_PROJECT,
      "missing JF_PROJECT / setup.json currentActiveProject",
      env,
    );
  }
  if (!isSafeRewriteIdentifier(project)) {
    log.info("rewrite skipped; unsafe JF_PROJECT", {});
    return pipelineResult(
      OUTCOME.SKIPPED_UNSAFE_PROJECT,
      "unsafe project",
      env,
    );
  }

  let paths;
  try {
    paths = await opts.discover();
  } catch (err) {
    const reason = err?.message ?? String(err);
    log.error("discover failed; soft no-op", { error: reason });
    return pipelineResult(OUTCOME.FAILED_DISCOVER, reason, env);
  }

  if (!Array.isArray(paths) || paths.length === 0) {
    log.info("no mcp.json files found; skip rewrite");
    return pipelineResult(OUTCOME.SKIPPED_NO_PATHS, "no mcp.json", env);
  }

  const agSpec = resolveAgentGuardSpec(env);
  const fingerprint = computeRewriteFingerprint({
    paths,
    project,
    serverId,
    agSpec,
    statSyncFn: opts.statSyncFn,
  });
  const markerPath = opts.markerPath ?? defaultRewriteMarkerPath(env);
  if (
    !isRewriteForced(env) &&
    readRewriteMarker(markerPath, { readFileSyncFn: opts.readFileSyncFn }) ===
      fingerprint
  ) {
    log.info("rewrite skipped; already current", { markerPath });
    return pipelineResult(OUTCOME.SKIPPED_CURRENT, markerPath, env);
  }

  let gate;
  try {
    gate = await checkFn({
      serverId,
      env,
    });
  } catch (err) {
    const reason = redactUrlCredentials(err?.message ?? String(err));
    log.error("agent-guard check threw; soft no-op", { error: reason });
    return pipelineResult(OUTCOME.FAILED_GATE, reason, env);
  }
  if (gate.code !== EXIT_ENABLED) {
    const reason = redactUrlCredentials(gate.reason ?? "");
    log.info("agent-guard check blocked rewrite; soft no-op", {
      code: gate.code,
      reason,
    });
    return pipelineResult(OUTCOME.SKIPPED_GATE, reason, env);
  }

  let allowRoots;
  try {
    allowRoots =
      typeof opts.allowRoots === "function"
        ? opts.allowRoots(paths)
        : (opts.allowRoots ?? []);
  } catch (err) {
    const reason = redactUrlCredentials(err?.message ?? String(err));
    log.error("allowRoots failed; soft no-op", { error: reason });
    return pipelineResult(OUTCOME.FAILED_ALLOW_ROOTS, reason, env);
  }

  log.info("rewrite-mcp-json targets", {
    count: paths.length,
    allowRoots: allowRoots.length,
    outcome: "rewrite",
  });

  const budgetMs =
    opts.timeoutMs === undefined ? DEFAULT_REWRITE_TIMEOUT_MS : opts.timeoutMs;
  const startedAtMs = Date.now();
  const result = await runAgentGuardRewriteMcpJson({
    paths,
    project,
    serverId,
    allowRoots,
    env,
    spawnFn: opts.spawnFn,
    timeoutMs: budgetMs,
    graceMs: opts.graceMs,
    platform: opts.platform,
    killFn: opts.killFn,
  });
  const durMs = Date.now() - startedAtMs;

  if (result.code !== 0) {
    const reason = redactUrlCredentials((result.stderr || "").trim()).slice(
      0,
      500,
    );
    log.error("rewrite-mcp-json failed", {
      code: result.code,
      stderr: reason,
      durMs,
      outcome: OUTCOME.FAILED_SPAWN,
    });
    return pipelineResult(OUTCOME.FAILED_SPAWN, reason, env);
  }

  const postFingerprint = computeRewriteFingerprint({
    paths,
    project,
    serverId,
    agSpec,
    statSyncFn: opts.statSyncFn,
  });
  try {
    writeRewriteMarker(markerPath, postFingerprint, {
      writeFileSyncFn: opts.writeFileSyncFn,
      mkdirSyncFn: opts.mkdirSyncFn,
    });
  } catch (err) {
    log.warn("rewrite marker write failed", {
      markerPath,
      error: err?.message ?? String(err),
    });
  }

  const summary = parseRewriteMcpJsonResult(result.stdout);
  if (summary) {
    log.info("rewrite-mcp-json ok", {
      scanned: summary.scanned,
      rewritten: summary.rewritten,
      errors: summary.errors?.length ?? 0,
      durMs,
      outcome: OUTCOME.REWRITTEN,
    });
  } else {
    log.info("rewrite-mcp-json ok; no JSON summary", {
      durMs,
      outcome: OUTCOME.REWRITTEN,
    });
  }

  return pipelineResult(OUTCOME.REWRITTEN, "", env);
}
