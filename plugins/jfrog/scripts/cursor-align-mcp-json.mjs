#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
//
// Cursor sessionStart adapter: invoke the shared Agent Guard rewrite pipeline
// with Cursor plugin mcp.json discovery.
//
// Usage:
//   node cursor-align-mcp-json.mjs session-start
//   node cursor-align-mcp-json.mjs file-changed   # same work; reserved for a
//                                                # future Cursor FileChanged hook
//
// Path discovery: cursor-mcp-json-discover.mjs
// Orchestration / Step 0 / spawn: modules/core/rewrite-mcp-json.mjs
//
// Kill switch: JF_AGENT_REWRITE_MCP_JSON_DISABLE=1 → no-op (exit 0).
// Never exits non-zero — a failed rewrite must not break the Cursor session.
// When rewrite updates files, this hook emits additional_context asking the
// user to open a new session so Cursor reconnects those MCPs.

import { existsSync, readdirSync, statSync } from "node:fs";
import process from "node:process";

import { isMainEntry } from "../modules/core/entry.mjs";
import { detectHarness, parseSessionId, readStdin } from "../modules/core/io.mjs";
import { createLogger, setLogContext } from "../modules/core/logger.mjs";
import { runRewriteMcpJsonPipeline } from "../modules/core/rewrite-mcp-json.mjs";
import {
  discoverPluginMcpJsonPaths,
  resolveRewriteAllowRoots,
} from "./cursor-mcp-json-discover.mjs";

const HARNESS_ID = "cursor";
const log = createLogger("align-mcp-json");

/** Recommended Cursor hooks.json timeout (seconds) for the align entry. */
export const RECOMMENDED_HOOK_TIMEOUT_SEC = 60;

/** @type {ReadonlySet<string>} */
export const MODES = Object.freeze(new Set(["session-start", "file-changed"]));

export const RECONNECT_HINT =
  "JFrog Agent Guard secured your plugins' MCP servers. Open a new session to reconnect.";

/**
 * @returns {string} Cursor sessionStart stdout JSON payload
 */
export function buildReconnectPayload() {
  return JSON.stringify({ additional_context: RECONNECT_HINT });
}

/**
 * @param {string | undefined} modeArg
 * @returns {boolean}
 */
export function isKnownMode(modeArg) {
  return typeof modeArg === "string" && MODES.has(modeArg);
}

/**
 * Thin harness entry: detect Cursor, discover paths, run shared pipeline.
 * @param {string | undefined} modeArg
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   readStdinFn?: typeof readStdin,
 *   runRewriteMcpJsonPipelineFn?: typeof runRewriteMcpJsonPipeline,
 *   writeStdout?: (s: string) => void,
 *   readdirSyncFn?: typeof readdirSync,
 *   existsSyncFn?: typeof existsSync,
 *   statSyncFn?: typeof statSync,
 *   mcpJsonPath?: string,
 *   timeoutMs?: number,
 *   graceMs?: number,
 *   spawnFn?: unknown,
 *   platform?: NodeJS.Platform,
 *   killFn?: (pid: number, signal?: string) => true,
 *   runAgentGuardCheckFn?: unknown,
 *   readFileSyncFn?: unknown,
 * }} [deps]
 * @returns {Promise<number>} always 0
 */
export async function runCursorAlignMcpJson(modeArg, deps = {}) {
  const env = deps.env ?? process.env;
  const readStdinFn = deps.readStdinFn ?? readStdin;
  const pipelineFn =
    deps.runRewriteMcpJsonPipelineFn ?? runRewriteMcpJsonPipeline;
  const writeStdout = deps.writeStdout ?? ((s) => process.stdout.write(s));

  const stdinRaw = await readStdinFn();
  setLogContext({ ide: HARNESS_ID, sessionId: parseSessionId(stdinRaw) });

  const harness = detectHarness(stdinRaw);
  if (harness && harness !== HARNESS_ID) {
    log.info("invoked by another harness; no-op", { harness });
    return 0;
  }

  if (!isKnownMode(modeArg)) {
    log.warn("unknown mode; no-op", { mode: modeArg ?? "" });
    return 0;
  }

  const existsFn = deps.existsSyncFn ?? existsSync;

  const result = await pipelineFn({
    env,
    discover: () => {
      if (deps.mcpJsonPath) {
        return existsFn(deps.mcpJsonPath) ? [deps.mcpJsonPath] : [];
      }
      return discoverPluginMcpJsonPaths({
        home: deps.home,
        env,
        moduleUrl: import.meta.url,
        readdirSyncFn: deps.readdirSyncFn,
        existsSyncFn: existsFn,
        statSyncFn: deps.statSyncFn,
      });
    },
    allowRoots: (paths) =>
      resolveRewriteAllowRoots({
        home: deps.home,
        env,
        moduleUrl: import.meta.url,
        targets: paths,
      }),
    spawnFn: deps.spawnFn,
    timeoutMs: deps.timeoutMs,
    graceMs: deps.graceMs,
    platform: deps.platform,
    killFn: deps.killFn,
    runAgentGuardCheckFn: deps.runAgentGuardCheckFn,
    readFileSyncFn: deps.readFileSyncFn,
  });

  if ((result?.rewritten ?? 0) > 0) {
    writeStdout(buildReconnectPayload());
  }

  return 0;
}

async function main() {
  await runCursorAlignMcpJson(process.argv[2]);
  process.exit(0);
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    log.error("unexpected failure", { error: err?.message ?? String(err) });
    process.exit(0);
  });
}
