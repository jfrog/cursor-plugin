// Detect when zero-touch `jf setup` would silently repoint an existing
// user-level package-manager config at a different Artifactory (or public
// registry). Fail-safe: skip that package manager and surface it in the
// session note — never auto-overwrite; the note tells the agent to ask the
// user, then run explicit `jf setup` only after they confirm.
//
// Ownership: this is an APR/hooks-layer guard. Do NOT "fix" silent-repoint
// by changing jfrog-cli-artifactory / jfrog-cli-core `jf setup` writers —
// those commands intentionally overwrite when the user (or skill) asks.
// autoSetup is the unattended path that must refuse foreign hosts here.

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
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
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
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
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
    const appData = process.env.APPDATA || path.join(h, "AppData", "Roaming");
    out.push(path.join(appData, "pip", "pip.ini"));
  }
  if (process.platform === "darwin") {
    // pip reads the macOS per-user path ahead of the XDG fallback.
    out.push(path.join(h, "Library", "Application Support", "pip", "pip.conf"));
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
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
    const m = trimmed.match(
      /^\/\/([^/\s]+)\/\S*:_(?:authToken|auth|password)\b/i,
    );
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
      if (
        file.endsWith(`${path.sep}config.yaml`) ||
        file.endsWith("config.yaml")
      ) {
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
    const appData = process.env.APPDATA || path.join(h, "AppData", "Roaming");
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
    const appData = process.env.APPDATA || path.join(h, "AppData", "Roaming");
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
 * ID used by `jf setup maven` for the Artifactory mirror in settings.xml
 * (jfrog-cli-core `maven.ArtifactoryMirrorID`). Setup repoints this mirror
 * in place — it does not add a second one.
 */
export const ARTIFACTORY_MAVEN_MIRROR_ID = "artifactory-mirror";

/**
 * Strip XML comments so commented-out mirror blocks are not treated as active.
 * @param {string} xml
 * @returns {string}
 */
function stripXmlComments(xml) {
  return String(xml || "").replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Text content of a simple XML element body (plain text or one CDATA section).
 * @param {string} inner
 * @returns {string}
 */
function xmlElementText(inner) {
  const s = String(inner || "");
  const cdata = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) return cdata[1].trim();
  // Drop nested markup if present; mirror id/url are text nodes in practice.
  return s.replace(/<[^>]+>/g, "").trim();
}

/**
 * Extract the Artifactory mirror URL from a Maven settings.xml body.
 * Only the mirror with id {@link ARTIFACTORY_MAVEN_MIRROR_ID} counts —
 * that is what `jf setup maven` overwrites.
 * @param {string} body
 * @returns {string[]} zero or one URL
 */
export function parseMavenArtifactoryMirrorUrls(body) {
  // Not a full XML DOM — strip comments + CDATA text extraction covers the
  // failure modes that matter for conflict detection without a new dependency.
  const xml = stripXmlComments(String(body || ""));
  /** @type {string[]} */
  const out = [];
  const mirrorRe = /<mirror\b[^>]*>([\s\S]*?)<\/mirror>/gi;
  let m;
  while ((m = mirrorRe.exec(xml)) !== null) {
    const block = m[1];
    const idMatch = block.match(/<id\b[^>]*>([\s\S]*?)<\/id>/i);
    if (!idMatch) continue;
    if (xmlElementText(idMatch[1]) !== ARTIFACTORY_MAVEN_MIRROR_ID) continue;
    const urlMatch = block.match(/<url\b[^>]*>([\s\S]*?)<\/url>/i);
    if (urlMatch) {
      const url = stripWrappedQuotes(xmlElementText(urlMatch[1]));
      if (url) out.push(url);
    }
  }
  return out;
}

/**
 * Candidate Maven settings.xml paths (first existing wins).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function mavenSettingsFileCandidates(h) {
  return [path.join(h, ".m2", "settings.xml")];
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
function readMavenMirrorUrls(home) {
  const h = resolveHome(home);
  for (const file of mavenSettingsFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      return parseMavenArtifactoryMirrorUrls(readFileSync(file, "utf8"));
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
function pathIsUnderOrEqual(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * True when `h` is the process home (production). Temp test homes must not
 * inherit ambient GRADLE_USER_HOME / XDG_CONFIG_HOME outside the sandbox.
 * @param {string} h
 * @returns {boolean}
 */
function isProcessHome(h) {
  return path.resolve(h) === path.resolve(resolveHome());
}

/**
 * Fixed filename written by `jf setup gradle` under `$GRADLE_USER_HOME/init.d/`.
 * (jfrog-cli-artifactory `gradle.InitScriptName`).
 */
export const ARTIFACTORY_GRADLE_INIT_SCRIPT = "jfrog.init.gradle";

/**
 * Drop Groovy/Java-style comments so commented-out `def artifactoryUrl`
 * lines are not treated as active (same idea as Maven XML comment stripping).
 * @param {string} body
 * @returns {string}
 */
function stripGroovyComments(body) {
  let s = String(body || "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^\s*\/\/.*$/gm, "");
  return s;
}

/**
 * Parse `def artifactoryUrl = '…'` / `"…"` from a jfrog.init.gradle body.
 * @param {string} body
 * @returns {string[]}
 */
export function parseGradleArtifactoryUrls(body) {
  /** @type {string[]} */
  const out = [];
  for (const line of stripGroovyComments(body).split(/\r?\n/)) {
    // Allow optional trailing `// …` after the closing quote. Do not strip
    // bare `//` inside the line — that would corrupt `https://` in the URL.
    const m = line.match(
      /^\s*def\s+artifactoryUrl\s*=\s*(['"])(.+?)\1\s*(?:\/\/.*)?$/,
    );
    if (m) {
      const url = stripWrappedQuotes(m[2]);
      if (url) out.push(url);
    }
  }
  return out;
}

/**
 * Candidate paths for the JFrog Gradle init script (first existing wins).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function gradleInitFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  const guh = process.env.GRADLE_USER_HOME;
  if (guh && (pathIsUnderOrEqual(guh, h) || isProcessHome(h))) {
    out.push(path.join(guh, "init.d", ARTIFACTORY_GRADLE_INIT_SCRIPT));
  }
  const fallback = path.join(
    h,
    ".gradle",
    "init.d",
    ARTIFACTORY_GRADLE_INIT_SCRIPT,
  );
  if (!out.includes(fallback)) out.push(fallback);
  return out;
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
function readGradleArtifactoryUrls(home) {
  const h = resolveHome(home);
  for (const file of gradleInitFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      const urls = parseGradleArtifactoryUrls(readFileSync(file, "utf8"));
      if (urls.length) return urls;
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Source name used by `jf setup nuget` / `jf setup dotnet`
 * (jfrog-cli-artifactory `dotnet.SourceName`).
 */
export const ARTIFACTORY_NUGET_SOURCE_NAME = "JFrogCli";

/** @param {string} s */
function escapeRegExp(s) {
  return String(s).replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Extract the JFrogCli package source URL from a NuGet.Config body.
 * @param {string} body
 * @returns {string[]}
 */
export function parseNugetJFrogCliSourceUrls(body) {
  // Same as Maven: ignore commented-out <add …/> blocks.
  const xml = stripXmlComments(String(body || ""));
  /** @type {string[]} */
  const out = [];
  const key = escapeRegExp(ARTIFACTORY_NUGET_SOURCE_NAME);
  // <add key="…" value="https://…" …/>  (attribute order may vary)
  const re = new RegExp(
    `<add\\b[^>]*\\bkey\\s*=\\s*["']${key}["'][^>]*\\bvalue\\s*=\\s*["']([^"']+)["'][^>]*\\/?>`,
    "gi",
  );
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = stripWrappedQuotes(m[1]);
    if (url) out.push(url);
  }
  // value before key
  const re2 = new RegExp(
    `<add\\b[^>]*\\bvalue\\s*=\\s*["']([^"']+)["'][^>]*\\bkey\\s*=\\s*["']${key}["'][^>]*\\/?>`,
    "gi",
  );
  while ((m = re2.exec(xml)) !== null) {
    const url = stripWrappedQuotes(m[1]);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

/**
 * Candidate NuGet.Config paths (scan all that exist; first hit with JFrogCli wins via reader).
 * @param {string} h home directory
 * @returns {string[]}
 */
export function nugetConfigFileCandidates(h) {
  /** @type {string[]} */
  const out = [];
  // dotnet default
  out.push(path.join(h, ".nuget", "NuGet", "NuGet.Config"));
  // nuget / XDG-style — only ambient XDG when under sandbox home or real HOME
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && (pathIsUnderOrEqual(xdg, h) || isProcessHome(h))) {
    out.push(path.join(xdg, "NuGet", "NuGet.Config"));
  }
  out.push(path.join(h, ".config", "NuGet", "NuGet.Config"));
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(h, "AppData", "Roaming");
    if (pathIsUnderOrEqual(appData, h) || isProcessHome(h)) {
      out.push(path.join(appData, "NuGet", "NuGet.Config"));
    } else {
      out.push(path.join(h, "AppData", "Roaming", "NuGet", "NuGet.Config"));
    }
  }
  return out;
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
function readNugetJFrogCliUrls(home) {
  const h = resolveHome(home);
  for (const file of nugetConfigFileCandidates(h)) {
    if (!existsSync(file)) continue;
    try {
      const urls = parseNugetJFrogCliSourceUrls(readFileSync(file, "utf8"));
      if (urls.length) return urls;
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
 * (`UV_CONFIG_FILE` / uv.toml), go (platform GOENV paths), maven
 * (`$HOME/.m2/settings.xml` mirror id `artifactory-mirror`), gradle
 * (`$GRADLE_USER_HOME/init.d/jfrog.init.gradle`), nuget/dotnet
 * (`JFrogCli` source in NuGet.Config).
 * docker/podman/helm are additive logins (not default-registry overwrite) —
 * left uncovered until product treats multi-host auth as a conflict.
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
  } else if (pm === "maven" || pm === "mvn") {
    existing = readMavenMirrorUrls(opts.home);
  } else if (pm === "gradle") {
    existing = readGradleArtifactoryUrls(opts.home);
  } else if (pm === "nuget" || pm === "dotnet") {
    existing = readNugetJFrogCliUrls(opts.home);
  } else {
    // docker / podman / helm: additive registry login — not a silent default rewrite
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
