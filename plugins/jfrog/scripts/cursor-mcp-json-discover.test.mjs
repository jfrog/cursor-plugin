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
  ROOTS_ENV,
  SKIP_CACHE_ENV,
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

/**
 * Fake $HOME with a `.cursor` tree for discovery tests.
 * @param {string[]} underCursor — path segments under `.cursor`
 * @returns {{ home: string, cursorDir: string, path: string }}
 */
function tempHomeCursor(...underCursor) {
  const home = mkdtempSync(path.join(tmpdir(), "cursor-home-"));
  const cursorDir = path.join(home, ".cursor");
  const full = path.join(cursorDir, ...underCursor);
  mkdirSync(full, { recursive: true });
  return { home, cursorDir, path: full };
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

test("resolveCursorConfigDir is always $HOME/.cursor", () => {
  const home = "/home/user";
  assert.equal(
    resolveCursorConfigDir({ home }),
    path.join(home, ".cursor"),
  );
});

test("discoverCursorPluginRoots ignores CURSOR_CONFIG_DIR", () => {
  const { home, path: localPlugin } = tempHomeCursor(
    "plugins",
    "local",
    "from-home",
  );
  const customCursor = tempDir("custom-cursor");
  mkdirSync(
    path.join(customCursor, "plugins", "local", "from-env"),
    { recursive: true },
  );

  const roots = discoverCursorPluginRoots({
    home,
    env: { CURSOR_CONFIG_DIR: customCursor },
  });
  assert.deepEqual(roots, [localPlugin]);
});

test("resolvePluginRoot is parent of scripts/", () => {
  const scriptsDir = path.join("/tmp/plugin", "scripts");
  const moduleUrl = pathToFileURL(
    path.join(scriptsDir, "cursor-mcp-json-discover.mjs"),
  ).href;
  assert.equal(resolvePluginRoot(moduleUrl), path.join("/tmp/plugin"));
});

test("resolveMcpJsonForPluginRoot finds mcp.json and .mcp.json", () => {
  const root = tempDir("plugin-a");
  writeFileSync(path.join(root, ".mcp.json"), "{}");
  assert.deepEqual(resolveMcpJsonForPluginRoot(root), [
    path.join(root, ".mcp.json"),
  ]);
  writeFileSync(path.join(root, "mcp.json"), "{}");
  assert.deepEqual(resolveMcpJsonForPluginRoot(root), [
    path.join(root, "mcp.json"),
    path.join(root, ".mcp.json"),
  ]);
});

test("discoverCursorPluginRoots scans plugins/local", () => {
  const { home, cursorDir } = tempHomeCursor("plugins", "local");
  const localA = path.join(cursorDir, "plugins", "local", "alpha");
  const localB = path.join(cursorDir, "plugins", "local", "beta");
  mkdirSync(localA, { recursive: true });
  mkdirSync(localB, { recursive: true });

  const roots = discoverCursorPluginRoots({
    home,
    env: {},
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

test("discoverCursorPluginRoots includes cache tree by default", () => {
  const { home, cursorDir } = tempHomeCursor("plugins", "cache");
  const versionRoot = path.join(
    cursorDir,
    "plugins",
    "cache",
    "marketplace",
    "plugin-name",
    "1.0.0",
  );
  mkdirSync(versionRoot, { recursive: true });

  const withCache = discoverCursorPluginRoots({
    home,
    env: {},
  });
  assert.deepEqual(withCache, [versionRoot]);

  const skipped = discoverCursorPluginRoots({
    home,
    env: {
      [SKIP_CACHE_ENV]: "1",
    },
  });
  assert.deepEqual(skipped, []);
});

test("discoverPluginMcpJsonPaths finds mcp.json and .mcp.json and includes self", () => {
  const { home, cursorDir } = tempHomeCursor("plugins", "local");
  const pluginA = path.join(cursorDir, "plugins", "local", "a");
  const pluginB = path.join(cursorDir, "plugins", "local", "b");
  const pluginC = path.join(cursorDir, "plugins", "local", "c");
  mkdirSync(pluginA, { recursive: true });
  mkdirSync(pluginB, { recursive: true });
  mkdirSync(pluginC, { recursive: true });
  writeFileSync(path.join(pluginA, "mcp.json"), "{}");
  writeFileSync(path.join(pluginB, ".mcp.json"), "{}");
  writeFileSync(path.join(pluginC, "mcp.json"), "{}");
  writeFileSync(path.join(pluginC, ".mcp.json"), "{}");

  const selfRoot = tempDir("self-plugin");
  writeFileSync(path.join(selfRoot, "mcp.json"), "{}");
  writeFileSync(path.join(selfRoot, ".mcp.json"), "{}");
  const moduleUrl = pathToFileURL(
    path.join(selfRoot, "scripts", "cursor-mcp-json-discover.mjs"),
  ).href;

  const paths = discoverPluginMcpJsonPaths({
    home,
    env: {},
    moduleUrl,
  });

  assert.deepEqual(
    paths.sort(),
    [
      path.join(pluginA, "mcp.json"),
      path.join(pluginB, ".mcp.json"),
      path.join(pluginC, "mcp.json"),
      path.join(pluginC, ".mcp.json"),
      path.join(selfRoot, "mcp.json"),
      path.join(selfRoot, ".mcp.json"),
    ].sort(),
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

test("resolveMcpJsonForPluginRoot drops mcp.json symlink outside plugin root", () => {
  const root = tempDir("plugin-symlink");
  const outside = tempDir("outside-mcp");
  const target = path.join(outside, "mcp.json");
  writeFileSync(target, "{}");
  symlinkSync(target, path.join(root, "mcp.json"));
  writeFileSync(path.join(root, ".mcp.json"), "{}");
  assert.deepEqual(resolveMcpJsonForPluginRoot(root), [
    path.join(root, ".mcp.json"),
  ]);
});

test("discoverCursorPluginRoots drops symlinks that escape ~/.cursor", () => {
  const { home, cursorDir } = tempHomeCursor("plugins", "local");
  const outside = tempDir("outside-plugin");
  const localDir = path.join(cursorDir, "plugins", "local");
  const safe = path.join(localDir, "safe");
  mkdirSync(safe, { recursive: true });
  const evil = path.join(localDir, "evil-link");
  symlinkSync(outside, evil);

  const roots = discoverCursorPluginRoots({
    home,
    env: {},
  });
  assert.deepEqual(roots, [safe]);
});

test("discoverCursorPluginRoots override roots are not confined to ~/.cursor", () => {
  const override = tempDir("override-outside");
  const roots = discoverCursorPluginRoots({
    home: "/unused",
    env: { [ROOTS_ENV]: override },
  });
  assert.deepEqual(roots, [override]);
});

test("resolveRewriteAllowRoots includes ~/.cursor, overrides, plugin, targets", () => {
  const home = "/tmp/fake-home";
  const cursorDir = path.join(home, ".cursor");
  const override = "/tmp/override";
  const selfRoot = "/tmp/self-plugin";
  const moduleUrl = pathToFileURL(
    path.join(selfRoot, "scripts", "cursor-mcp-json-discover.mjs"),
  ).href;
  const target = "/tmp/other-plugin/mcp.json";

  const roots = resolveRewriteAllowRoots({
    home,
    env: {
      CURSOR_CONFIG_DIR: "/tmp/ignored-cursor-cfg",
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
