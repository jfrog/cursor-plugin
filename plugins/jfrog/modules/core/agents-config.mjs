// Local admin config at ~/.jfrog/agents-conf.json (shipped template: assets/agents-default-conf.json).
//
// Read-only helpers — no network. Session starters call ensureAgentsConfigScaffold()
// before capabilities run so first-time installs get a writable config file.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** modules bundle root (parent of core/ and assets/). */
const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TEMPLATE_PATH = path.join(
  PLUGIN_ROOT,
  "assets",
  "agents-default-conf.json",
);

const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_CACHE_TTL_DAYS = 7;
let memoizedRaw = undefined;
let memoizedForPath = null;
/** @type {{ source: 'missing' | 'user' | 'template', parseFailed: boolean, path: string }} */
let loadMeta = { source: "missing", parseFailed: false, path: "" };

function agentsConfigPath() {
  return path.join(homedir(), ".jfrog", "agents-conf.json");
}

function resetLoadMeta(configPath) {
  loadMeta = { source: "missing", parseFailed: false, path: configPath };
}

/**
 * Copy the shipped template to ~/.jfrog/agents-conf.json when missing.
 * Never overwrites an existing file.
 */
export function ensureAgentsConfigScaffold() {
  const configPath = agentsConfigPath();
  if (existsSync(configPath)) return { created: false, path: configPath };
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    copyFileSync(TEMPLATE_PATH, configPath);
    memoizedRaw = undefined;
    return { created: true, path: configPath };
  } catch {
    return { created: false, path: configPath };
  }
}

export { agentsConfigPath };

/** @returns {number | null} mtime in ms, or null when the file is absent */
export function getAgentsConfigMtimeMs() {
  try {
    return statSync(agentsConfigPath()).mtimeMs;
  } catch {
    return null;
  }
}

function parseAgentsJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readAgentsConfigRaw() {
  const configPath = agentsConfigPath();
  if (memoizedForPath !== configPath) {
    memoizedRaw = undefined;
    memoizedForPath = configPath;
    resetLoadMeta(configPath);
  }
  if (memoizedRaw !== undefined) return memoizedRaw;

  const userExists = existsSync(configPath);
  if (userExists) {
    try {
      const parsed = parseAgentsJson(readFileSync(configPath, "utf8"));
      if (parsed) {
        memoizedRaw = parsed;
        loadMeta = { source: "user", parseFailed: false, path: configPath };
        return memoizedRaw;
      }
      loadMeta = { source: "template", parseFailed: true, path: configPath };
    } catch {
      loadMeta = { source: "template", parseFailed: true, path: configPath };
    }
  }

  try {
    memoizedRaw = parseAgentsJson(readFileSync(TEMPLATE_PATH, "utf8"));
    if (!userExists) {
      loadMeta = {
        source: memoizedRaw ? "template" : "missing",
        parseFailed: false,
        path: configPath,
      };
    }
  } catch {
    memoizedRaw = null;
    if (!userExists)
      loadMeta = { source: "missing", parseFailed: false, path: configPath };
  }
  return memoizedRaw;
}

/** Call after loadAgentsConfig() — surfaces user-file parse failures. */
export function getAgentsConfigLoadMeta() {
  readAgentsConfigRaw();
  return { ...loadMeta };
}

/** @returns {Array<{ message: string, path: string }>} */
export function agentsConfigLoadWarnings() {
  loadAgentsConfig();
  if (!loadMeta.parseFailed) return [];
  return [
    {
      message: "agents-conf.json unreadable; using shipped template defaults",
      path: loadMeta.path,
    },
  ];
}

/** @returns {object | null} raw section or null */
export function getAgentsConfigSection(name) {
  const config = readAgentsConfigRaw();
  if (!config) return null;
  const section = config[name];
  return section && typeof section === "object" ? section : null;
}

/** @returns {{ logLevel: string, packageResolution: object }} merged with documented defaults */
export function loadAgentsConfig() {
  const file = readAgentsConfigRaw() ?? {};
  const pr =
    file.packageResolution && typeof file.packageResolution === "object"
      ? file.packageResolution
      : {};
  const defaultGlobalRepos =
    pr.defaultGlobalRepos && typeof pr.defaultGlobalRepos === "object"
      ? normalizeRepoMap(pr.defaultGlobalRepos)
      : {};

  return {
    logLevel: normalizeLogLevel(file.logLevel),
    packageResolution: {
      enabled: pr.enabled === true,
      verifyRepos: pr.verifyRepos !== false,
      cacheTtlDays: normalizeCacheTtlDays(pr.cacheTtlDays),
      defaultGlobalRepos,
      autoSetup: normalizeAutoSetup(pr.autoSetup),
    },
  };
}

export function getGlobalLogLevel() {
  return loadAgentsConfig().logLevel;
}

/**
 * Package types the admin declares globally (governance source). Governance is
 * the UNION of these and any workspace `.jfrog/local` repositories; the workspace
 * side is added by the resolver (workspace-dependent, per-session).
 * @returns {string[]} defaultGlobalRepos keys (unordered)
 */
export function globalDeclaredTypes() {
  return Object.keys(loadAgentsConfig().packageResolution.defaultGlobalRepos);
}

/**
 * Repo-agnostic "auto setup" policy check for a single package type.
 * `autoSetup: true` means all governed types; an array names a subset.
 * NOTE: this is a pure policy check — the caller still gates on the type being
 * governed + resolved this session.
 * @param {string} type
 * @returns {boolean}
 */
export function isAutoSetup(type) {
  const e = loadAgentsConfig().packageResolution.autoSetup;
  if (e === true) return true;
  return Array.isArray(e) && e.includes(type);
}

function normalizeLogLevel(level) {
  const s = typeof level === "string" ? level.toLowerCase() : "";
  const allowed = new Set(["silent", "debug", "info", "warn", "error"]);
  return allowed.has(s) ? s : DEFAULT_LOG_LEVEL;
}

function normalizeCacheTtlDays(days) {
  if (days === 0) return 0;
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
    return DEFAULT_CACHE_TTL_DAYS;
  }
  return Math.floor(days);
}

/**
 * Normalize the `autoSetup` policy: `true` (all governed types) or an
 * array of type-name strings. Anything else -> `[]` (nothing eager). Malformed
 * array entries (non-strings / blanks) are dropped; whether a named type is
 * actually governed is validated later (per-session, where governance is known).
 * @returns {true | string[]}
 */
export function normalizeAutoSetup(raw) {
  if (raw === true) return true;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (typeof t === "string" && t.trim()) out.push(t.trim());
  }
  return out;
}

/** Trim string repo keys; drop empty values. */
export function normalizeRepoMap(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [type, key] of Object.entries(raw)) {
    if (typeof key === "string" && key.trim()) out[type] = key.trim();
  }
  return out;
}
