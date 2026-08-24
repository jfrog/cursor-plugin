// Daily APR session heartbeat — best-effort `jf rt ping` so Coralogix still
// sees hook-driven traffic when eager `jf setup` is skipped (steady state).
//
// Gated to routing-mode sessionStart (caller). At most once per 24h per
// serverId via ~/.jfrog/skills-cache/apr-heartbeat-v1.json, with an exclusive
// per-server lock file to reduce cross-process stampedes. Never throws —
// heartbeat must not break injection.

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { createLogger } from "../../core/logger.mjs";
import { getPlatformIdentity } from "../../core/jf-identity.mjs";
import { envWithHookUserAgent } from "../../core/jf-user-agent.mjs";

const log = createLogger("apr-heartbeat");

const RECEIPT_SCHEMA_VERSION = 1;
const HEARTBEAT_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 60 * 1000;

/** @returns {string} `~/.jfrog/skills-cache` */
function cacheDir() {
  return path.join(homedir(), ".jfrog", "skills-cache");
}

/** @returns {string} path to the heartbeat receipt */
export function heartbeatReceiptPath() {
  return path.join(cacheDir(), "apr-heartbeat-v1.json");
}

/** @param {string} serverId */
export function heartbeatLockPath(serverId) {
  const safe = String(serverId).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(cacheDir(), `apr-heartbeat-${safe}.lock`);
}

/** @returns {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }} */
function emptyReceipt() {
  return { schemaVersion: RECEIPT_SCHEMA_VERSION, servers: {} };
}

/**
 * Normalize on-disk JSON; drop unexpected schema / junk.
 * @param {unknown} data
 * @returns {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }}
 */
export function normalizeHeartbeatReceipt(data) {
  if (
    !data ||
    typeof data !== "object" ||
    data.schemaVersion !== RECEIPT_SCHEMA_VERSION
  ) {
    return emptyReceipt();
  }
  const servers = {};
  if (data.servers && typeof data.servers === "object") {
    for (const [serverId, raw] of Object.entries(data.servers)) {
      if (!raw || typeof raw !== "object") continue;
      if (typeof raw.lastPingAt !== "string" || !raw.lastPingAt) continue;
      servers[serverId] = { lastPingAt: raw.lastPingAt };
    }
  }
  return { schemaVersion: RECEIPT_SCHEMA_VERSION, servers };
}

/**
 * @param {string} [file]
 * @returns {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }}
 */
export function readHeartbeatReceipt(file = heartbeatReceiptPath()) {
  try {
    if (!existsSync(file)) return emptyReceipt();
    return normalizeHeartbeatReceipt(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    log.debug("heartbeat receipt read failed", {
      error: err?.message ?? String(err),
    });
    return emptyReceipt();
  }
}

/**
 * @param {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }} receipt
 * @param {string} [file]
 */
export function writeHeartbeatReceipt(receipt, file = heartbeatReceiptPath()) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

/**
 * Whether a ping should fire for this serverId (no receipt or stale).
 * @param {{ servers?: Record<string, { lastPingAt?: string }> } | null} receipt
 * @param {string} serverId
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {boolean}
 */
export function shouldSendHeartbeat(receipt, serverId, opts = {}) {
  if (!serverId) return false;
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? HEARTBEAT_TTL_MS;
  const lastPingAt = receipt?.servers?.[serverId]?.lastPingAt;
  if (!lastPingAt) return true;
  const ageMs = now - new Date(lastPingAt).getTime();
  if (!Number.isFinite(ageMs)) return true;
  return ageMs >= ttlMs;
}

/**
 * Record that a heartbeat was attempted for serverId.
 * @param {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }} receipt
 * @param {string} serverId
 * @param {{ now?: number }} [opts]
 * @returns {{ schemaVersion: number, servers: Record<string, { lastPingAt: string }> }}
 */
export function recordHeartbeat(receipt, serverId, opts = {}) {
  const now = opts.now ?? Date.now();
  const root = normalizeHeartbeatReceipt(receipt);
  root.servers[serverId] = { lastPingAt: new Date(now).toISOString() };
  return root;
}

/**
 * Exclusive per-server lock (best-effort across processes).
 * @param {string} serverId
 * @param {{ now?: number, lockPath?: string }} [opts]
 * @returns {{ unlock: () => void } | null}
 */
export function tryAcquireHeartbeatLock(serverId, opts = {}) {
  const now = opts.now ?? Date.now();
  const lockPath = opts.lockPath ?? heartbeatLockPath(serverId);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${now}\n`);
    return {
      unlock() {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    if (err?.code !== "EEXIST") {
      log.debug("heartbeat lock open failed", {
        error: err?.message ?? String(err),
      });
      return null;
    }
    // Stale lock from a crashed process — reclaim.
    try {
      const age = now - Number(readFileSync(lockPath, "utf8").trim());
      if (Number.isFinite(age) && age >= LOCK_STALE_MS) {
        unlinkSync(lockPath);
        return tryAcquireHeartbeatLock(serverId, opts);
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Detached `jf rt ping --server-id <id>` with hook User-Agent.
 * Waits for spawn success vs async error before unref.
 * @param {string} serverId
 * @param {{ spawn?: typeof spawn, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<boolean>} true if the process started
 */
export function spawnHeartbeatPing(serverId, opts = {}) {
  const spawnImpl = opts.spawn ?? spawn;
  const env = opts.env ?? process.env;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let child;
    try {
      child = spawnImpl("jf", ["rt", "ping", "--server-id", serverId], {
        detached: true,
        stdio: "ignore",
        env: envWithHookUserAgent(env),
      });
    } catch (err) {
      log.warn("heartbeat ping spawn threw", {
        serverId,
        error: err?.message ?? String(err),
      });
      finish(false);
      return;
    }
    child.once?.("error", (err) => {
      log.warn("heartbeat ping spawn error", {
        serverId,
        error: err?.message ?? String(err),
      });
      finish(false);
    });
    child.once?.("spawn", () => {
      child.unref?.();
      finish(true);
    });
    // Some doubles only expose EventEmitter without 'spawn'; settle soon.
    setImmediate(() => {
      if (!settled) {
        child.unref?.();
        finish(true);
      }
    });
  });
}

/**
 * Best-effort daily heartbeat. Never throws.
 * @param {{
 *   getIdentity?: () => { serverId?: string | null } | null,
 *   readReceipt?: () => ReturnType<typeof readHeartbeatReceipt>,
 *   writeReceipt?: (r: ReturnType<typeof readHeartbeatReceipt>) => void,
 *   spawnPing?: (serverId: string) => boolean | Promise<boolean>,
 *   acquireLock?: (serverId: string) => { unlock: () => void } | null,
 *   now?: number,
 *   ttlMs?: number,
 * }} [deps]
 * @returns {Promise<{ sent: boolean, reason: string, serverId?: string }> | { sent: boolean, reason: string, serverId?: string }}
 */
export function maybeSendAprHeartbeat(deps = {}) {
  try {
    const getIdentity =
      deps.getIdentity ?? (() => getPlatformIdentity().identity);
    const identity = getIdentity();
    if (!identity) {
      log.debug("heartbeat skip: no identity");
      return { sent: false, reason: "no-identity" };
    }
    const serverId =
      typeof identity.serverId === "string" && identity.serverId
        ? identity.serverId
        : null;
    if (!serverId) {
      log.debug("heartbeat skip: no serverId");
      return { sent: false, reason: "no-server-id" };
    }

    const readReceipt = deps.readReceipt ?? readHeartbeatReceipt;
    const writeReceipt = deps.writeReceipt ?? writeHeartbeatReceipt;
    const spawnPing = deps.spawnPing ?? ((id) => spawnHeartbeatPing(id));
    const acquireLock =
      deps.acquireLock ??
      ((id) => tryAcquireHeartbeatLock(id, { now: deps.now }));
    const now = deps.now ?? Date.now();
    const ttlMs = deps.ttlMs ?? HEARTBEAT_TTL_MS;

    const receipt = readReceipt();
    if (!shouldSendHeartbeat(receipt, serverId, { now, ttlMs })) {
      log.debug("heartbeat skip: fresh receipt", { serverId });
      return { sent: false, reason: "fresh", serverId };
    }

    const lock = acquireLock(serverId);
    if (!lock) {
      log.debug("heartbeat skip: lock held", { serverId });
      return { sent: false, reason: "locked", serverId };
    }

    /** @type {ReturnType<typeof readHeartbeatReceipt>} */
    let priorReceipt;
    try {
      // Re-check under lock — another process may have claimed.
      priorReceipt = readReceipt();
      if (!shouldSendHeartbeat(priorReceipt, serverId, { now, ttlMs })) {
        log.debug("heartbeat skip: fresh under lock", { serverId });
        return { sent: false, reason: "fresh", serverId };
      }
      writeReceipt(recordHeartbeat(priorReceipt, serverId, { now }));
    } finally {
      // Lock covers the claim only; spawn runs unlocked.
      lock.unlock();
    }

    const rollback = () => {
      try {
        writeReceipt(priorReceipt);
      } catch (err) {
        log.warn("heartbeat receipt rollback failed", {
          serverId,
          error: err?.message ?? String(err),
        });
      }
    };

    try {
      const started = spawnPing(serverId);
      const finish = (ok) => {
        if (!ok) {
          rollback();
          return { sent: false, reason: "spawn-failed", serverId };
        }
        log.debug("heartbeat ping spawned", { serverId });
        return { sent: true, reason: "spawned", serverId };
      };

      if (started && typeof started.then === "function") {
        return started.then(finish).catch((err) => {
          log.warn("heartbeat ping spawn failed", {
            serverId,
            error: err?.message ?? String(err),
          });
          rollback();
          return { sent: false, reason: "spawn-failed", serverId };
        });
      }
      return finish(Boolean(started));
    } catch (err) {
      log.warn("heartbeat ping spawn failed", {
        serverId,
        error: err?.message ?? String(err),
      });
      rollback();
      return { sent: false, reason: "spawn-failed", serverId };
    }
  } catch (err) {
    log.warn("maybeSendAprHeartbeat failed", {
      error: err?.message ?? String(err),
    });
    return { sent: false, reason: "error" };
  }
}
