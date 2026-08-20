// Per-type APR onboarding decline cache.
//
// Durable "No" for one package type lives here — not in agents-conf.json —
// so declining pypi does not silence a later npm offer.
//
// File: ~/.jfrog/skills-cache/apr-onboarding-v1.json
//   {
//     "schema": 1,
//     "declined": {
//       "pypi": { "at": "2026-08-17T10:00:00.000Z" }
//     }
//   }

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

import { createLogger } from "../../core/logger.mjs";
import { PACKAGE_TYPES } from "./repo-types.mjs";

const log = createLogger("onboarding-decline-cache");

const SCHEMA = 1;
const ALLOWED = new Set(PACKAGE_TYPES);
const DECLINE_CACHE_LOCK_STALE_MS = 30_000;
const DECLINE_CACHE_LOCK_WAIT_MS = 1_000;
const DECLINE_CACHE_LOCK_POLL_MS = 25;

/** @returns {string} `~/.jfrog/skills-cache` */
function cacheDir(home = homedir()) {
  return path.join(home, ".jfrog", "skills-cache");
}

/** @param {string} [home] */
export function onboardingDeclineCachePath(home = homedir()) {
  return path.join(cacheDir(home), "apr-onboarding-v1.json");
}

/** @param {string} [home] */
function declineCacheLockPath(home = homedir()) {
  return path.join(cacheDir(home), "apr-onboarding-v1.lock");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryDeclineCacheLock(home) {
  mkdirSync(path.dirname(declineCacheLockPath(home)), { recursive: true });
  const fd = openSync(declineCacheLockPath(home), "wx");
  try {
    writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
  } finally {
    closeSync(fd);
  }
}

function releaseDeclineCacheLock(home) {
  try {
    unlinkSync(declineCacheLockPath(home));
  } catch {
    // ignore
  }
}

function reclaimStaleDeclineCacheLock(home, nowMs) {
  const lock = declineCacheLockPath(home);
  try {
    const raw = readFileSync(lock, "utf8");
    const stampLine = raw.split("\n")[1];
    const ts = Number(stampLine);
    const hasStamp =
      typeof stampLine === "string" &&
      stampLine.trim() !== "" &&
      Number.isFinite(ts);
    // Incomplete wx→write lock files have no timestamp yet. Never treat those
    // as stale or a concurrent waiter steals the lock and last-write wins.
    const ageMs = hasStamp ? nowMs - ts : nowMs - statSync(lock).mtimeMs;
    if (ageMs > DECLINE_CACHE_LOCK_STALE_MS) {
      unlinkSync(lock);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function acquireDeclineCacheLock(home, nowMs = Date.now()) {
  try {
    tryDeclineCacheLock(home);
    return true;
  } catch {
    if (!reclaimStaleDeclineCacheLock(home, nowMs)) return false;
    try {
      tryDeclineCacheLock(home);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Serialize read-modify-write of the decline cache across processes.
 * @template T
 * @param {string} home
 * @param {() => T} fn
 * @returns {T}
 */
function withDeclineCacheLock(home, fn) {
  const deadline = Date.now() + DECLINE_CACHE_LOCK_WAIT_MS;
  let locked = acquireDeclineCacheLock(home);
  while (!locked && Date.now() < deadline) {
    sleepSync(DECLINE_CACHE_LOCK_POLL_MS);
    locked = acquireDeclineCacheLock(home, Date.now());
  }
  if (!locked) {
    throw new Error(
      "apr-onboarding-v1.lock: could not acquire lock within wait budget",
    );
  }
  try {
    return fn();
  } finally {
    releaseDeclineCacheLock(home);
  }
}

/** @returns {{ schema: number, declined: Record<string, { at: string }> }} */
function emptyCache() {
  return { schema: SCHEMA, declined: {} };
}

/**
 * @param {unknown} data
 * @returns {{ schema: number, declined: Record<string, { at: string }> }}
 */
export function normalizeOnboardingDeclineCache(data) {
  if (!data || typeof data !== "object" || data.schema !== SCHEMA) {
    return emptyCache();
  }
  /** @type {Record<string, { at: string }>} */
  const declined = {};
  const raw = data.declined;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [type, entry] of Object.entries(raw)) {
      if (!ALLOWED.has(type)) continue;
      if (!entry || typeof entry !== "object") continue;
      const at = typeof entry.at === "string" && entry.at ? entry.at : null;
      if (!at) continue;
      declined[type] = { at };
    }
  }
  return { schema: SCHEMA, declined };
}

/**
 * @param {string} [home]
 * @returns {{ schema: number, declined: Record<string, { at: string }> }}
 */
export function readOnboardingDeclineCache(home = homedir()) {
  const file = onboardingDeclineCachePath(home);
  try {
    if (!existsSync(file)) return emptyCache();
    return normalizeOnboardingDeclineCache(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch (err) {
    log.warn("onboarding decline cache unreadable; treating as empty", {
      error: err?.message ?? String(err),
    });
    return emptyCache();
  }
}

/**
 * @param {string} [home]
 * @returns {string[]}
 */
export function listDeclinedOnboardingTypes(home = homedir()) {
  return Object.keys(readOnboardingDeclineCache(home).declined).sort();
}

/**
 * @param {{ schema: number, declined: Record<string, { at: string }> }} root
 * @param {string} [home]
 */
function writeCache(root, home = homedir()) {
  const file = onboardingDeclineCachePath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * Record a durable per-type decline.
 * @param {string} type APR package type
 * @param {{ at?: string, home?: string }} [opts]
 */
export function declineOnboardingType(type, opts = {}) {
  if (!ALLOWED.has(type)) {
    throw new Error(`unsupported package type for dismiss: ${type}`);
  }
  const home = opts.home ?? homedir();
  const at = opts.at ?? new Date().toISOString();
  withDeclineCacheLock(home, () => {
    // Re-read under the lock so concurrent declines accumulate.
    const root = readOnboardingDeclineCache(home);
    root.declined[type] = { at };
    writeCache(root, home);
  });
  log.info("onboarding.decline.recorded", { type, at });
}
