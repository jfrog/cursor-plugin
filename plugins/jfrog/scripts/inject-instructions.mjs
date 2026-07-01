#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Logs go to stderr; stdout is reserved for the hook JSON payload.
const debugEnabled = process.env.JF_AGENT_GUARD_DEBUG === "true";
const log = (message) => console.error(`[jfrog-agent-guard] ${message}`);
const debug = (message) => {
  if (debugEnabled) log(message);
};

// New JFROG_* env vars take precedence over the legacy JF_* names.
const env = (newName, oldName) =>
    process.env[newName] ?? process.env[oldName];

const forceDisabled =
    env("_JF_AGENT_GUARD_FORCE_DISABLE") === "true";
const forceEnabled =
    env("JF_AGENT_GUARD_FORCE_ENABLE") === "true";

// Resolve {baseUrl, token} from env vars, falling back to the JFrog CLI's
// default server. Returns null when nothing resolves.
function resolveCredentials() {
  const baseUrl = env("JFROG_URL", "JF_URL");
  const token = env("JFROG_ACCESS_TOKEN", "JF_ACCESS_TOKEN");
  if (baseUrl && token) {
    debug("Resolved credentials from environment variables");
    return { baseUrl, token };
  }

  // `jf config export` emits the default server as a base64-encoded JSON token.
  let configToken;
  try {
    configToken = execFileSync("jf", ["config", "export"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch (error) {
    debug(`'jf config export' failed (jf not on PATH or no server configured): ${error.message}`);
    return null;
  }

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(configToken, "base64").toString("utf8"));
  } catch (error) {
    debug(`Could not decode the jf Config Token: ${error.message}`);
    return null;
  }

  if (!cfg?.url || !cfg?.accessToken) {
    debug("jf Config Token did not contain a usable url + accessToken");
    return null;
  }

  debug(`Resolved credentials via 'jf config export' (serverId: ${cfg.serverId ?? "<unknown>"})`);
  return { baseUrl: cfg.url, token: cfg.accessToken };
}

async function isAgentGuardEnabledViaSettings() {
  const credentials = resolveCredentials();
  if (!credentials) {
    debug("No JFrog credentials resolved; skipping settings check");
    return false;
  }
  const { baseUrl, token } = credentials;

  const url =
      baseUrl.replace(/\/+$/, "") +
      "/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled";

  debug(`Fetching agent guard setting from ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      debug(`Settings request returned HTTP ${response.status}; body: ${body || "<empty>"}`);
      return false;
    }
    const data = await response.json();
    const enabled = data?.settings?.mcpGatewayPluginEnabled?.value === true;
    debug(`Settings response indicates agent guard enabled=${enabled}`);
    return enabled;
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : error?.message ?? "unknown error";
    debug(`Settings request failed: ${reason}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

if (forceDisabled) {
  debug("Force-disable flag is set.");
  process.stdout.write("{}");
  process.exit(0);
} else if (forceEnabled) {
  debug("Force-enable flag is set.");
} else if (!(await isAgentGuardEnabledViaSettings())) {
  debug("Agent Guard not enabled; exiting without injecting instructions");
  process.stdout.write("{}");
  process.exit(0);
}
debug("Injecting instructions");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let template;
try {
  template = readFileSync(
    path.join(root, "templates", "jfrog-mcp-management.md"),
    "utf8",
  );
} catch (error) {
  debug(`Could not read instructions template: ${error.message}`);
  process.stdout.write("{}");
  process.exit(0);
}

// The IDE consumes hookSpecificOutput.additionalContext from a SessionStart hook.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: template,
    },
  }),
);
