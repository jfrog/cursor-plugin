// APR status file — "is the hook installed and firing on this machine?"
//
// Rewritten on every SessionStart (except the kill switch) so a developer,
// jfrog-skills, or `configure.mjs` can confirm APR is live without a debug log.
// It records what this run already decided — mode, resolved repos, and the
// eager-setup receipts — and never inspects package-manager config files.
// Whether a package manager still points at Artifactory (valid / drifted) is
// `jf setup <pm> --status`, not this file.
//
// File: ~/.jfrog/skills-cache/apr-status-v1.json
//   {
//     "schemaVersion": 1,
//     "lastFiredAt": "2026-10-01T06:00:00.000Z",
//     "harness": "cursor",
//     "hooksVersion": "0.9.0",
//     "mode": "routing",
//     "reason": "jf-config",
//     "configureCommand": "/abs/path/to/configure.mjs",
//     "serverId": "my-server",
//     "types": {
//       "npm":  { "repoKey": "npm-virtual",
//                 "setup": { "npm": { "status": "ok", "repoKey": "npm-virtual",
//                                     "configuredAt": "..." } } },
//       "pypi": { "repoKey": null }
//     }
//   }
//
// `pending` mode adds `cause` (jf-not-installed, jf-not-configured,
// jf-unsupported-auth, jf-auth-failed, insecure-url) — `reason` alone is always
// "missing-identity" there and doesn't say what to fix.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { createLogger } from "../../core/logger.mjs";
import { getPlatformIdentity } from "../../core/jf-identity.mjs";
import { hooksPackageVersion } from "../../core/jf-user-agent.mjs";
import { configureCommandPath } from "./onboarding.mjs";
import { governedPackageTypes, resolve as resolveRepo } from "./resolver.mjs";
import { readReceipt, receiptEntry } from "./eager-setup-receipt.mjs";
import { packageManagersForType } from "./package-manager-family.mjs";

const log = createLogger("apr-status");

export const APR_STATUS_SCHEMA_VERSION = 1;

/** @returns {string} absolute path to the status file */
export function aprStatusFilePath() {
  return path.join(homedir(), ".jfrog", "skills-cache", "apr-status-v1.json");
}

/**
 * Per-type summary of what APR did this session. Only package managers with a
 * receipt entry for `serverId` appear under `setup`.
 * @param {{
 *   governed: string[],
 *   resolved: Record<string, { repoKey: string }>,
 *   receipt: object,
 *   serverId: string,
 * }} input
 * @returns {Record<string, { repoKey: string|null, setup?: Record<string, { status: string, repoKey: string, configuredAt: string|null }> }>}
 */
export function summarizeTypes({ governed, resolved, receipt, serverId }) {
  const types = {};
  for (const type of governed) {
    const repoKey = resolved[type]?.repoKey ?? null;
    const setup = {};
    for (const packageManager of packageManagersForType(type)) {
      const entry = receiptEntry(receipt, serverId, packageManager);
      if (!entry) continue;
      setup[packageManager] = {
        status: entry.status,
        repoKey: entry.repoKey,
        configuredAt: entry.configuredAt,
      };
    }
    types[type] = Object.keys(setup).length ? { repoKey, setup } : { repoKey };
  }
  return types;
}

/**
 * Collect the routing-only fields (serverId + per-type summary). Uses the
 * resolver's per-session cache, so this re-reads what render already resolved.
 * @returns {Promise<{ serverId?: string, types: object }>}
 */
async function routingSummary() {
  const identity = getPlatformIdentity().identity;
  const serverId = identity?.serverId ?? "default";
  const governed = governedPackageTypes();
  const resolved = {};
  for (const type of governed) {
    const r = await resolveRepo(type);
    if (r) resolved[type] = r;
  }
  const receipt = await readReceipt();
  return {
    serverId,
    types: summarizeTypes({ governed, resolved, receipt, serverId }),
  };
}

/**
 * @param {{
 *   harness?: string,
 *   mode: string,
 *   reason?: string,
 *   cause?: string,
 *   serverId?: string,
 *   types?: object,
 *   now?: number,
 * }} input
 * @returns {object}
 */
export function buildAprStatus({
  harness,
  mode,
  reason,
  cause,
  serverId,
  types,
  now = Date.now(),
}) {
  return {
    schemaVersion: APR_STATUS_SCHEMA_VERSION,
    lastFiredAt: new Date(now).toISOString(),
    harness: harness ?? null,
    hooksVersion: hooksPackageVersion(),
    mode,
    reason: reason ?? null,
    ...(mode === "pending" && cause ? { cause } : {}),
    configureCommand: configureCommandPath(),
    ...(serverId ? { serverId } : {}),
    types: types ?? {},
  };
}

/**
 * Atomic write (temp file + rename) so a concurrent reader never sees a
 * half-written file. Overwrites whatever is there, parseable or not.
 * @param {object} status
 * @param {string} [file]
 */
export function writeAprStatus(status, file = aprStatusFilePath()) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, "utf8");
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
 * Record this SessionStart in the status file. Never throws — the status file
 * must not break injection. Callers skip it under the kill switch.
 * @param {{ ide?: string }} ctx
 * @param {{ mode: string, reason?: string, cause?: string }} flag
 * @returns {Promise<{ written: boolean }>}
 */
export async function recordAprStatus(ctx, flag) {
  try {
    const routing = flag.mode === "routing" ? await routingSummary() : {};
    writeAprStatus(
      buildAprStatus({
        harness: ctx?.ide,
        mode: flag.mode,
        reason: flag.reason,
        cause: flag.cause,
        ...routing,
      }),
    );
    return { written: true };
  } catch (err) {
    log.warn("apr status write failed", {
      error: err?.message ?? String(err),
    });
    return { written: false };
  }
}
