#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { spawnSync } from "node:child_process";

const DEFAULT_REGISTRY =
  "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";

function debug(msg) {
  if (process.env.JF_MCP_GATEWAY_DEBUG === "true") {
    process.stderr.write(`[jfrog-mcp-gateway] ${msg}\n`);
  }
}

function shouldInject() {
  const force = process.env.JF_MCP_GATEWAY_FORCE_ENABLE;
  if (force === "true") {
    debug("JF_MCP_GATEWAY_FORCE_ENABLE=true -> injecting (skip entitlement)");
    return true;
  }
  if (force === "false") {
    debug("JF_MCP_GATEWAY_FORCE_ENABLE=false -> skipping (skip entitlement)");
    return false;
  }

  const registry = process.env.JFROG_MCP_GATEWAY_REPO || DEFAULT_REGISTRY;

  debug(`spawning gateway --should-inject (registry=${registry})`);
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "--registry",
      registry,
      "@jfrog/mcp-gateway",
      "--should-inject",
    ],
    {
      encoding: "utf8",
      timeout: 25_000,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) {
    debug(`spawn error: ${result.error.message} -> skipping (fail-closed)`);
    return false;
  }
  if (result.status === 0) {
    debug("gateway: entitled -> injecting");
    return true;
  }
  debug(
    `gateway exit ${result.status} (3 = not entitled, other = error) -> skipping (fail-closed)`,
  );
  return false;
}

function emitEmpty() {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

if (!shouldInject()) {
  emitEmpty();
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rulePath = path.resolve(scriptDir, "..", "rules", "jfrog-mcp-management.mdc");

let template = "";
try {
  const raw = readFileSync(rulePath, "utf8");
  template = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
} catch (err) {
  debug(`failed to read template: ${err.message} -> skipping`);
  emitEmpty();
}

const notice =
  "JFrog MCP Gateway: when adding, removing, or listing MCP servers, " +
  "follow the rules below. Do not invent your own approach; do not " +
  "call the JFrog catalog API directly; do not run the MCP package " +
  "or the gateway from the terminal yourself.\n\n";

process.stdout.write(
  JSON.stringify({
    additional_context: notice + template,
  }),
);
