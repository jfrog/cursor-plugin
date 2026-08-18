// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  CURSOR_CONFIG_DIR_ENV,
  INCLUDE_CACHE_ENV,
  ROOTS_ENV,
  discoverCursorPluginRoots,
  discoverPluginMcpJsonPaths,
  parseRootsEnv,
  resolveCursorConfigDir,
  resolveMcpJsonForPluginRoot,
  resolvePluginRoot,
  resolveRewriteAllowRoots,
} from "./cursor-mcp-json-discover.mjs";

/**
 * @param {string[]} segments
 * @returns {string}
 */
function tempDir(...segments) {
  const root = mkdtempSync(path.join(tmpdir(), "cursor-discover-"));
  const full = path.join(root, ...segments);
  mkdirSync(full, { recursive: true });
  return full;
}

test("parseRootsEnv splits POSIX and Windows delimiters", () => {
  assert.deepEqual(parseRootsEnv("/a:/b,/c", "linux"), ["/a", "/b", "/c"]);
  assert.deepEqual(parseRootsEnv("C:\\a;D:\\b,E:\\c", "win32"), [
    "C:\\a",
    "D:\\b",
    "E:\\c",
  ]);
  // Bare colon must not split a Windows drive letter.
  assert.deepEqual(parseRootsEnv("C:\\plugins\\local", "win32"), [
    "C:\\plugins\\local",
  ]);
  assert.deepEqual(parseRootsEnv("  ", "linux"), []);
});

test("resolveCursorConfigDir prefers CURSOR_CONFIG_DIR", () => {
  const home = "/home/user";
  assert.equal(
    resolveCursorConfigDir({ home, env: {} }),
    path.join(home, ".cursor"),
  );
  assert.equal(
    resolveCursorConfigDir({
      home,
      env: { [CURSOR_CONFIG_DIR_ENV]: "/custom/cursor" },
    }),
    "/custom/cursor",
  );
});

test("resolvePluginRoot is parent of scripts/", () => {
  const scriptsDir = path.join("/tmp/plugin", "scripts");
  const moduleUrl = pathToFileURL(
    path.join(scriptsDir, "cursor-mcp-json-discover.mjs"),
  ).href;
  assert.equal(resolvePluginRoot(moduleUrl), path.join("/tmp/plugin"));
});

test("resolveMcpJsonForPluginRoot finds mcp.json only", () => {
  const root = tempDir("plugin-a");
  writeFileSync(path.join(root, ".mcp.json"), "{}");
  assert.equal(resolveMcpJsonForPluginRoot(root), undefined);
  writeFileSync(path.join(root, "mcp.json"), "{}");
  assert.equal(resolveMcpJsonForPluginRoot(root), path.join(root, "mcp.json"));
});

test("discoverCursorPluginRoots scans plugins/local", () => {
  const cursorDir = tempDir("cursor-home");
  const localA = path.join(cursorDir, "plugins", "local", "alpha");
  const localB = path.join(cursorDir, "plugins", "local", "beta");
  mkdirSync(localA, { recursive: true });
  mkdirSync(localB, { recursive: true });

  const roots = discoverCursorPluginRoots({
    home: "/unused",
    env: { [CURSOR_CONFIG_DIR_ENV]: cursorDir },
  });
  assert.deepEqual(roots.sort(), [localA, localB].sort());
});

test("discoverCursorPluginRoots honors JF_ALIGN_MCP_JSON_ROOTS override", () => {
  const override = tempDir("override-root");
  const roots = discoverCursorPluginRoots({
    home: "/unused",
    env: { [ROOTS_ENV]: override },
  });
  assert.deepEqual(roots, [override]);
});

test("discoverCursorPluginRoots optionally includes cache tree", () => {
  const cursorDir = tempDir("cursor-cache");
  const versionRoot = path.join(
    cursorDir,
    "plugins",
    "cache",
    "marketplace",
    "plugin-name",
    "1.0.0",
  );
  mkdirSync(versionRoot, { recursive: true });

  const without = discoverCursorPluginRoots({
    home: "/unused",
    env: { [CURSOR_CONFIG_DIR_ENV]: cursorDir },
  });
  assert.deepEqual(without, []);

  const withCache = discoverCursorPluginRoots({
    home: "/unused",
    env: {
      [CURSOR_CONFIG_DIR_ENV]: cursorDir,
      [INCLUDE_CACHE_ENV]: "1",
    },
  });
  assert.deepEqual(withCache, [versionRoot]);
});

test("discoverPluginMcpJsonPaths finds mcp.json only and includes self", () => {
  const cursorDir = tempDir("cursor-discover");
  const pluginA = path.join(cursorDir, "plugins", "local", "a");
  const pluginB = path.join(cursorDir, "plugins", "local", "b");
  mkdirSync(pluginA, { recursive: true });
  mkdirSync(pluginB, { recursive: true });
  writeFileSync(path.join(pluginA, "mcp.json"), "{}");
  writeFileSync(path.join(pluginB, ".mcp.json"), "{}");

  const selfRoot = tempDir("self-plugin");
  writeFileSync(path.join(selfRoot, "mcp.json"), "{}");
  const moduleUrl = pathToFileURL(
    path.join(selfRoot, "scripts", "cursor-mcp-json-discover.mjs"),
  ).href;

  const paths = discoverPluginMcpJsonPaths({
    home: "/unused",
    env: { [CURSOR_CONFIG_DIR_ENV]: cursorDir },
    moduleUrl,
  });

  assert.deepEqual(
    paths.sort(),
    [path.join(pluginA, "mcp.json"), path.join(selfRoot, "mcp.json")].sort(),
  );
});

test("discoverPluginMcpJsonPaths skips self when roots env overrides", () => {
  const override = tempDir("override-only");
  writeFileSync(path.join(override, "mcp.json"), "{}");
  const selfRoot = tempDir("self-skipped");
  writeFileSync(path.join(selfRoot, "mcp.json"), "{}");
  const moduleUrl = pathToFileURL(
    path.join(selfRoot, "scripts", "cursor-mcp-json-discover.mjs"),
  ).href;

  const paths = discoverPluginMcpJsonPaths({
    env: { [ROOTS_ENV]: override },
    moduleUrl,
  });
  assert.deepEqual(paths, [path.join(override, "mcp.json")]);
});


test("discoverCursorPluginRoots drops symlinks that escape CURSOR_CONFIG_DIR", () => {
  const cursorDir = tempDir("cursor-symlink");
  const outside = tempDir("outside-plugin");
  const localDir = path.join(cursorDir, "plugins", "local");
  mkdirSync(localDir, { recursive: true });
  const safe = path.join(localDir, "safe");
  mkdirSync(safe, { recursive: true });
  const evil = path.join(localDir, "evil-link");
  symlinkSync(outside, evil);

  const roots = discoverCursorPluginRoots({
    home: "/unused",
    env: { [CURSOR_CONFIG_DIR_ENV]: cursorDir },
  });
  assert.deepEqual(roots, [safe]);
});

test("discoverCursorPluginRoots override roots are not confined to CURSOR_CONFIG_DIR", () => {
  const override = tempDir("override-outside");
  const roots = discoverCursorPluginRoots({
    home: "/unused",
    env: { [ROOTS_ENV]: override },
  });
  assert.deepEqual(roots, [override]);
});

test("resolveRewriteAllowRoots includes cursor dir, overrides, plugin, targets", () => {
  const cursorDir = "/tmp/cursor-cfg";
  const override = "/tmp/override";
  const selfRoot = "/tmp/self-plugin";
  const moduleUrl = pathToFileURL(
    path.join(selfRoot, "scripts", "cursor-mcp-json-discover.mjs"),
  ).href;
  const target = "/tmp/other-plugin/mcp.json";

  const roots = resolveRewriteAllowRoots({
    env: {
      [CURSOR_CONFIG_DIR_ENV]: cursorDir,
      [ROOTS_ENV]: override,
    },
    moduleUrl,
    targets: [target],
  });
  assert.deepEqual(roots, [
    cursorDir,
    override,
    selfRoot,
    "/tmp/other-plugin",
  ]);
});
