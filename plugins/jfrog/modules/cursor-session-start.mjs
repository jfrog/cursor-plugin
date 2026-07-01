#!/usr/bin/env node
// Cursor sessionStart hook runner.
//
// Usage: node cursor-session-start.mjs <capability>
// Example: node cursor-session-start.mjs package-resolution
//
// stdout: JSON with additional_context. Empty object ("{}") is a no-op.

import process from "node:process";

import { runCapability } from "./core/run-capability.mjs";
import { ensureAgentsConfigScaffold, agentsConfigLoadWarnings } from "./core/agents-config.mjs";
import { readStdin, parseSessionId, detectHarness, parseWorkspaceRoots } from "./core/io.mjs";
import { setLogContext, createLogger } from "./core/logger.mjs";

const HARNESS_ID = "cursor";
const log = createLogger("session-start");

/** @returns {string | null} JSON stdout payload, or null when there is nothing to inject. */
function formatSessionStartStdout(text) {
  if (!text?.trim()) return null;
  return JSON.stringify({ additional_context: text });
}

function writeStdout(payload) {
  if (payload !== null) process.stdout.write(payload);
}

function writeNoOp() {
  process.stdout.write("{}");
}

async function main() {
  const capability = process.argv[2];
  if (!capability) {
    writeNoOp();
    return;
  }

  const startedAtMs = Date.now();
  const stdinRaw = await readStdin();
  const harness = detectHarness(stdinRaw);
  if (harness && harness !== HARNESS_ID) {
    writeNoOp();
    return;
  }
  const sessionId = parseSessionId(stdinRaw);
  const workspaceRoots = parseWorkspaceRoots(stdinRaw);
  setLogContext({ ide: HARNESS_ID, sessionId });
  ensureAgentsConfigScaffold();
  for (const w of agentsConfigLoadWarnings()) {
    log.warn(w.message, { path: w.path });
  }
  const text = await runCapability(capability, {
    ide: HARNESS_ID,
    sessionId,
    workspaceRoots,
    startedAtMs,
  });
  writeStdout(formatSessionStartStdout(text));
}

main().catch(() => {
  writeNoOp();
  process.exit(0);
});
