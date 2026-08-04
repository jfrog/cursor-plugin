// Detect when zero-touch `jf setup` would silently repoint an existing
// user-level package-manager config at a different Artifactory (or public
// registry). Fail-safe: skip that package manager and surface it in the
// session note — never overwrite without an explicit product "ask/overwrite"
// path (not implemented here).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { createLogger } from "../../core/logger.mjs";

const log = createLogger("setup-conflict");

/**
 * @param {string} [home]
 * @returns {string}
 */
function resolveHome(home) {
  if (home) return home;
  // Match agents-config: Node `homedir()` (USERPROFILE on Windows). Preferring
  // process.env.HOME on win32 breaks under MSYS/Git Bash path shapes.
  if (process.platform === "win32") return homedir();
  return process.env.HOME || homedir();
}

/**
 * Strip matching single/double quotes wrapping an npmrc value.
 * @param {string} raw
 * @returns {string}
 */
export function stripWrappedQuotes(raw) {
  const s = String(raw ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Host (lowercase, no port) from a URL or registry string, or "".
 * @param {string} raw
 * @returns {string}
 */
export function registryHost(raw) {
  if (!raw) return "";
  let s = stripWrappedQuotes(raw);
  if (!s) return "";
  try {
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
      s = `https://${s}`;
    }
    return new URL(s).hostname.toLowerCase();
  } catch {
    return s
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

/**
 * Parse registry URLs from an npmrc body. Returns the default `registry=`
 * value(s) when present; only falls back to `@scope:registry=` values when no
 * default is set (a foreign scoped registry is not a `jf setup` conflict).
 * @param {string} body
 * @returns {string[]} registry URL values
 */
export function parseNpmrcRegistries(body) {
  /** @type {string[]} */
  const def = [];
  /** @type {string[]} */
  const scoped = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const m = trimmed.match(/^(@[^\s:]+:)?registry\s*=\s*(.+)$/i);
    if (m) (m[1] ? scoped : def).push(stripWrappedQuotes(m[2]));
  }
  // `jf setup` only repoints the DEFAULT registry, so a foreign default is a
  // real conflict but a foreign `@scope:registry=` is not (setup won't touch
  // it). Prefer the default; fall back to scoped only when no default is set.
  return def.length ? def : scoped;
}

/**
 * Parse pip `index-url` / `extra-index-url` values from a pip.conf body.
 * Mirrors paths used by jfrog-cli-artifactory setup (PIP_CONFIG_FILE or
 * ~/.config/pip/pip.conf / %APPDATA%/pip/pip.ini).
 * @param {string} body
 * @returns {string[]}
 */
export function parsePipIndexUrls(body) {
  const out = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[")) continue;
    const m = trimmed.match(/^(?:extra-)?index-url\s*=\s*(.+)$/i);
    if (m) out.push(stripWrappedQuotes(m[1]));
  }
  return out;
}

/**
 * Candidate pip config file paths (first existing wins).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function pipConfigFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  if (process.env.PIP_CONFIG_FILE) out.push(process.env.PIP_CONFIG_FILE);
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(h, "AppData", "Roaming");
    out.push(path.join(appData, "pip", "pip.ini"));
  }
  if (process.platform === "darwin") {
    // pip reads the macOS per-user path ahead of the XDG fallback.
    out.push(
      path.join(h, "Library", "Application Support", "pip", "pip.conf"),
    );
  }
  out.push(path.join(h, ".config", "pip", "pip.conf"));
  out.push(path.join(h, ".pip", "pip.conf"));
  return out;
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
function readPipIndexes(home) {
  const h = resolveHome(home);
  for (const file of pipConfigFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      return parsePipIndexUrls(readFileSync(file, "utf8"));
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Parse GOPROXY list from a go env file body (`key = value` lines).
 * @param {string} body
 * @returns {string[]}
 */
export function parseGoProxyList(body) {
  for (const line of String(body || "").split(/\r?\n/)) {
    const m = line.trim().match(/^GOPROXY\s*=\s*(.+)$/i);
    if (!m) continue;
    return m[1]
      .split(",")
      .map((s) => stripWrappedQuotes(s.trim()))
      .filter(
        (s) => s && s.toLowerCase() !== "direct" && s.toLowerCase() !== "off",
      );
  }
  return [];
}

/**
 * @param {string} targetUrl Artifactory base or package-type URL
 * @param {string[]} existingRegistries
 * @returns {{ conflict: boolean, existing?: string, targetHost?: string, existingHost?: string }}
 */
export function conflictAgainstTarget(targetUrl, existingRegistries) {
  const targetHost = registryHost(targetUrl);
  if (!targetHost) return { conflict: false };
  for (const existing of existingRegistries) {
    const existingHost = registryHost(existing);
    if (!existingHost) continue;
    if (existingHost !== targetHost) {
      return { conflict: true, existing, targetHost, existingHost };
    }
  }
  return { conflict: false, targetHost };
}

/**
 * Prefer explicit registry URL lines; fall back to scoped-auth hosts only when
 * no `registry=` / YAML registry is set (auth-only configs still conflict).
 * Avoids leftover public `_authToken` lines false-conflicting when the live
 * registry already points at Artifactory.
 * @param {string[]} registryUrls
 * @param {string[]} authHosts
 * @returns {string[]}
 */
function preferRegistryUrls(registryUrls, authHosts) {
  return registryUrls.length ? registryUrls : authHosts;
}

/**
 * Candidate npmrc paths (first existing wins). Honor NPM_CONFIG_USERCONFIG
 * the same way pip honors PIP_CONFIG_FILE — live isolation redirects there.
 * pnpm does NOT read this file for its own config (see
 * {@link pnpmConfigFileCandidates}) — this is npm only.
 * @param {string} h home directory
 * @returns {string[]}
 */
export function npmrcFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  if (process.env.NPM_CONFIG_USERCONFIG) {
    out.push(process.env.NPM_CONFIG_USERCONFIG);
  }
  out.push(path.join(h, ".npmrc"));
  return out;
}

/**
 * Read npm user config registries (NPM_CONFIG_USERCONFIG or $HOME/.npmrc).
 * Includes `registry=` lines and scoped-auth hosts (`//host/:_authToken=`) so
 * auth-only npmrc (default registry = public npm) still conflicts.
 * @param {string} [home]
 * @returns {string[]}
 */
function readNpmRegistries(home) {
  for (const file of npmrcFileCandidates(resolveHome(home))) {
    if (!existsSync(file)) continue;
    try {
      const body = readFileSync(file, "utf8");
      return preferRegistryUrls(
        parseNpmrcRegistries(body),
        parseAuthIniHosts(body),
      );
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Extract registry hosts from npmrc-style scoped-auth lines
 * (`//hostname[:port]/path:_authToken=…`, `:_auth=…`, `:_password=…`). pnpm's
 * `auth.ini` stores credentials this way without a `registry=` line, so a
 * conflict can only be detected from the host in the auth key.
 * @param {string} body
 * @returns {string[]} hostnames (with port, if present — registryHost strips it)
 */
export function parseAuthIniHosts(body) {
  const out = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const m = trimmed.match(/^\/\/([^/\s]+)\/\S*:_(?:authToken|auth|password)\b/i);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Extract registry URLs from a pnpm `config.yaml` body (`registry: https://…`
 * or quoted). Nested `registries:` maps are out of scope.
 * @param {string} body
 * @returns {string[]}
 */
export function parsePnpmConfigYamlRegistries(body) {
  const out = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^registry\s*:\s*(.+)$/i);
    if (m) out.push(stripWrappedQuotes(m[1]));
  }
  return out;
}

/**
 * pnpm global config directories, in the order pnpm itself resolves them
 * (first that exists is authoritative for pnpm; here we scan every one since
 * auth vs. registry settings can be split across sibling files).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function pnpmConfigDirCandidates(h) {
  /** @type {string[]} */
  const out = [];
  if (process.env.XDG_CONFIG_HOME) {
    out.push(path.join(process.env.XDG_CONFIG_HOME, "pnpm"));
  }
  out.push(path.join(h, ".config", "pnpm"));
  if (process.platform === "darwin") {
    out.push(path.join(h, "Library", "Preferences", "pnpm"));
  }
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(h, "AppData", "Local");
    out.push(path.join(localAppData, "pnpm"));
  }
  return out;
}

/** File names pnpm may keep global config/auth in, under a config dir. */
const PNPM_CONFIG_FILE_NAMES = ["auth.ini", "rc", "config.yaml", ".npmrc"];

/**
 * Candidate pnpm config file paths — every `{dir}/{name}` combination across
 * {@link pnpmConfigDirCandidates} × {@link PNPM_CONFIG_FILE_NAMES}. Unlike
 * {@link npmrcFileCandidates}, pnpm does NOT honor `NPM_CONFIG_USERCONFIG`
 * for its own writes/reads — that env var is npm-only.
 * @param {string} h home directory
 * @returns {string[]}
 */
export function pnpmConfigFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  for (const dir of pnpmConfigDirCandidates(h)) {
    for (const name of PNPM_CONFIG_FILE_NAMES) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

/**
 * Read pnpm registries from every existing pnpm config file (auth.ini / rc /
 * config.yaml / .npmrc under the pnpm config dir). Registries come from
 * `registry=` lines (config/rc files) and scoped-auth hostnames (auth.ini).
 * @param {string} [home]
 * @returns {string[]}
 */
function readPnpmRegistries(home) {
  const h = resolveHome(home);
  /** @type {string[]} */
  const registryUrls = [];
  /** @type {string[]} */
  const authHosts = [];
  for (const file of pnpmConfigFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      const body = readFileSync(file, "utf8");
      registryUrls.push(...parseNpmrcRegistries(body));
      authHosts.push(...parseAuthIniHosts(body));
      if (file.endsWith(`${path.sep}config.yaml`) || file.endsWith("config.yaml")) {
        registryUrls.push(...parsePnpmConfigYamlRegistries(body));
      }
    } catch {
      // try next file
    }
  }
  return preferRegistryUrls(registryUrls, authHosts);
}

/**
 * Parse index / extra-index URLs from a uv.toml (or uv config) body.
 * @param {string} body
 * @returns {string[]}
 */
export function parseUvIndexUrls(body) {
  const out = [];
  // Bare `url = …` only counts as a registry inside an [[index]] / [[tool.uv.index]]
  // table — elsewhere it could be an unrelated key. `index-url` / `extra-index-url`
  // are top-level and always count.
  let inIndexTable = false;
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inIndexTable = /^\[\[(?:tool\.uv\.)?index\]\]/i.test(trimmed);
      continue;
    }
    const flat = trimmed.match(/^(?:extra-)?index-url\s*=\s*(.+)$/i);
    if (flat) {
      const raw = stripWrappedQuotes(flat[1]);
      if (raw) out.push(raw);
      continue;
    }
    if (inIndexTable) {
      const urlLine = trimmed.match(/^url\s*=\s*(.+)$/i);
      if (urlLine) {
        const raw = stripWrappedQuotes(urlLine[1]);
        if (raw) out.push(raw);
      }
    }
  }
  return out;
}

/**
 * Candidate uv config paths (first existing wins).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function uvConfigFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  if (process.env.UV_CONFIG_FILE) out.push(process.env.UV_CONFIG_FILE);
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(h, "AppData", "Roaming");
    out.push(path.join(appData, "uv", "uv.toml"));
  }
  out.push(path.join(h, ".config", "uv", "uv.toml"));
  return out;
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
function readUvIndexes(home) {
  const h = resolveHome(home);
  for (const file of uvConfigFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      return parseUvIndexUrls(readFileSync(file, "utf8"));
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Candidate GOENV file paths for this platform (first existing wins).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function goEnvFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  if (process.env.GOENV) out.push(process.env.GOENV);
  if (process.platform === "darwin") {
    out.push(path.join(h, "Library", "Application Support", "go", "env"));
  } else if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(h, "AppData", "Roaming");
    out.push(path.join(appData, "go", "env"));
  }
  // Linux XDG + common fallback on all platforms
  out.push(path.join(h, ".config", "go", "env"));
  return out;
}

/**
 * Read GOPROXY from platform GOENV locations.
 * @param {string} [home]
 * @returns {string[]}
 */
function readGoProxies(home) {
  const h = resolveHome(home);
  for (const file of goEnvFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      return parseGoProxyList(readFileSync(file, "utf8"));
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Whether running `jf setup <packageManager>` for `targetUrl` would repoint
 * an existing user-level registry away from another host.
 *
 * Covered today: npm (`NPM_CONFIG_USERCONFIG` / `$HOME/.npmrc`), pnpm
 * (own `auth.ini`/`rc`/`config.yaml` under the pnpm config dir **plus**
 * npm's userconfig — some `jf setup pnpm` builds still write via
 * `NPM_CONFIG_USERCONFIG`, so a foreign `.npmrc` must block pnpm too),
 * pip/pipenv (`PIP_CONFIG_FILE` / platform pip.conf), uv
 * (`UV_CONFIG_FILE` / uv.toml), go (platform GOENV paths).
 * Other package managers → no conflict detected (setup proceeds).
 *
 * @param {string} packageManager
 * @param {string} targetUrl platform or package URL whose host is the target
 * @param {{ home?: string }} [opts]
 * @returns {{ conflict: boolean, existing?: string, targetHost?: string, existingHost?: string }}
 */
export function detectSetupConflict(packageManager, targetUrl, opts = {}) {
  const pm = String(packageManager || "").toLowerCase();
  let existing = [];
  if (pm === "npm") {
    existing = readNpmRegistries(opts.home);
  } else if (pm === "pnpm") {
    // Union: native pnpm config + npm userconfig. Native-only misses
    // CLI builds that still configure pnpm by rewriting NPM_CONFIG_USERCONFIG.
    existing = [
      ...readPnpmRegistries(opts.home),
      ...readNpmRegistries(opts.home),
    ];
  } else if (pm === "pip" || pm === "pipenv") {
    existing = readPipIndexes(opts.home);
  } else if (pm === "uv") {
    existing = readUvIndexes(opts.home);
  } else if (pm === "go") {
    existing = readGoProxies(opts.home);
  } else {
    return { conflict: false };
  }

  if (!existing.length) return { conflict: false };

  const result = conflictAgainstTarget(targetUrl, existing);
  if (result.conflict) {
    log.info("eager setup conflict: existing registry points elsewhere", {
      packageManager: pm,
      existingHost: result.existingHost,
      targetHost: result.targetHost,
    });
  }
  return result;
}
