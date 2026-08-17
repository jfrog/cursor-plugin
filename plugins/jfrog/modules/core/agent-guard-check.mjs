#!/usr/bin/env node
// JFrog Agent Guard activation check
//
// Silent gate for session hooks. Determines whether Agent Guard is enabled
// for the current environment.
//
// Contract (key off `code`, not `reason` text):
//   - code 0 -> Agent Guard ENABLED (caller may proceed)
//   - code 2 -> reachable but the platform has the MCP registry DISABLED
//   - code 1 -> DISABLED for any other reason: no credentials, timeout,
//               network/DNS error (caller must silently abort)
//
// Set JF_AGENT_GUARD_DEBUG=true for verbose tracing on stderr.
// Library callers use runAgentGuardCheck(); CLI entry calls process.exit.

import { execFileSync } from "node:child_process";
import process from "node:process";

import { isMainEntry } from "./entry.mjs";

export const SETTINGS_PATH =
  "/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled";
export const REQUEST_TIMEOUT_MS = 5000;

export const EXIT_ENABLED = 0;
export const EXIT_DISABLED = 1;
export const EXIT_REGISTRY_DISABLED = 2;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} newName
 * @param {string} [oldName]
 * @returns {string | undefined}
 */
function envLookup(env, newName, oldName) {
  const raw = env[newName] ?? (oldName ? env[oldName] : undefined);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(message: string) => void} [debug]
 */
function makeDebug(env, debug) {
  if (typeof debug === "function") return debug;
  const enabled = env.JF_AGENT_GUARD_DEBUG === "true";
  return (message) => {
    if (enabled) console.error(`[jfrog-agent-guard] ${message}`);
  };
}

/**
 * Resolve credentials from Path A (environment variables) or Path B
 * (JFrog CLI configuration).
 *
 * Intentionally distinct from `jf-identity.mjs`:
 * - package-resolution identity is always `jf config` and may use Basic auth;
 * - Agent Guard's settings probe needs a Bearer access token, and mirrors the
 *   AG CLI by preferring JFROG_URL/JF_URL + access token when set.
 * - When `serverId` is set: that jf server first, then env, never the default
 *   CLI server. Without `serverId`: env first, then default `jf config export`.
 * Do not reuse getPlatformIdentity() here without preserving that contract.
 *
 * @param {{
 *   serverId?: string,
 *   env?: NodeJS.ProcessEnv,
 *   execFileSyncFn?: typeof execFileSync,
 *   debug?: (message: string) => void,
 * }} [opts]
 * @returns {{ baseUrl: string, token: string, source: string } | null}
 */
export function resolveAgentGuardCredentials(opts = {}) {
  const env = opts.env ?? process.env;
  const debug = makeDebug(env, opts.debug);
  const explicitServerId = opts.serverId?.trim() || undefined;
  const execFn = opts.execFileSyncFn ?? execFileSync;

  if (explicitServerId) {
    const fromCli = resolveFromCliConfig({
      serverId: explicitServerId,
      execFileSyncFn: execFn,
      debug,
    });
    if (fromCli) return fromCli;
    debug(
      "Explicit server ID did not resolve via jf config; falling back to env credentials.",
    );
  }

  const envUrl = envLookup(env, "JFROG_URL", "JF_URL");
  const envToken = envLookup(env, "JFROG_ACCESS_TOKEN", "JF_ACCESS_TOKEN");
  if (envUrl && envToken) {
    debug("Using credentials from environment variables (Path A).");
    return {
      baseUrl: envUrl,
      token: envToken,
      source: "environment variables",
    };
  }
  debug(
    "Environment credentials incomplete; trying JFrog CLI config (Path B).",
  );

  if (explicitServerId) return null;
  return resolveFromCliConfig({
    serverId: undefined,
    execFileSyncFn: execFn,
    debug,
  });
}

/**
 * @param {{
 *   serverId?: string,
 *   execFileSyncFn?: typeof execFileSync,
 *   debug?: (message: string) => void,
 * }} opts
 */
function resolveFromCliConfig(opts) {
  const debug = opts.debug ?? (() => {});
  const execFn = opts.execFileSyncFn ?? execFileSync;
  const exportArgs = opts.serverId
    ? ["config", "export", opts.serverId]
    : ["config", "export"];
  let exported;
  try {
    exported = execFn("jf", exportArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch (error) {
    debug(
      `'jf config export' failed (jf not on PATH or no server configured): ${error?.message}`,
    );
    return null;
  }

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(exported, "base64").toString("utf8"));
  } catch (error) {
    debug(`Could not decode the jf config export token: ${error?.message}`);
    return null;
  }

  const baseUrl = cfg?.url;
  const token = cfg?.accessToken;
  if (!baseUrl) {
    debug("Exported JFrog CLI config has no platform URL.");
    return null;
  }
  if (!token) {
    debug(
      "Exported JFrog CLI config has no access token (bearer auth needed).",
    );
    return null;
  }

  const id = cfg?.serverId ?? "default";
  return {
    baseUrl,
    token,
    source: `JF CLI config (server '${id}')`,
  };
}

/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {{
 *   fetchFn?: typeof fetch,
 *   timeoutMs?: number,
 *   debug?: (message: string) => void,
 * }} [opts]
 */
export async function isGatewayPluginEnabled(baseUrl, token, opts = {}) {
  const debug = opts.debug ?? (() => {});
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const root = baseUrl.replace(/\/+$/, "").replace(/\/artifactory$/, "");
  const url = root + SETTINGS_PATH;
  debug(`Fetching gateway plugin setting from ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      debug(`Settings request returned HTTP ${response.status}.`);
      return {
        ok: false,
        reason: `settings endpoint returned HTTP ${response.status}`,
      };
    }
    const data = await response.json();
    const unwrap = (v) => (v !== null && typeof v === "object" ? v?.value : v);
    const container = data?.settings ?? data;
    const named =
      container?.mcpGatewayPluginEnabled ??
      container?.mcp_gateway_plugin_enabled;
    const value =
      typeof data === "boolean"
        ? data
        : named !== undefined
          ? unwrap(named)
          : unwrap(container);
    debug(`Settings response indicates gateway plugin enabled=${value}.`);
    if (value === true) return { ok: true };
    if (value === false) {
      return {
        ok: false,
        registryOff: true,
        reason: "mcp gateway plugin setting returned false",
      };
    }
    return {
      ok: false,
      reason: "settings endpoint returned an invalid gateway-plugin setting",
    };
  } catch (error) {
    const reason =
      error?.name === "AbortError"
        ? "timeout"
        : (error?.message ?? "unknown error");
    debug(`Settings request failed: ${reason}`);
    return {
      ok: false,
      reason: `settings endpoint unreachable (${reason})`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run the Agent Guard activation check without exiting the process.
 * @param {{
 *   serverId?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fetchFn?: typeof fetch,
 *   execFileSyncFn?: typeof execFileSync,
 *   timeoutMs?: number,
 *   debug?: (message: string) => void,
 * }} [opts]
 * @returns {Promise<{ code: number, reason: string }>}
 */
export async function runAgentGuardCheck(opts = {}) {
  const env = opts.env ?? process.env;
  const debug = makeDebug(env, opts.debug);

  try {
    const forceDisabled =
      envLookup(env, "_JF_AGENT_GUARD_FORCE_DISABLE") === "true";
    const forceEnabled =
      envLookup(env, "JF_AGENT_GUARD_FORCE_ENABLE") === "true";
    if (forceDisabled) {
      return {
        code: EXIT_DISABLED,
        reason: "Disabled: forced via _JF_AGENT_GUARD_FORCE_DISABLE",
      };
    }
    if (forceEnabled) {
      return {
        code: EXIT_ENABLED,
        reason: "Enabled: forced via JF_AGENT_GUARD_FORCE_ENABLE",
      };
    }

    const creds = resolveAgentGuardCredentials({
      serverId: opts.serverId,
      env,
      execFileSyncFn: opts.execFileSyncFn,
      debug,
    });
    if (!creds) {
      return {
        code: EXIT_DISABLED,
        reason:
          "Disabled: JFROG_URL/JF_URL + access token not set and no default JF CLI config found",
      };
    }

    const result = await isGatewayPluginEnabled(creds.baseUrl, creds.token, {
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      debug,
    });
    if (result.ok) {
      return {
        code: EXIT_ENABLED,
        reason: `Enabled: via ${creds.source}`,
      };
    }
    if (result.registryOff) {
      return {
        code: EXIT_REGISTRY_DISABLED,
        reason: `RegistryDisabled: ${result.reason}`,
      };
    }
    return {
      code: EXIT_DISABLED,
      reason: `Disabled: ${result.reason}`,
    };
  } catch (error) {
    debug(`Unexpected error: ${error?.stack ?? error?.message ?? error}`);
    return { code: EXIT_DISABLED, reason: "Disabled: unexpected error" };
  }
}

async function main() {
  const result = await runAgentGuardCheck({
    serverId: process.argv[2],
  });
  process.stdout.write(`${result.reason}\n`);
  process.exit(result.code);
}

if (isMainEntry(import.meta.url)) {
  main().catch((error) => {
    console.error(`[jfrog-agent-guard] Unexpected error: ${error?.message}`);
    process.exit(EXIT_DISABLED);
  });
}
