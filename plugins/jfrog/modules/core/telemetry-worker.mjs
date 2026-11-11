#!/usr/bin/env node
// Plugin install telemetry worker (epic WNGM-5915). Runs in the detached
// process telemetry-runner.mjs starts, never inside the hook, so nothing here
// counts against the hook budget.
//
// Usage: node telemetry-worker.mjs <adapter harness id>
//
// One run: read or create the install ID, choose the event from this harness's
// receipt (install, update or the daily active), send it to the customer JPD
// (found in agents-conf.json, JFROG_URL, JF_URL or the jf CLI config) — first
// through `jf api` to its authenticated route when jf has a server for it — or,
// when that isn't possible, the generic JPD, write the receipt after a
// 2xx. A final 429 or 5xx holds this harness back (Retry-After, else an
// exponential backoff); every send first waits a random 0-60 s. All state
// lives in ~/.jfrog/telemetry/ (not skills-cache/, which uninstall deletes).
// Never throws; a 12 s timer, restarted after that wait, ends the process
// whatever happens.

import { randomInt, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAgentsConfigSection } from "./agents-config.mjs";
import { isMainEntry } from "./entry.mjs";
import { parseHttpStatus, runJf } from "./jpd-get.mjs";
import { createLogger, setLogContext } from "./logger.mjs";
import {
  hooksPackageVersion,
  skillsProductUserAgent,
} from "./jf-user-agent.mjs";
import {
  parseJfConfigShowJson,
  pickDefaultJfCliServer,
  resolveJfrogHomeDir,
} from "./rewrite-mcp-json.mjs";
import {
  GENERIC_JPD_URL,
  TELEMETRY_ROUTE,
  buildLifecycleBody,
  telemetryHarness,
  telemetryOs,
} from "./telemetry-contract.mjs";

const log = createLogger("telemetry");

const WORKER_CAP_MS = 12_000;
const SEND_TIMEOUT_MS = 5_000;
// The authenticated attempt's share of the customer hop's 5 s.
const AUTH_ATTEMPT_MS = 3_000;
const LOCK_STALE_MS = 60_000;
const INSTALL_ID_WAIT_MS = 1_000;
const LOCK_POLL_MS = 50;
const ACTIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// The random wait before a send, so the machines of one MDM rollout, and their
// retries, don't all reach a JPD in the same minute (WNGM-5915 rate-limit
// review).
const JITTER_MAX_MS = 60_000;
// After consecutive 429/5xx answers: 1 h, doubling up to 24 h.
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

const INSTALL_ID_FILE = "install-id-v1.json";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The plugin folder that holds this modules/ bundle (worker is in
// modules/core/), and the manifest folders a plugin may keep there (spec,
// "Plugin version").
const PLUGIN_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const PLUGIN_MANIFEST_DIRS = [
  ".claude-plugin",
  ".cursor-plugin",
  ".codex-plugin",
];

/** Locks this process holds, released if the 12 s cap ends it mid-send. */
const heldLocks = new Set();

/** @returns {string} `~/.jfrog/telemetry` */
export function telemetryDir() {
  return path.join(homedir(), ".jfrog", "telemetry");
}

/** @param {string} dir @param {string} harness */
export function receiptPath(dir, harness) {
  return path.join(dir, `receipt-${harness}-v1.json`);
}

/** @param {string} dir @param {string} harness */
export function backoffPath(dir, harness) {
  return path.join(dir, `backoff-${harness}-v1.json`);
}

/** @param {string} dir @param {string} harness */
function receiptLockPath(dir, harness) {
  return path.join(dir, `receipt-${harness}.lock`);
}

/**
 * Write JSON through a temp file and a rename, so a reader never sees half a
 * file.
 * @param {string} file
 * @param {unknown} data
 */
export function writeJsonAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Exclusive-create lock, taken over when older than 60 s (a crashed worker).
 * Same pattern as the APR heartbeat lock; the age comes from the timestamp
 * written inside, or the file's mtime when the owner died before writing it.
 * @param {string} lockPath
 * @param {{ now?: number }} [opts]
 * @returns {{ unlock: () => void } | null}
 */
export function tryAcquireLock(lockPath, opts = {}) {
  const now = opts.now ?? Date.now();
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (err) {
    if (err?.code !== "EEXIST") {
      log.debug("telemetry lock open failed", {
        error: err?.message ?? String(err),
      });
      return null;
    }
    return takeOverStaleLock(lockPath, now)
      ? tryAcquireLock(lockPath, opts)
      : null;
  }
  try {
    writeFileSync(fd, `${now}\n`);
  } catch (err) {
    // Don't leave an open fd and an empty lock behind (e.g. disk full).
    releaseLockFile(fd, lockPath);
    log.debug("telemetry lock write failed", {
      error: err?.message ?? String(err),
    });
    return null;
  }
  const lock = {
    unlock() {
      heldLocks.delete(lock);
      releaseLockFile(fd, lockPath);
    },
  };
  heldLocks.add(lock);
  return lock;
}

function releaseLockFile(fd, lockPath) {
  // Remove the file only while it is still the one this fd created: a worker
  // that slept past 60 s may have lost the lock to a takeover, and must not
  // delete its successor's lock. The open fd keeps the inode from being reused
  // on filesystems with stable inode numbers; where ino is always 0 (FAT,
  // some network mounts) every lock reads as owned, as before WNGM-6857.
  // A takeover between the check and the unlink can still slip through: the
  // same narrow window as takeOverStaleLock.
  let owned = false;
  try {
    owned =
      fstatSync(fd, { bigint: true }).ino ===
      statSync(lockPath, { bigint: true }).ino;
  } catch {
    /* the lock file is gone */
  }
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
  if (!owned) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * Remove a lock older than 60 s. Before removing it, check it is still the same
 * file: another worker may have taken it over and created a fresh one since
 * it was read. That narrows, but doesn't close, the window in which two
 * workers both take over one stale lock. The rest is accepted (WNGM-6857): it
 * needs a crashed worker's lock and two starts of one harness at the same
 * moment, and costs at most one duplicate event, which BA's distinct keys
 * absorb.
 * @returns {boolean} true when the stale lock was removed
 */
function takeOverStaleLock(lockPath, now) {
  try {
    // bigint, as in releaseLockFile: NTFS file IDs can exceed 2^53.
    const seen = statSync(lockPath, { bigint: true });
    let lockedAt = Number(readFileSync(lockPath, "utf8").trim());
    if (!Number.isFinite(lockedAt) || lockedAt <= 0) {
      lockedAt = Number(seen.mtimeMs);
    }
    // A lock dated more than LOCK_STALE_MS in the future (clock moved back)
    // is stale too, or it would block telemetry until wall time caught up.
    if (Math.abs(now - lockedAt) < LOCK_STALE_MS) return false;
    const current = statSync(lockPath, { bigint: true });
    if (current.ino !== seen.ino || current.mtimeNs !== seen.mtimeNs) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string | null} the stored install ID, or null when absent or not a
 *   UUIDv4. A file that fails this check is replaced once by ensureInstallId,
 *   the only exception to "never rewritten".
 * @throws on any read error other than ENOENT (EACCES, EBUSY from antivirus on
 *   Windows): the ID's state is unknown, so it must not be replaced.
 */
function readInstallId(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  try {
    const { installId } = JSON.parse(raw);
    return typeof installId === "string" && UUID_V4.test(installId)
      ? installId
      : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The machine's install ID, created on first use. Created once under its own
 * lock and never rewritten; a process that finds the lock held waits up to
 * 1 s for the other one to finish, so two harnesses starting together share
 * one ID.
 * @param {string} [dir]
 * @param {{ waitMs?: number, now?: number }} [opts]
 * @returns {Promise<string | null>}
 * @throws when the ID file exists but can't be read (see readInstallId)
 */
export async function ensureInstallId(dir = telemetryDir(), opts = {}) {
  const file = path.join(dir, INSTALL_ID_FILE);
  const lockPath = path.join(dir, "install-id.lock");
  const deadline = Date.now() + (opts.waitMs ?? INSTALL_ID_WAIT_MS);
  for (;;) {
    const existing = readInstallId(file);
    if (existing) return existing;
    const lock = tryAcquireLock(lockPath, { now: opts.now });
    if (lock) {
      try {
        // Re-check under the lock — another process may have just created it.
        const created = readInstallId(file);
        if (created) return created;
        const installId = randomUUID();
        writeJsonAtomic(file, {
          installId,
          createdAt: new Date().toISOString(),
        });
        return installId;
      } finally {
        lock.unlock();
      }
    }
    if (Date.now() >= deadline) return readInstallId(file);
    await sleep(LOCK_POLL_MS);
  }
}

/**
 * JPD base URL from a configured value: http(s) only, without a trailing
 * slash or `/artifactory` (as jpd-get.mjs does).
 * @param {string | undefined} raw
 * @returns {string | null}
 */
export function jpdBaseUrl(raw) {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/artifactory$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

/**
 * The jf CLI's servers, from where jf keeps them ($JFROG_CLI_HOME_DIR, else
 * ~/.jfrog). The file holds tokens: only serverId, url (as jpdUrl) and
 * isDefault are kept, and nothing of it is logged.
 * @returns {{ serverId: string, jpdUrl: string, isDefault: boolean }[] | null}
 *   [] when there is no file, null when it exists but can't be read or parsed
 *   (EBUSY from antivirus on Windows, a half-written file)
 */
function jfCliServers(env) {
  let text;
  try {
    const file = path.join(resolveJfrogHomeDir(env), "jfrog-cli.conf.v6");
    text = readFileSync(file, "utf8");
    JSON.parse(text);
  } catch (err) {
    return err?.code === "ENOENT" ? [] : null;
  }
  return parseJfConfigShowJson(text);
}

/**
 * Find the customer JPD (spec "JPD URL discovery"): the first source that is
 * set wins. A set value that isn't an http(s) URL stops the search with
 * `base` null and its source kept, so the event goes to the generic JPD as
 * `other` rather than with the unconfigured installs (WNGM-6855 review).
 * `servers` is the jf CLI server list whatever the source, and `serverId` the
 * server chosen when the URL came from it, both for authServerId().
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   base: string | null,
 *   source: "agents_conf" | "env_jfrog_url" | "env_jf_url" | "jf_config" | "none",
 *   serverId?: string,
 *   servers: { serverId: string, jpdUrl: string, isDefault: boolean }[],
 * }}
 */
export function discoverJpd(env) {
  const read = jfCliServers(env);
  const servers = read ?? [];
  // The isDefault server, else the only one, else none.
  const chosen = pickDefaultJfCliServer(servers);
  for (const [source, raw, serverId] of [
    ["agents_conf", getAgentsConfigSection("telemetry")?.jpdUrl],
    ["env_jfrog_url", env.JFROG_URL],
    ["env_jf_url", env.JF_URL],
    ["jf_config", chosen.jpdUrl, chosen.serverId],
  ]) {
    const value = raw == null ? "" : String(raw).trim();
    if (value) return { base: jpdBaseUrl(value), source, serverId, servers };
  }
  // A jf config that is there but unusable is a set source, not "none".
  if (read === null) return { base: null, source: "jf_config", servers };
  return { base: null, source: "none", servers };
}

/** @returns {string | undefined} the URL's origin, or undefined for no URL */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** @returns {boolean} whether the URL has no path beyond `/` */
function atRoot(url) {
  return new URL(url).pathname.replace(/\/+$/, "") === "";
}

/**
 * The jf CLI server to send the event through (spec "JPD URL discovery",
 * authenticated send), or undefined. Only for an https URL that isn't the
 * generic JPD's, and only a server whose URL has no path: jf api prefixes the
 * route with it, so `…/artifactory/` would miss the Wingman route. Of those:
 * the server the URL came from, else the one server with the same origin
 * (scheme, host, effective port), else the isDefault one of several. Never
 * looks at a credential: jf sends whatever the server holds.
 * @param {ReturnType<typeof discoverJpd>} jpd
 * @param {string} genericBase
 * @returns {string | undefined}
 */
export function authServerId(jpd, genericBase) {
  const origin = originOf(jpd.base);
  if (!origin?.startsWith("https:") || origin === originOf(genericBase)) {
    return undefined;
  }
  const matches = jpd.servers.filter(
    (s) => originOf(s.jpdUrl) === origin && atRoot(s.jpdUrl),
  );
  if (jpd.source === "jf_config") {
    return matches.find((s) => s.serverId === jpd.serverId)?.serverId;
  }
  if (matches.length === 1) return matches[0].serverId;
  return matches.find((s) => s.isDefault)?.serverId;
}

/**
 * The plugin's own version, read at runtime (never stamped at sync: three
 * processes bump it). Probes the manifest folders beside modules/, then under
 * CLAUDE_PLUGIN_ROOT, then PLUGIN_ROOT; the first non-empty `version` wins,
 * trimmed, or "" when it isn't semver. A missing manifest, or one without a
 * version, moves on.
 * @param {{ pluginDir?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} the version, or "" when no manifest has a semver one
 * @throws when a manifest exists but can't be read (EACCES, EBUSY from
 *   antivirus on Windows) or parsed (caught mid-rewrite): reading it as ""
 *   would send a false update now and another one back next session.
 */
export function readPluginVersion(opts = {}) {
  const { pluginDir = PLUGIN_DIR, env = process.env } = opts;
  const roots = [pluginDir, env.CLAUDE_PLUGIN_ROOT, env.PLUGIN_ROOT].filter(
    Boolean,
  );
  for (const root of roots) {
    for (const dir of PLUGIN_MANIFEST_DIRS) {
      let raw;
      try {
        raw = readFileSync(path.join(root, dir, "plugin.json"), "utf8");
      } catch (err) {
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") continue;
        throw err;
      }
      const { version } = JSON.parse(raw) ?? {};
      if (typeof version === "string" && version.trim()) {
        // Wingman answers 400 to a non-semver plugin_version, so the event
        // would never land; "" is accepted and still counts the install.
        return SEMVER.test(version.trim()) ? version.trim() : "";
      }
    }
  }
  return "";
}

// semver.org's recommended regex, as Wingman's route validates versions
// (_SEMVER in backend/app/api/routes/plugin_telemetry.py).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** @param {unknown} value */
function isSemverOrEmpty(value) {
  return typeof value === "string" && (value === "" || SEMVER.test(value));
}

/**
 * This harness's receipt: what was last reported, and when.
 * @param {string} file
 * @returns {{ state: "absent" } | { state: "invalid" } |
 *   { state: "valid", pluginVersion: string, hooksVersion: string, reportedAt: number }}
 * @throws on any read error other than ENOENT: the receipt's state is unknown,
 *   so nothing may be sent or written.
 */
export function readReceipt(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { state: "absent" };
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: "invalid" };
  }
  const { pluginVersion, hooksVersion, reportedAt } = data ?? {};
  const reportedAtMs =
    typeof reportedAt === "string" ? Date.parse(reportedAt) : NaN;
  // The versions become previous_* on an update, which Wingman rejects unless
  // semver or empty; an invalid receipt is repaired by `active` instead.
  if (
    Array.isArray(data) ||
    !isSemverOrEmpty(pluginVersion) ||
    !isSemverOrEmpty(hooksVersion) ||
    !Number.isFinite(reportedAtMs)
  ) {
    return { state: "invalid" };
  }
  return {
    state: "valid",
    pluginVersion,
    hooksVersion,
    reportedAt: reportedAtMs,
  };
}

/**
 * The cadence table (spec, "Event choice and cadence"), in order: no receipt →
 * install; a receipt that isn't valid → active; a version changed → update
 * (even when the receipt is also old); reported 24 h or more ago → active. A
 * receipt dated in the future (the clock moved back) is due at once, which
 * re-anchors it to the current clock.
 * @param {ReturnType<typeof readReceipt>} receipt
 * @param {{ pluginVersion: string, hooksVersion: string }} current
 * @param {number} now — ms
 * @returns {{ action: "install" | "active" } |
 *   { action: "update", previousPluginVersion: string, previousHooksVersion: string } |
 *   null} null when nothing is due
 */
export function chooseEvent(receipt, current, now) {
  if (receipt.state === "absent") return { action: "install" };
  if (receipt.state === "invalid") return { action: "active" };
  if (
    receipt.pluginVersion !== current.pluginVersion ||
    receipt.hooksVersion !== current.hooksVersion
  ) {
    return {
      action: "update",
      previousPluginVersion: receipt.pluginVersion,
      previousHooksVersion: receipt.hooksVersion,
    };
  }
  // A receipt from the future means the clock moved back: report now and
  // re-anchor, rather than wait out up to 48 h.
  const age = now - receipt.reportedAt;
  if (age < 0 || age >= ACTIVE_INTERVAL_MS) {
    return { action: "active" };
  }
  return null;
}

/**
 * This harness's backoff: how many 429/5xx answers in a row, and the time
 * before which nothing is sent.
 * @param {string} file
 * @returns {{ failures: number, notBefore: number } | null} null when absent
 *   or not well-formed (the next 429/5xx rewrites it)
 * @throws on any read error other than ENOENT: whether this harness is held
 *   back is unknown, so nothing may be sent (as for the receipt).
 */
export function readBackoff(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const { failures, notBefore } = data ?? {};
  const notBeforeMs =
    typeof notBefore === "string" ? Date.parse(notBefore) : NaN;
  if (!Number.isInteger(failures) || failures < 1) return null;
  if (!Number.isFinite(notBeforeMs)) return null;
  return { failures, notBefore: notBeforeMs };
}

/**
 * Whether the backoff still holds at `now`. A time more than the longest
 * backoff ahead means the clock moved back: it is ignored rather than waited
 * out, as a receipt from the future is.
 * @param {ReturnType<typeof readBackoff>} backoff
 * @param {number} now — ms
 */
export function holdsBack(backoff, now) {
  if (!backoff) return false;
  const wait = backoff.notBefore - now;
  return wait > 0 && wait <= BACKOFF_MAX_MS;
}

/**
 * A Retry-After value in ms from `now`: delay-seconds or an HTTP-date.
 * @param {string | null | undefined} value
 * @param {number} now — ms
 * @returns {number | undefined} undefined when absent or unparsable
 */
export function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/**
 * The backoff after one more 429/5xx: the longer of the exponential step
 * (1 h, 2 h, 4 h, ... up to 24 h) and the server's Retry-After, also capped at
 * 24 h. Retry-After is a floor, not the wait: a router 429 asks for about 1 s.
 * @param {ReturnType<typeof readBackoff>} previous
 * @param {string | undefined} retryAfter — the header's raw value
 * @param {number} now — ms
 * @returns {{ failures: number, notBefore: string }}
 */
export function nextBackoff(previous, retryAfter, now) {
  const failures = (previous?.failures ?? 0) + 1;
  const exponential = BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 16);
  const wait = Math.min(
    BACKOFF_MAX_MS,
    Math.max(exponential, retryAfterMs(retryAfter, now) ?? 0),
  );
  return { failures, notBefore: new Date(now + wait).toISOString() };
}

/** Whether a final answer holds the harness back: the JPD is busy or failing. */
function backsOff(status) {
  return status === 429 || status >= 500;
}

/** Delete the backoff after a 2xx; the event is already sent, so never throw. */
function clearBackoff(file) {
  try {
    unlinkSync(file);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      log.debug("telemetry backoff not cleared", {
        error: err?.message ?? String(err),
      });
    }
  }
}

/**
 * The random wait before a send: 0-60 s, or JFROG_TEST_TELEMETRY_JITTER_MS
 * under the test harness gate.
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} ms
 */
export function sendJitterMs(env) {
  const pinned = testHook(env, "JFROG_TEST_TELEMETRY_JITTER_MS");
  if (pinned !== undefined) return Math.max(0, Number(pinned) || 0);
  return randomInt(JITTER_MAX_MS + 1);
}

/**
 * The hard cap on one run: calls `onExpire` `ms` after it is armed. Stopped
 * while the worker waits out its jitter and restarted in full after it, so the
 * work before the wait and the work after it each get `ms`: the process lives
 * at most 12 s, plus the wait, plus 12 s.
 * @param {number} ms
 * @param {() => void} onExpire
 * @returns {{ restartAfter: (waitMs: number) => Promise<void> }}
 */
export function startCap(ms, onExpire) {
  let timer;
  const arm = () => {
    timer = setTimeout(onExpire, ms);
    timer.unref();
  };
  arm();
  return {
    async restartAfter(waitMs) {
      clearTimeout(timer);
      await sleep(waitMs);
      arm();
    },
  };
}

/**
 * POST one event. Redirects are never followed; TLS is always verified.
 * @returns {Promise<{ status?: number, retryAfter?: string, error?: string }>}
 */
async function sendEvent(url, body, { timeoutMs, fetchFn }) {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": skillsProductUserAgent(),
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    const retryAfter = res.headers?.get("retry-after");
    return retryAfter == null
      ? { status: res.status }
      : { status: res.status, retryAfter };
  } catch (err) {
    return { error: err?.name || "Error" };
  }
}

const AUTH_ROUTE = `${TELEMETRY_ROUTE}/authenticated`;

// jf api's environment (spec "Send and fallback"): no usage report and no
// version check (each one more request), the status line always printed, and
// no prompt.
const JF_API_ENV = {
  JFROG_CLI_REPORT_USAGE: "false",
  JFROG_CLI_AVOID_NEW_VERSION_WARNING: "true",
  JFROG_CLI_LOG_LEVEL: "INFO",
  CI: "true",
};

/**
 * POST the event to the authenticated route through
 * `jf api --server-id <serverId>`, so jf adds that server's credential and
 * owns the request. The body goes through a temp file, deleted afterwards;
 * jf's output is never logged.
 * @returns {Promise<{ status?: number, error?: string }>} the HTTP status, or
 *   an error: TimeoutError when jf was cut, NoStatus for anything else (no jf,
 *   a jf without `api`, a network error)
 */
export async function sendWithJf(serverId, body, { env, timeoutMs }) {
  const file = path.join(tmpdir(), `jfrog-telemetry-${randomUUID()}.json`);
  const jfEnv = { ...env, ...JF_API_ENV };
  const started = Date.now();
  try {
    writeFileSync(file, JSON.stringify(body), { mode: 0o600, flag: "wx" });
    const run = await runJf(
      [
        "api",
        AUTH_ROUTE,
        "-X",
        "POST",
        "--input",
        file,
        "-H",
        "Content-Type: application/json",
        "--server-id",
        serverId,
        "--disable-token-refresh",
      ],
      { env: jfEnv, timeoutMs },
    );
    if (run.timedOut) return { error: "TimeoutError" };
    const status = parseHttpStatus(run.stderr);
    if (status) return { status };
    if (run.code === 0) {
      // A later jf may print its status differently: say so, without its
      // output, within what is left of the attempt (0 would mean no timeout).
      const left = timeoutMs - (Date.now() - started);
      const version =
        left > 0
          ? await runJf(["--version"], { env: jfEnv, timeoutMs: left })
          : { stdout: "" };
      log.info("telemetry jf api result unparsed", {
        jfVersion: version.stdout.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? "unknown",
      });
    }
    return { error: "NoStatus" };
  } catch {
    return { error: "NoStatus" };
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

// The input exists and refused this event, which the generic JPD would refuse
// too; 429 is the customer's limit, which a fallback would bypass.
const GIVE_UP_STATUSES = new Set([400, 413, 422, 429]);

/**
 * The spec's fallback table ("Send and fallback", public route column).
 * @param {{ status?: number, error?: string }} sent — the customer hop
 * @returns {"jpd_unreachable" | "jpd_rejected" | null} the generic hop's
 *   reason, or null when the customer hop is final (a 2xx, or a give-up status)
 */
function fallbackReason({ status, error }) {
  if (error || status === 408) return "jpd_unreachable";
  if ((status >= 200 && status < 300) || GIVE_UP_STATUSES.has(status)) {
    return null;
  }
  return "jpd_rejected";
}

// Wingman's bare-host rule for `claimed_jpd_host`: at most 253 chars, labels
// of 1-63 [a-z0-9-] chars that don't start or end with a hyphen.
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The customer URL's host as the generic JPD accepts it: lowercased, no port
 * or trailing dot. A host Wingman would refuse (an IPv6 literal, an
 * underscore, an empty or over-long label, over 253 chars) is left out: the
 * field is only a hint, and a 400 on the generic hop would lose the event.
 * @param {string} base
 * @returns {string | undefined}
 */
function claimedJpdHost(base) {
  const host = new URL(base).hostname.replace(/\.$/, "");
  const valid =
    host.length <= 253 && host.split(".").every((l) => HOST_LABEL.test(l));
  return valid ? host : undefined;
}

/**
 * Send to the customer JPD at `jpd.base` — first through jf to the
 * authenticated route when authServerId() finds a server, then to the public
 * route — and then to the generic JPD when there is no base or the fallback
 * table says so. Any outcome of the generic hop is final.
 * @param {ReturnType<typeof discoverJpd>} jpd
 * @returns {Promise<{ status?: number, retryAfter?: string, error?: string, reason?: string }>}
 *   the last hop's result, with the reason when it was the generic hop
 */
async function sendWithFallback(event, jpd, { genericBase, env, ...sendOpts }) {
  const { base, source: jpdUrlSource } = jpd;
  let reason = jpdUrlSource === "none" ? "no_jpd_url" : "other";
  if (base) {
    const body = buildLifecycleBody({ ...event, reason: "none", jpdUrlSource });
    const started = Date.now();
    const serverId = authServerId(jpd, genericBase);
    const viaJf = serverId
      ? await sendWithJf(serverId, body, { env, timeoutMs: AUTH_ATTEMPT_MS })
      : {};
    // A 2xx or a give-up status ends the hop, as on the public route.
    if (viaJf.status && !fallbackReason(viaJf)) return viaJf;
    if (viaJf.status === 408) {
      reason = "jpd_unreachable";
    } else {
      // Any other status, or none: the public route gets the rest of the 5 s.
      const sent = await sendEvent(`${base}${TELEMETRY_ROUTE}`, body, {
        ...sendOpts,
        timeoutMs: Math.max(0, sendOpts.timeoutMs - (Date.now() - started)),
      });
      reason = fallbackReason(sent);
      if (!reason) return sent;
      // A public retry that times out after the JPD answered jf is a rejection.
      if (sent.error === "TimeoutError" && viaJf.status) {
        reason = "jpd_rejected";
      }
    }
  }
  // Debug only: a machine that never reaches the generic JPD would otherwise
  // log this at every session start. A generic 2xx logs its reason once.
  log.debug("telemetry event goes to the generic JPD", { reason });
  const sent = await sendEvent(
    `${genericBase}${TELEMETRY_ROUTE}`,
    buildLifecycleBody({
      ...event,
      reason,
      jpdUrlSource,
      claimedJpdHost: base ? claimedJpdHost(base) : undefined,
    }),
    sendOpts,
  );
  return { ...sent, reason };
}

/**
 * The event due for this harness, or why none is sent: `not-due` (the
 * receipt is fresh) or `backoff` (a 429/5xx holds it back).
 * @returns {{ skip: "not-due" | "backoff" } |
 *   { event: NonNullable<ReturnType<typeof chooseEvent>>, backoff: ReturnType<typeof readBackoff> }}
 * @throws when the receipt or the backoff can't be read
 */
function dueEvent(files, current, now) {
  const event = chooseEvent(readReceipt(files.receipt), current, now);
  if (!event) return { skip: "not-due" };
  const backoff = readBackoff(files.backoff);
  if (holdsBack(backoff, now)) return { skip: "backoff" };
  return { event, backoff };
}

/**
 * One telemetry run for one harness. Never throws. An event that is due waits
 * `jitterMs` through `delay` before the receipt lock is taken: the wait (up to
 * 60 s) must not hold a lock that others take over after 60 s. Then the receipt
 * and backoff are read again under the lock.
 * @param {{
 *   harnessId: string,
 *   env?: NodeJS.ProcessEnv,
 *   dir?: string,
 *   timeoutMs?: number,
 *   fetchFn?: typeof fetch,
 *   now?: () => number,
 *   pluginDir?: string,
 *   jitterMs?: number,
 *   delay?: (ms: number) => Promise<void>,
 * }} opts
 * @returns {Promise<{ outcome: string, action?: string, status?: number, error?: string, reason?: string }>}
 */
export async function runWorker(opts) {
  const {
    harnessId,
    env = process.env,
    dir = telemetryDir(),
    timeoutMs = SEND_TIMEOUT_MS,
    fetchFn = fetch,
    now = Date.now,
    pluginDir,
    jitterMs = 0,
    delay = sleep,
  } = opts;
  try {
    // The id becomes part of a file name.
    if (!/^[a-z_]+$/.test(harnessId ?? "")) return { outcome: "bad-harness" };
    const harness = telemetryHarness(harnessId);

    const installId = await ensureInstallId(dir);
    if (!installId) return { outcome: "no-install-id" };

    const files = {
      receipt: receiptPath(dir, harness),
      backoff: backoffPath(dir, harness),
    };
    const pluginVersion = readPluginVersion({ pluginDir, env });
    const hooksVersion = hooksPackageVersion();
    const current = { pluginVersion, hooksVersion };
    // Before the wait: a run with nothing to send ends at once.
    const first = dueEvent(files, current, now());
    if (first.skip) return { outcome: first.skip };
    await delay(jitterMs);

    // One lock covers read receipt → choose → send → write receipt, so two
    // sessions of one harness never both send the same event.
    const lock = tryAcquireLock(receiptLockPath(dir, harness), { now: now() });
    if (!lock) return { outcome: "locked" };
    try {
      // Again: another session may have sent, or been held back, meanwhile.
      const due = dueEvent(files, current, now());
      if (due.skip) return { outcome: due.skip };
      const { event, backoff } = due;
      const { action } = event;
      // Only when an event is due: the jf CLI config it reads holds tokens.
      const jpd = discoverJpd(env);

      const sent = await sendWithFallback(
        {
          ...event,
          installId,
          harness,
          pluginVersion,
          hooksVersion,
          os: telemetryOs(),
        },
        jpd,
        {
          genericBase:
            testHook(env, "JFROG_TEST_TELEMETRY_GENERIC_URL") ??
            GENERIC_JPD_URL,
          env,
          timeoutMs,
          fetchFn,
        },
      );
      if (sent.error) return { outcome: "failed", action, error: sent.error };
      if (sent.status < 200 || sent.status >= 300) {
        // A 429 or 5xx from the last hop holds the harness back; any other
        // answer (400, 404, ...) leaves the backoff as it is.
        if (backsOff(sent.status)) {
          writeJsonAtomic(
            files.backoff,
            nextBackoff(backoff, sent.retryAfter, now()),
          );
        }
        return { outcome: "rejected", action, status: sent.status };
      }
      // Only after a 2xx, from either hop: a customer 503 then a generic 202
      // writes it. Anything else keeps the old receipt, so the same event is
      // chosen again at the next session start (or when the backoff ends).
      writeJsonAtomic(files.receipt, {
        pluginVersion,
        hooksVersion,
        reportedAt: new Date(now()).toISOString(),
      });
      clearBackoff(files.backoff);
      const result = { outcome: "sent", action, status: sent.status };
      // Only a generic 2xx carries a reason.
      return sent.reason ? { ...result, reason: sent.reason } : result;
    } finally {
      lock.unlock();
    }
  } catch (err) {
    log.debug("telemetry worker failed", {
      error: err?.message ?? String(err),
    });
    return { outcome: "error" };
  }
}

// Test hooks, honoured only under the test harness gate like the other
// JFROG_TEST_* probes.
function testHook(env, key) {
  return env.JFROG_TEST_HARNESS === "1" ? env[key] : undefined;
}

/** Lets Seam 1 tests wait for the worker instead of sleeping. */
function recordDone(env, result) {
  const file = testHook(env, "JFROG_TEST_TELEMETRY_DONE_FILE");
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify(result)}\n`);
  } catch {
    /* ignore */
  }
}

async function main() {
  const env = process.env;
  const cap = startCap(WORKER_CAP_MS, () => {
    for (const lock of [...heldLocks]) lock.unlock();
    recordDone(env, { outcome: "cap" });
    process.exit(0);
  });

  const harnessId = process.argv[2];
  setLogContext({ ide: harnessId });
  const result = await runWorker({
    harnessId,
    env,
    jitterMs: sendJitterMs(env),
    delay: cap.restartAfter,
  });
  if (result.outcome === "sent") {
    log.info("telemetry event sent", {
      action: result.action,
      status: result.status,
      ...(result.reason && { reason: result.reason }),
    });
  } else {
    log.debug("telemetry run", result);
  }
  recordDone(env, result);
}

if (isMainEntry(import.meta.url)) {
  main().catch(() => process.exit(0));
}
