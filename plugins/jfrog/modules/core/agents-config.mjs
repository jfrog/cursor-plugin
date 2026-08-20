// Local admin config at ~/.jfrog/agents-conf.json (shipped template: assets/agents-default-conf.json).
//
// Read-only helpers — no network. Session starters call ensureAgentsConfigScaffold()
// before capabilities run so first-time installs get a writable config file.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSafeRepoKey } from "../package-resolution/scripts/repo-types.mjs";

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
const AGENTS_CONFIG_LOCK_STALE_MS = 30_000;
const AGENTS_CONFIG_LOCK_WAIT_MS = 1_000;
const AGENTS_CONFIG_LOCK_POLL_MS = 25;
let memoizedRaw = undefined;
let memoizedForPath = null;
let memoizedMtimeMs = undefined;
/** @type {{ source: 'missing' | 'user' | 'template', parseFailed: boolean, path: string }} */
let loadMeta = { source: "missing", parseFailed: false, path: "" };

function agentsConfigPath() {
  return path.join(homedir(), ".jfrog", "agents-conf.json");
}

function agentsConfigLockPath() {
  return path.join(homedir(), ".jfrog", "agents-conf.lock");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAgentsConfigLock() {
  mkdirSync(path.dirname(agentsConfigLockPath()), { recursive: true });
  const fd = openSync(agentsConfigLockPath(), "wx");
  try {
    writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
  } finally {
    closeSync(fd);
  }
}

function releaseAgentsConfigLock() {
  try {
    unlinkSync(agentsConfigLockPath());
  } catch {
    // ignore
  }
}

function reclaimStaleAgentsConfigLock(nowMs) {
  const lock = agentsConfigLockPath();
  try {
    const raw = readFileSync(lock, "utf8");
    const stampLine = raw.split("\n")[1];
    const ts = Number(stampLine);
    const hasStamp =
      typeof stampLine === "string" &&
      stampLine.trim() !== "" &&
      Number.isFinite(ts);
    const ageMs = hasStamp ? nowMs - ts : nowMs - statSync(lock).mtimeMs;
    if (ageMs > AGENTS_CONFIG_LOCK_STALE_MS) {
      unlinkSync(lock);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function acquireAgentsConfigLock(nowMs = Date.now()) {
  try {
    tryAgentsConfigLock();
    return true;
  } catch {
    if (!reclaimStaleAgentsConfigLock(nowMs)) return false;
    try {
      tryAgentsConfigLock();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Serialize read-merge-rename of agents-conf.json across processes.
 * Fails closed when the lock cannot be acquired — never silently races an
 * unlocked RMW (Consent Enable / dismiss / SessionStart can overlap).
 */
function withAgentsConfigLock(fn) {
  const deadline = Date.now() + AGENTS_CONFIG_LOCK_WAIT_MS;
  let locked = acquireAgentsConfigLock();
  while (!locked && Date.now() < deadline) {
    sleepSync(AGENTS_CONFIG_LOCK_POLL_MS);
    locked = acquireAgentsConfigLock(Date.now());
  }
  if (!locked) {
    throw new Error(
      "agents-conf.lock: could not acquire lock within wait budget",
    );
  }
  try {
    return fn();
  } finally {
    releaseAgentsConfigLock();
  }
}

function resetLoadMeta(configPath) {
  loadMeta = { source: "missing", parseFailed: false, path: configPath };
}

/**
 * Copy the shipped template when missing. Caller must hold agents-conf.lock
 * (or use {@link ensureAgentsConfigScaffold}). Uses exclusive create so a
 * late scaffold cannot clobber a concurrent patch that already created the file.
 */
function ensureAgentsConfigScaffoldUnlocked() {
  const configPath = agentsConfigPath();
  if (existsSync(configPath)) return { created: false, path: configPath };
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    const fd = openSync(configPath, "wx");
    try {
      writeFileSync(fd, readFileSync(TEMPLATE_PATH));
    } finally {
      closeSync(fd);
    }
    memoizedRaw = undefined;
    memoizedForPath = null;
    memoizedMtimeMs = undefined;
    return { created: true, path: configPath };
  } catch {
    // Another writer won the create race — treat as already present.
    if (existsSync(configPath)) {
      return { created: false, path: configPath };
    }
    return { created: false, path: configPath };
  }
}

/**
 * Copy the shipped template to ~/.jfrog/agents-conf.json when missing.
 * Never overwrites an existing file. Serialized with mergeAgentsConfigPatch.
 */
export function ensureAgentsConfigScaffold() {
  return withAgentsConfigLock(() => ensureAgentsConfigScaffoldUnlocked());
}

export { agentsConfigPath };

/** Drop the in-process config memo (tests / direct writers that skip mergeAgentsConfigPatch). */
export function invalidateAgentsConfigCache() {
  memoizedRaw = undefined;
  memoizedForPath = null;
  memoizedMtimeMs = undefined;
}

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
  const mtimeMs = getAgentsConfigMtimeMs();
  if (
    memoizedForPath !== configPath ||
    memoizedMtimeMs !== mtimeMs ||
    memoizedRaw === undefined
  ) {
    memoizedRaw = undefined;
    memoizedForPath = configPath;
    memoizedMtimeMs = mtimeMs;
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
      onboardingPrompt: normalizeOnboardingPrompt(pr.onboardingPrompt),
      defaultGlobalRepos,
      autoSetup: normalizeAutoSetup(pr.autoSetup),
    },
  };
}

/**
 * Raw onboardingPrompt field: "auto" | "off" | "absent" (legacy / missing).
 * Not normalized to auto — callers distinguish fingerprint fallback.
 */
export function getOnboardingPromptState() {
  const pr = getAgentsConfigSection("packageResolution") ?? {};
  if (pr.onboardingPrompt === "off") return "off";
  if (pr.onboardingPrompt === "auto") return "auto";
  return "absent";
}

function normalizeOnboardingPrompt(raw) {
  if (raw === "off") return "off";
  if (raw === "auto") return "auto";
  return "absent";
}

/**
 * Deep-merge a patch into agents-conf.json (preserves unknown fields).
 * `packageResolution.defaultGlobalRepos` and `autoSetup` are replaced when
 * present in the patch (Consent Enable replaces the map with verified keys only).
 * @param {object} patch
 */
export function mergeAgentsConfigPatch(patch) {
  return withAgentsConfigLock(() => {
    ensureAgentsConfigScaffoldUnlocked();
    const configPath = agentsConfigPath();
    let current = {};
    let existed = false;
    try {
      if (existsSync(configPath)) {
        existed = true;
        const parsed = JSON.parse(readFileSync(configPath, "utf8"));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error(
            "agents-conf.json root must be a JSON object and was not overwritten",
          );
        }
        current = parsed;
      }
    } catch (err) {
      // Never replace a malformed user config with a patch-only file.
      if (existed) {
        throw new Error(
          `agents-conf.json is malformed and was not overwritten: ${err?.message ?? err}`,
        );
      }
      current = {};
    }
    const next = deepMerge(current, patch);
    if (
      patch?.packageResolution &&
      Object.prototype.hasOwnProperty.call(
        patch.packageResolution,
        "defaultGlobalRepos",
      )
    ) {
      next.packageResolution = next.packageResolution ?? {};
      next.packageResolution.defaultGlobalRepos =
        patch.packageResolution.defaultGlobalRepos;
    }
    if (
      patch?.packageResolution &&
      Object.prototype.hasOwnProperty.call(patch.packageResolution, "autoSetup")
    ) {
      next.packageResolution = next.packageResolution ?? {};
      next.packageResolution.autoSetup = patch.packageResolution.autoSetup;
    }
    mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, configPath);
    memoizedRaw = undefined;
    memoizedMtimeMs = undefined;
    return next;
  });
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out =
    base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function getGlobalLogLevel() {
  return loadAgentsConfig().logLevel;
}

/**
 * Package types the admin declares globally. Workspace overlay may add
 * additional governed types for the session (see governedPackageTypes), but
 * autoSetup never runs for workspace-only types.
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
    if (isSafeRepoKey(key?.trim())) out[type] = key.trim();
  }
  return out;
}
