// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ROOTS_ENV } from "./cursor-mcp-json-discover.mjs";
import {
  RECONNECT_HINT,
  buildReconnectPayload,
  isKnownMode,
  RECOMMENDED_HOOK_TIMEOUT_SEC,
  runCursorAlignMcpJson,
} from "./cursor-align-mcp-json.mjs";
import {
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_REWRITE_TIMEOUT_MS,
} from "../modules/core/rewrite-mcp-json.mjs";

/**
 * @param {string[]} segments
 * @returns {string}
 */
function tempDir(...segments) {
  const root = mkdtempSync(path.join(tmpdir(), "cursor-align-"));
  const full = path.join(root, ...segments);
  mkdirSync(full, { recursive: true });
  return full;
}

test("hooks.json align timeout matches RECOMMENDED_HOOK_TIMEOUT_SEC with rewrite headroom", () => {
  const hooksPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "hooks",
    "hooks.json",
  );
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  const alignHook = hooks.hooks?.sessionStart?.find((h) =>
    String(h.command ?? "").includes("cursor-align-mcp-json"),
  );
  assert.ok(alignHook, "sessionStart align hook missing from hooks.json");
  assert.equal(alignHook.timeout, RECOMMENDED_HOOK_TIMEOUT_SEC);

  // Gate (~7s) + rewrite spawn + SIGKILL grace must fit under the hook timeout.
  const reservedOverheadMs = 7_000;
  assert.ok(
    DEFAULT_REWRITE_TIMEOUT_MS + DEFAULT_KILL_GRACE_MS + reservedOverheadMs <
      RECOMMENDED_HOOK_TIMEOUT_SEC * 1000,
    "rewrite budget + grace + gate overhead must leave margin under hooks.json timeout",
  );
});

test("isKnownMode accepts session-start and file-changed", () => {
  assert.equal(isKnownMode("session-start"), true);
  assert.equal(isKnownMode("file-changed"), true);
  assert.equal(isKnownMode("other"), false);
  assert.equal(isKnownMode(undefined), false);
});

test("buildReconnectPayload uses additional_context with approved wording", () => {
  const payload = JSON.parse(buildReconnectPayload());
  assert.equal(payload.additional_context, RECONNECT_HINT);
  assert.match(
    payload.additional_context,
    /JFrog Agent Guard secured your plugins' MCP servers/,
  );
  assert.match(payload.additional_context, /Open a new session to reconnect/);
  assert.equal(payload.hookSpecificOutput, undefined);
});

test("runCursorAlignMcpJson no-ops on unknown mode", async () => {
  let called = false;
  let stdout = "";
  const code = await runCursorAlignMcpJson("nope", {
    readStdinFn: async () => "",
    runRewriteMcpJsonPipelineFn: async () => {
      called = true;
      return { exitCode: 0, outcome: "skipped_current", reason: "" };
    },
    writeStdout: (s) => {
      stdout += s;
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.equal(stdout, "");
});

test("runCursorAlignMcpJson no-ops when harness is not cursor", async () => {
  let called = false;
  let stdout = "";
  const code = await runCursorAlignMcpJson("session-start", {
    readStdinFn: async () =>
      JSON.stringify({
        session_id: "s1",
        hook_event_name: "SessionStart",
        source: "startup",
      }),
    runRewriteMcpJsonPipelineFn: async () => {
      called = true;
      return { exitCode: 0, outcome: "skipped_current", reason: "" };
    },
    writeStdout: (s) => {
      stdout += s;
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.equal(stdout, "");
});

test("runCursorAlignMcpJson passes discovered paths to shared pipeline", async () => {
  const home = tempDir("home-pipeline");
  const cursorDir = path.join(home, ".cursor");
  const pluginA = path.join(cursorDir, "plugins", "local", "a");
  mkdirSync(pluginA, { recursive: true });
  const mcpPath = path.join(pluginA, "mcp.json");
  writeFileSync(mcpPath, "{}");

  /** @type {{ paths?: string[], allowRoots?: string[] }} */
  const captured = {};
  let stdout = "";
  const code = await runCursorAlignMcpJson("session-start", {
    home,
    env: {
      // Avoid scanning the real hosting plugin tree in this unit test.
      [ROOTS_ENV]: pluginA,
    },
    readStdinFn: async () =>
      JSON.stringify({ session_id: "s1", cursor_version: "1.0.0" }),
    runRewriteMcpJsonPipelineFn: async (opts) => {
      const paths = await opts.discover();
      captured.paths = paths;
      captured.allowRoots =
        typeof opts.allowRoots === "function"
          ? opts.allowRoots(paths)
          : opts.allowRoots;
      return { exitCode: 0, outcome: "skipped_current", reason: "" };
    },
    writeStdout: (s) => {
      stdout += s;
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(captured.paths, [mcpPath]);
  assert.ok(captured.allowRoots?.includes(cursorDir));
  assert.ok(captured.allowRoots?.includes(pluginA));
  assert.equal(stdout, "");
});

test("runCursorAlignMcpJson respects mcpJsonPath override", async () => {
  const file = path.join(tempDir("single"), "mcp.json");
  writeFileSync(file, "{}");

  /** @type {string[] | undefined} */
  let paths;
  const code = await runCursorAlignMcpJson("session-start", {
    mcpJsonPath: file,
    readStdinFn: async () => "",
    runRewriteMcpJsonPipelineFn: async (opts) => {
      paths = await opts.discover();
      return { exitCode: 0, outcome: "skipped_current", reason: "" };
    },
    writeStdout: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(paths, [file]);
});

test("runCursorAlignMcpJson emits reconnect hint when outcome is rewritten", async () => {
  let stdout = "";
  const code = await runCursorAlignMcpJson("session-start", {
    readStdinFn: async () =>
      JSON.stringify({ session_id: "s1", cursor_version: "1.0.0" }),
    runRewriteMcpJsonPipelineFn: async () => ({
      exitCode: 0,
      outcome: "rewritten",
      reason: "",
    }),
    writeStdout: (s) => {
      stdout += s;
    },
  });
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.additional_context, RECONNECT_HINT);
  assert.match(
    payload.additional_context,
    /JFrog Agent Guard secured your plugins' MCP servers/,
  );
  assert.match(payload.additional_context, /Open a new session to reconnect/);
  assert.doesNotMatch(payload.additional_context, /\/reload-plugins/);
});

test("runCursorAlignMcpJson does not emit when outcome is not rewritten", async () => {
  let stdout = "";
  const code = await runCursorAlignMcpJson("session-start", {
    readStdinFn: async () =>
      JSON.stringify({ session_id: "s1", cursor_version: "1.0.0" }),
    runRewriteMcpJsonPipelineFn: async () => ({
      exitCode: 0,
      outcome: "skipped_current",
      reason: "",
    }),
    writeStdout: (s) => {
      stdout += s;
    },
  });
  assert.equal(code, 0);
  assert.equal(stdout, "");
});
