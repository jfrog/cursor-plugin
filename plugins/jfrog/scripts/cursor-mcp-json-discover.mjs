// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
//
// Cursor-specific discovery of plugin mcp.json / .mcp.json paths and
// Agent Guard --allow-root directories. Harness entry lives in
// cursor-align-mcp-json.mjs; shared rewrite orchestration lives in
// modules/core/rewrite-mcp-json.mjs.
//
// Override roots: JF_ALIGN_MCP_JSON_ROOTS=/path/a:/path/b
//   (POSIX: colon/comma; Windows: semicolon/comma — avoids splitting C:\…)
// Cursor config root: CURSOR_CONFIG_DIR (Cursor CLI; default ~/.cursor)
// Include marketplace cache: JF_ALIGN_MCP_JSON_INCLUDE_CACHE=1

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * OS-delimiter- or comma-separated absolute plugin roots; skips default
 * discovery. POSIX uses `:` / `,`; Windows uses `;` / `,` (not `:` — that
 * would split drive letters like `C:\…`).
 */
export const ROOTS_ENV = "JF_ALIGN_MCP_JSON_ROOTS";
/**
 * Cursor CLI config root override. Same as Cursor:
 * `${CURSOR_CONFIG_DIR:-$HOME/.cursor}` — plugins live under
 * `$CURSOR_CONFIG_DIR/plugins/local` (and optionally `…/cache`).
 */
export const CURSOR_CONFIG_DIR_ENV = "CURSOR_CONFIG_DIR";
/** When "1", also scan $CURSOR_CONFIG_DIR/plugins/cache (marketplace installs). */
export const INCLUDE_CACHE_ENV = "JF_ALIGN_MCP_JSON_INCLUDE_CACHE";

/**
 * Plugin root is the parent of `scripts/` (where this file lives).
 * @param {string} [moduleUrl] — import.meta.url of a scripts/*.mjs module
 */
export function resolvePluginRoot(moduleUrl = import.meta.url) {
  const scriptsDir = path.dirname(fileURLToPath(moduleUrl));
  return path.dirname(scriptsDir);
}

/**
 * @param {string} [moduleUrl]
 */
export function resolvePluginMcpJsonPath(moduleUrl = import.meta.url) {
  return path.join(resolvePluginRoot(moduleUrl), "mcp.json");
}

/**
 * @param {string} raw
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function parseRootsEnv(raw, platform = process.platform) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  // Use the *requested* platform delimiter — not path.delimiter from the host
  // OS — so unit tests and cross-compiled callers get correct splitting.
  // Windows: `;` / `,` (never bare `:` — that splits drive letters like `C:\…`).
  // POSIX: `:` / `,`.
  const sep = platform === "win32" ? /[;,]/ : /[:,]/;
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Cursor config root: `${CURSOR_CONFIG_DIR:-$HOME/.cursor}`.
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 * @returns {string}
 */
export function resolveCursorConfigDir(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const fromEnv =
    typeof env[CURSOR_CONFIG_DIR_ENV] === "string"
      ? env[CURSOR_CONFIG_DIR_ENV].trim()
      : "";
  return fromEnv || path.join(home, ".cursor");
}

/**
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   readdirSyncFn?: typeof readdirSync,
 *   existsSyncFn?: typeof existsSync,
 *   statSyncFn?: typeof statSync,
 * }} [opts]
 * @returns {string[]}
 */
export function discoverCursorPluginRoots(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const readdirFn = opts.readdirSyncFn ?? readdirSync;
  const existsFn = opts.existsSyncFn ?? existsSync;
  const statFn = opts.statSyncFn ?? statSync;

  const fromEnv = parseRootsEnv(env[ROOTS_ENV] ?? "");
  if (fromEnv.length > 0) {
    return fromEnv.filter((root) => {
      try {
        return existsFn(root) && statFn(root).isDirectory();
      } catch {
        return false;
      }
    });
  }

  const cursorDir = resolveCursorConfigDir({ home, env });
  /** @type {string[]} */
  const roots = [];
  const localDir = path.join(cursorDir, "plugins", "local");
  roots.push(
    ...listImmediateSubdirs(localDir, { readdirFn, existsFn, statFn }),
  );

  if (env[INCLUDE_CACHE_ENV] === "1") {
    const cacheRoot = path.join(cursorDir, "plugins", "cache");
    for (const marketplace of listImmediateSubdirs(cacheRoot, {
      readdirFn,
      existsFn,
      statFn,
    })) {
      for (const pluginName of listImmediateSubdirs(marketplace, {
        readdirFn,
        existsFn,
        statFn,
      })) {
        roots.push(
          ...listImmediateSubdirs(pluginName, { readdirFn, existsFn, statFn }),
        );
      }
    }
  }

  return roots;
}

/**
 * @param {string} dir
 * @param {{
 *   readdirFn: typeof readdirSync,
 *   existsFn: typeof existsSync,
 *   statFn: typeof statSync,
 * }} fs
 * @returns {string[]}
 */
function listImmediateSubdirs(dir, fs) {
  if (!fs.existsFn(dir)) return [];
  let names;
  try {
    names = fs.readdirFn(dir);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (fs.statFn(full).isDirectory()) out.push(full);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Resolve the MCP config path for a plugin root.
 * Order: mcp.json, then .mcp.json.
 * @param {string} pluginRoot
 * @param {{
 *   existsSyncFn?: typeof existsSync,
 * }} [deps]
 * @returns {string | undefined}
 */
export function resolveMcpJsonForPluginRoot(pluginRoot, deps = {}) {
  const existsFn = deps.existsSyncFn ?? existsSync;

  const mcpJson = path.join(pluginRoot, "mcp.json");
  if (existsFn(mcpJson)) return mcpJson;

  const dotMcpJson = path.join(pluginRoot, ".mcp.json");
  if (existsFn(dotMcpJson)) return dotMcpJson;

  return undefined;
}

/**
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   moduleUrl?: string,
 *   includeSelf?: boolean,
 *   readdirSyncFn?: typeof readdirSync,
 *   existsSyncFn?: typeof existsSync,
 *   statSyncFn?: typeof statSync,
 * }} [opts]
 * @returns {string[]}
 */
export function discoverPluginMcpJsonPaths(opts = {}) {
  const env = opts.env ?? process.env;
  const existsFn = opts.existsSyncFn ?? existsSync;
  const roots = discoverCursorPluginRoots({
    home: opts.home,
    env,
    readdirSyncFn: opts.readdirSyncFn,
    existsSyncFn: existsFn,
    statSyncFn: opts.statSyncFn,
  });

  /** @type {string[]} */
  const paths = [];
  const seen = new Set();

  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    paths.push(p);
  };

  for (const root of roots) {
    add(
      resolveMcpJsonForPluginRoot(root, {
        existsSyncFn: existsFn,
      }),
    );
  }

  const rootsOverridden = parseRootsEnv(env[ROOTS_ENV] ?? "").length > 0;
  if (opts.includeSelf !== false && !rootsOverridden) {
    add(
      resolveMcpJsonForPluginRoot(resolvePluginRoot(opts.moduleUrl), {
        existsSyncFn: existsFn,
      }),
    );
  }

  return paths;
}

/**
 * Allow-roots for Agent Guard: Cursor config dir, override roots, plugin root,
 * and parent dirs of discovered targets.
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   moduleUrl?: string,
 *   targets?: string[],
 * }} [opts]
 * @returns {string[]}
 */
export function resolveRewriteAllowRoots(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  /** @type {string[]} */
  const roots = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    roots.push(p);
  };

  add(resolveCursorConfigDir({ home, env }));
  for (const root of parseRootsEnv(env[ROOTS_ENV] ?? "")) {
    add(root);
  }
  add(resolvePluginRoot(opts.moduleUrl));
  for (const target of opts.targets ?? []) {
    add(path.dirname(target));
  }
  return roots;
}
