// Eager-setup receipt — durable "already configured via `jf setup`" ledger.
//
// `jf setup` mutates USER-GLOBAL PM config (`~/.npmrc`, `~/.docker/config.json`,
// …), not per-workspace state, so the skip decision keys on `serverId + type`
// (NOT workspace). This is a dedicated file — separate from the resolver cache
// (different key granularity + invalidation; the resolver's normalizer would
// strip these co-located fields).
//
// File: ~/.jfrog/skills-cache/package-setup.json
//   {
//     "schemaVersion": 1,
//     "servers": {
//       "<serverId>": {
//         "url": "https://corp.jfrog.io",
//         "npm": { "repoKey": "npm-virtual", "status": "ok", "configuredAt": "..." }
//       }
//     }
//   }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { createLogger } from "../../core/logger.mjs";

const log = createLogger("eager-setup-receipt");

const RECEIPT_SCHEMA_VERSION = 1;

// Reserved key inside a server entry (everything else is a package-type entry).
const RESERVED_KEYS = new Set(["url"]);

function cacheDir() {
  return path.join(homedir(), ".jfrog", "skills-cache");
}

function receiptFile() {
  return path.join(cacheDir(), "package-setup.json");
}

function normalizeTypeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.repoKey !== "string" || !entry.repoKey) return null;
  const status =
    entry.status === "ok" || entry.status === "failed"
      ? entry.status
      : "failed";
  return {
    repoKey: entry.repoKey,
    status,
    configuredAt:
      typeof entry.configuredAt === "string" ? entry.configuredAt : null,
    ...(entry.reason ? { reason: String(entry.reason).slice(0, 500) } : {}),
  };
}

/** Normalize raw on-disk JSON to `{ schemaVersion, servers }`; drop junk. */
export function normalizeReceipt(data) {
  const servers = {};
  if (
    data &&
    typeof data === "object" &&
    data.servers &&
    typeof data.servers === "object"
  ) {
    for (const [serverId, raw] of Object.entries(data.servers)) {
      if (!raw || typeof raw !== "object") continue;
      const entry = {};
      if (typeof raw.url === "string" && raw.url) entry.url = raw.url;
      for (const [key, val] of Object.entries(raw)) {
        if (RESERVED_KEYS.has(key)) continue;
        const norm = normalizeTypeEntry(val);
        if (norm) entry[key] = norm;
      }
      servers[serverId] = entry;
    }
  }
  return { schemaVersion: RECEIPT_SCHEMA_VERSION, servers };
}

export async function readReceipt() {
  try {
    const raw = await readFile(receiptFile(), "utf8");
    return normalizeReceipt(JSON.parse(raw));
  } catch {
    return { schemaVersion: RECEIPT_SCHEMA_VERSION, servers: {} };
  }
}

export async function writeReceipt(root) {
  const file = receiptFile();
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      { schemaVersion: RECEIPT_SCHEMA_VERSION, servers: root.servers ?? {} },
      null,
      2,
    ),
  );
}

// Receipt freshness. A recorded result (ok OR failed) is trusted for `ttlDays`.
// `ttlDays <= 0` means "no time-based re-run" — the entry only becomes stale on
// a repoKey/server change, never on a timer. (This differs from the resolver
// cache, where 0 forces a cheap re-resolve every session; re-running `jf setup`
// every session would thrash user-global PM config, so 0 here means unbounded.)
function receiptWithinTtl(configuredAt, ttlDays) {
  if (!configuredAt) return false;
  if (typeof ttlDays !== "number" || !Number.isFinite(ttlDays) || ttlDays <= 0)
    return true;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(configuredAt).getTime();
  return age >= 0 && age < ttlMs;
}

/**
 * Decide whether `jf setup` can be SKIPPED for one (serverId, type).
 *
 * A recorded result — success OR failure — is trusted for `ttlDays` (the unified
 * `cacheTtlDays`). So a persistent failure is retried at most once per TTL
 * window instead of every session, but a fixed repoKey/server retries at once.
 *
 * @returns {{ skip: boolean, reason: string }}
 *   reasons that RUN:  no-receipt | server-url-changed | no-entry |
 *                      repokey-changed | ttl-expired | failed-retry
 *   reasons that SKIP: receipt-hit (ok) | failed-deferred (failed, still fresh)
 */
export function evaluateSetupNeed(
  receipt,
  { serverId, url, type, repoKey, ttlDays },
) {
  const server = receipt?.servers?.[serverId];
  if (!server) return { skip: false, reason: "no-receipt" };
  if (url && server.url && server.url !== url)
    return { skip: false, reason: "server-url-changed" };
  const entry = server[type];
  if (!entry) return { skip: false, reason: "no-entry" };
  // A changed repo key means the admin/workspace fixed the target — retry now,
  // whether the previous result was ok or failed.
  if (entry.repoKey !== repoKey)
    return { skip: false, reason: "repokey-changed" };
  if (!receiptWithinTtl(entry.configuredAt, ttlDays))
    return {
      skip: false,
      reason: entry.status === "ok" ? "ttl-expired" : "failed-retry",
    };
  // Fresh + unchanged: skip. Surface failures separately so the caller can tell
  // "already configured" from "still failing, deferred until the TTL elapses".
  if (entry.status !== "ok") return { skip: true, reason: "failed-deferred" };
  return { skip: true, reason: "receipt-hit" };
}

/** Read the recorded entry for (serverId, type), or null. */
export function receiptEntry(receipt, serverId, type) {
  return receipt?.servers?.[serverId]?.[type] ?? null;
}

/**
 * Merge a single setup result into the receipt object (in place) and return it.
 * Only status "ok" marks a success; failures are recorded (not as ok) so the
 * next session can surface + retry them.
 */
export function applySetupResult(
  root,
  { serverId, url, type, repoKey, status, reason },
) {
  if (!root.servers) root.servers = {};
  const server = root.servers[serverId] ?? {};
  if (url) server.url = url;
  server[type] = {
    repoKey,
    status: status === "ok" ? "ok" : "failed",
    configuredAt: new Date().toISOString(),
    ...(reason ? { reason: String(reason).slice(0, 500) } : {}),
  };
  root.servers[serverId] = server;
  log.debug("receipt entry staged", { serverId, type, repoKey, status });
  return root;
}
