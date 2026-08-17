// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CURSOR_CONFIG_DIR_ENV,
  ROOTS_ENV,
} from "./cursor-mcp-json-discover.mjs";
import {
  isKnownMode,
  runCursorAlignMcpJson,
} from "./cursor-align-mcp-json.mjs";

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

test("isKnownMode accepts session-start and file-changed", () => {
  assert.equal(isKnownMode("session-start"), true);
  assert.equal(isKnownMode("file-changed"), true);
  assert.equal(isKnownMode("other"), false);
  assert.equal(isKnownMode(undefined), false);
});

test("runCursorAlignMcpJson no-ops on unknown mode", async () => {
  let called = false;
  const code = await runCursorAlignMcpJson("nope", {
    readStdinFn: async () => "",
    runRewriteMcpJsonPipelineFn: async () => {
      called = true;
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
});

test("runCursorAlignMcpJson no-ops when harness is not cursor", async () => {
  let called = false;
  const code = await runCursorAlignMcpJson("session-start", {
    readStdinFn: async () =>
      JSON.stringify({
        session_id: "s1",
        hook_event_name: "SessionStart",
        source: "startup",
      }),
    runRewriteMcpJsonPipelineFn: async () => {
      called = true;
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
});

test("runCursorAlignMcpJson passes discovered paths to shared pipeline", async () => {
  const cursorDir = tempDir("cursor-pipeline");
  const pluginA = path.join(cursorDir, "plugins", "local", "a");
  mkdirSync(pluginA, { recursive: true });
  const mcpPath = path.join(pluginA, "mcp.json");
  writeFileSync(mcpPath, "{}");

  /** @type {{ paths?: string[], allowRoots?: string[] }} */
  const captured = {};
  const code = await runCursorAlignMcpJson("session-start", {
    env: {
      [CURSOR_CONFIG_DIR_ENV]: cursorDir,
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
      return 0;
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(captured.paths, [mcpPath]);
  assert.ok(captured.allowRoots?.includes(cursorDir));
  assert.ok(captured.allowRoots?.includes(pluginA));
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
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(paths, [file]);
});
