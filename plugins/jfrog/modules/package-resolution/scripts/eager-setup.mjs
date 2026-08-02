// Eager `jf setup` — "auto setup on startup".
//
// Two roles in one file:
//   1. ORCHESTRATOR (foreground, imported by index.mjs): after resolution,
//      figure out which governed + `autoSetup` + resolved types still
//      need `jf setup` (per the receipt), spawn a DETACHED background worker for
//      them, and return a short status note for the injected instruction. Never
//      runs `jf setup` itself — injection must stay fast (< 7s hook budget).
//   2. WORKER (background, `node eager-setup.mjs --run <payload>`): take a
//      global lock, re-check the receipt, run `jf setup <package-manager> --server-id --repo`
//      one package manager at a time with a per-package-manager timeout, and
//      record each result. `jf setup` mutates USER-GLOBAL package-manager
//      config, so this is serialized across sessions.
//
// `jf setup` validates the repo itself (`GET /api/repositories/<key>` + non-zero
// exit on bad repo / missing permission), so it is the authoritative check — no
// separate pre-setup GET here, and eligibility does NOT require `verifyRepos`.

import { spawn, spawnSync } from "node:child_process";
import {
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createLogger } from "../../core/logger.mjs";
import {
  loadAgentsConfig,
  isAutoSetup,
} from "../../core/agents-config.mjs";
import { getPlatformIdentity } from "../../core/jf-identity.mjs";
import {
  prepareSessionResolve,
  resolve as resolveRepo,
  governedPackageTypes,
} from "./resolver.mjs";
import {
  readReceipt,
  writeReceipt,
  evaluateSetupNeed,
  applySetupResult,
} from "./eager-setup-receipt.mjs";
import {
  TYPE_TO_PACKAGE_MANAGERS,
  packageManagersForType,
  packageManagerBinaryOnPath,
} from "./package-manager-family.mjs";

const log = createLogger("eager-setup");

/** Ceiling for Option C fan-out — used when lock metadata lacks `jobCount`. */
const MAX_PACKAGE_MANAGER_JOBS = Object.values(TYPE_TO_PACKAGE_MANAGERS).reduce(
  (n, family) => n + family.length,
  0,
);

/** Actionable hint when autoSetup names a type that isn't governed. */
function ungovernedAutoSetupHint(type) {
  return (
    `trying to eager-configure '${type}' via autoSetup but it is not ` +
    "governed — no repo found in defaultGlobalRepos " +
    "(~/.jfrog/agents-conf.json) or repositories in " +
    ".jfrog/local/package-resolution.json"
  );
}

/** Per-package-manager `jf setup` spawn timeout (ms). */
const PER_PACKAGE_MANAGER_TIMEOUT_MS = 60_000;

/** @returns {string} `~/.jfrog/skills-cache` */
function cacheDir() {
  return path.join(homedir(), ".jfrog", "skills-cache");
}

/** @returns {string} path to the global eager-setup lock file */
function lockFile() {
  return path.join(cacheDir(), "package-setup.lock");
}

/** @returns {string} absolute path to this module (worker entry) */
function workerPath() {
  return fileURLToPath(new URL("./eager-setup.mjs", import.meta.url));
}

// ---------------------------------------------------------------------------
// Orchestrator (foreground)
// ---------------------------------------------------------------------------

/**
 * Compute eligible eager-setup jobs = governed ∩ resolved ∩ autoSetup,
 * expanded to one job per package manager in that type's family (Option C).
 * Warns when `autoSetup` names an ungoverned type (ignored, not fatal).
 * Binary presence and `jf setup --help` are checked later (orchestrator/worker).
 * @param {string[]} governed
 * @param {Record<string, {repoKey:string}>} resolvedByType
 * @returns {{type:string, repoKey:string, packageManager:string}[]}
 */
export function computeEligibleJobs(governed, resolvedByType) {
  const governedSet = new Set(governed);
  const jobs = [];
  for (const type of governed) {
    if (!isAutoSetup(type)) continue;
    const r = resolvedByType[type];
    if (!r) {
      log.debug("eager skip: auto-setup but unresolved", { type });
      continue;
    }
    const packageManagers = packageManagersForType(type);
    if (!packageManagers.length) {
      log.warn("eager skip: no jf package-manager family mapping", { type });
      continue;
    }
    for (const packageManager of packageManagers) {
      jobs.push({ type, repoKey: r.repoKey, packageManager });
    }
  }
  // Surface admin misconfig: autoSetup naming a type that isn't governed.
  const { autoSetup } = loadAgentsConfig().packageResolution;
  if (Array.isArray(autoSetup)) {
    for (const type of autoSetup) {
      if (!governedSet.has(type)) {
        log.warn(`eager setup skipped: ${ungovernedAutoSetupHint(type)}`, {
          type,
        });
      }
    }
  }
  return jobs;
}

/**
 * Build the injected zero-touch status note (package-manager names, not Artifactory types).
 * @param {{
 *   configured: string[],
 *   pending: string[],
 *   deferred: string[],
 *   skippedMissing?: string[],
 *   setupBusy?: boolean,
 * }} parts
 * @returns {string} markdown note or ""
 */
function statusNote({
  configured,
  pending,
  deferred,
  skippedMissing,
  setupBusy,
}) {
  const parts = [];
  if (setupBusy && pending.length) {
    parts.push(
      `zero-touch deferred (another jf setup is in progress) — will retry next session: ${pending.join(", ")}`,
    );
  } else if (pending.length) {
    parts.push(
      `configuring in the background via \`jf setup\`: ${pending.join(", ")}`,
    );
  }
  if (configured.length) {
    parts.push(
      `already configured (cached, skipping re-setup): ${configured.join(", ")}`,
    );
  }
  if (deferred.length) {
    parts.push(
      `previously failed for ${deferred.join(", ")} — will retry after the cache ` +
        `expires or once the repo/permission is fixed`,
    );
  }
  if (skippedMissing?.length) {
    parts.push(
      `skipped (package manager binary not on PATH): ${skippedMissing.join(", ")}`,
    );
  }
  if (!parts.length) return "";
  return `> **Zero-touch package-manager setup** — ${parts.join("; ")}.`;
}

/**
 * Sync-mode `spawnSync` timeout for the eager-setup worker.
 * Scales with job count so Option C multi-package-manager runs are not killed mid-way.
 * @param {number} jobCount number of `jf setup` jobs in the payload
 * @returns {number} timeout in milliseconds
 */
export function syncWorkerTimeoutMs(jobCount) {
  return Math.max(
    120_000,
    PER_PACKAGE_MANAGER_TIMEOUT_MS * Math.max(jobCount, 1) + 30_000,
  );
}

/**
 * Spawn the background eager-setup worker (detached) or run it synchronously
 * when `JFROG_EAGER_SETUP_SYNC=1`.
 * @param {string} payloadB64 base64 JSON `{ serverId, url, jobs }`
 * @param {number} [jobCount=1] used to size the sync-mode timeout
 * @returns {void}
 */
function spawnWorker(payloadB64, jobCount = 1) {
  // Synchronous mode: deterministic tests + a bounded fallback where detached
  // survival is unreliable. Otherwise spawn detached and unref so the child
  // outlives the hook process (runtime is irrelevant to the 7s budget).
  if (process.env.JFROG_EAGER_SETUP_SYNC === "1") {
    spawnSync(process.execPath, [workerPath(), "--run", payloadB64], {
      stdio: "ignore",
      env: process.env,
      timeout: syncWorkerTimeoutMs(jobCount),
    });
    return;
  }
  try {
    const child = spawn(process.execPath, [workerPath(), "--run", payloadB64], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  } catch (err) {
    log.warn("failed to spawn eager-setup worker", {
      error: err?.message ?? String(err),
    });
  }
}

/**
 * Foreground entry called from sessionStart (routing mode only). Decides which
 * governed+auto-setup+resolved types need `jf setup`, spawns the background worker
 * if any do, and returns a status note for the injected instruction ("" if
 * nothing to say). Never throws — eager setup must never break injection.
 * @param {{ workspaceRoots?: string[] }} ctx
 * @returns {Promise<string>}
 */
export async function orchestrateEagerSetup(ctx = {}) {
  try {
    const identity = getPlatformIdentity().identity;
    if (!identity) return "";

    await prepareSessionResolve({ workspaceRoots: ctx.workspaceRoots });
    const governed = governedPackageTypes();
    const resolvedByType = {};
    for (const type of governed) {
      const r = await resolveRepo(type);
      if (r) resolvedByType[type] = r;
    }

    const jobs = computeEligibleJobs(governed, resolvedByType);
    if (!jobs.length) return "";

    const { cacheTtlDays } = loadAgentsConfig().packageResolution;
    const receipt = await readReceipt();
    const serverId = identity.serverId ?? "default";
    const url = identity.url;

    const configured = [];
    const pending = [];
    const deferred = [];
    const skippedMissing = [];
    const toRun = [];
    for (const job of jobs) {
      // Binary probe in the orchestrator so the injected note can list skips
      // before the detached worker runs (PATH walk — no spawn). Worker re-checks.
      if (!packageManagerBinaryOnPath(job.packageManager)) {
        skippedMissing.push(job.packageManager);
        log.warn("eager skip: package manager binary not on PATH", {
          type: job.type,
          packageManager: job.packageManager,
        });
        continue;
      }
      const need = evaluateSetupNeed(receipt, {
        serverId,
        url,
        packageManager: job.packageManager,
        repoKey: job.repoKey,
        ttlDays: cacheTtlDays,
      });
      if (need.skip) {
        // "failed-deferred" = a still-failing entry within its TTL: don't retry
        // this session (no jf setup, no WARN), but surface it in the note.
        if (need.reason === "failed-deferred") deferred.push(job.packageManager);
        else configured.push(job.packageManager);
        continue;
      }
      pending.push(job.packageManager);
      toRun.push(job);
      log.debug("eager setup needed", {
        type: job.type,
        packageManager: job.packageManager,
        repoKey: job.repoKey,
        reason: need.reason,
      });
    }

    let setupBusy = false;
    if (toRun.length) {
      if (isLiveLockHeld()) {
        setupBusy = true;
        log.warn(
          "eager-setup deferred: another jf setup worker holds the lock",
          { pendingJobCount: toRun.length },
        );
      } else {
        const payload = Buffer.from(
          JSON.stringify({ serverId, url, jobs: toRun }),
          "utf8",
        ).toString("base64");
        spawnWorker(payload, toRun.length);
      }
    }

    return statusNote({
      configured,
      pending,
      deferred,
      skippedMissing,
      setupBusy,
    });
  } catch (err) {
    log.warn("orchestrateEagerSetup failed", {
      error: err?.message ?? String(err),
    });
    return "";
  }
}

// ---------------------------------------------------------------------------
// Lock (worker-only, best-effort, one global lock)
// ---------------------------------------------------------------------------

/**
 * Max age before an eager-setup lock is treated as stale and reclaimable.
 * Scales with the owner's job count (+30s buffer, same as {@link syncWorkerTimeoutMs}).
 * Floor at 120s.
 * @param {number} ownerJobCount owner job count (from lock metadata)
 * @returns {number} milliseconds
 */
export function staleThresholdMs(ownerJobCount) {
  return Math.max(
    PER_PACKAGE_MANAGER_TIMEOUT_MS * Math.max(ownerJobCount, 1) + 30_000,
    120_000,
  );
}

/**
 * Job count that governs staleness for an existing lock — the **owner's** count
 * from lock metadata, not the contender's. Missing/invalid → conservative max
 * so a long Option C run cannot be reclaimed early by a 1-job contender.
 * @param {{ jobCount?: unknown } | null} meta
 * @returns {number}
 */
export function lockOwnerJobCount(meta) {
  const n = meta?.jobCount;
  if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
    return Math.min(Math.floor(n), MAX_PACKAGE_MANAGER_JOBS);
  }
  return MAX_PACKAGE_MANAGER_JOBS;
}

/**
 * @param {number} pid
 * @returns {boolean} true if the process appears to exist
 */
function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // exists but not ours
  }
}

/**
 * @returns {{ pid?: number, hostname?: string, serverId?: string, jobCount?: number, startedAt?: string } | null}
 */
function readLock() {
  try {
    return JSON.parse(readFileSync(lockFile(), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Whether a lock may be reclaimed. Uses the lock owner's jobCount
 * (see {@link lockOwnerJobCount}), not the contender's.
 * @param {{ pid?: number, hostname?: string, jobCount?: number, startedAt?: string } | null} meta
 * @returns {boolean}
 */
function isStaleLock(meta) {
  if (!meta) return true;
  const ageMs = Date.now() - new Date(meta.startedAt ?? 0).getTime();
  // Non-finite age (invalid/missing startedAt → NaN) is reclaimable — same as
  // epoch/missing. Otherwise a corrupt startedAt would never age-stale.
  if (
    !Number.isFinite(ageMs) ||
    ageMs >= staleThresholdMs(lockOwnerJobCount(meta))
  ) {
    return true;
  }
  if (meta.hostname === hostname() && !pidAlive(meta.pid)) return true;
  return false;
}

/**
 * Atomically create the lock file (O_CREAT|O_EXCL). Throws if held (EEXIST).
 * @param {string} serverId
 * @param {number} jobCount persisted for contenders' stale checks
 */
function tryWriteLock(serverId, jobCount) {
  const fd = openSync(lockFile(), "wx");
  try {
    const meta = {
      pid: process.pid,
      hostname: hostname(),
      serverId,
      jobCount: Math.max(jobCount, 1),
      startedAt: new Date().toISOString(),
    };
    writeSync(fd, JSON.stringify(meta));
  } finally {
    closeSync(fd);
  }
}

/**
 * Acquire the global lock. Returns true on success. On live contention → false
 * (skip, don't wait). On a stale lock → reclaim + retry once.
 * @param {string} serverId
 * @param {number} jobCount this worker's job count (persisted for contenders)
 */
function acquireLock(serverId, jobCount) {
  mkdirSync(cacheDir(), { recursive: true });
  try {
    tryWriteLock(serverId, jobCount);
    log.debug("lock acquired", { pid: process.pid, jobCount });
    return true;
  } catch (err) {
    if (err?.code !== "EEXIST") {
      log.warn("lock open failed", { error: err?.message ?? String(err) });
      return false;
    }
  }
  const existing = readLock();
  if (!isStaleLock(existing)) {
    log.warn("eager-setup skipped: another jf setup worker holds the lock", {
      owner: existing?.pid,
      ownerJobCount: lockOwnerJobCount(existing),
      startedAt: existing?.startedAt,
      hostname: existing?.hostname,
    });
    return false;
  }
  log.debug("reclaiming stale lock", {
    owner: existing?.pid,
    startedAt: existing?.startedAt,
  });
  try {
    unlinkSync(lockFile());
  } catch {
    // someone else may have removed it — fall through to re-acquire
  }
  try {
    tryWriteLock(serverId, jobCount);
    log.debug("lock acquired after reclaim", { pid: process.pid, jobCount });
    return true;
  } catch {
    log.warn("eager-setup skipped: lost race to re-acquire lock");
    return false;
  }
}

/**
 * True when a non-stale eager-setup lock file is held (best-effort probe).
 * @returns {boolean}
 */
function isLiveLockHeld() {
  try {
    if (!existsSync(lockFile())) return false;
    return !isStaleLock(readLock());
  } catch {
    return false;
  }
}

/**
 * Best-effort unlock after the worker finishes (or fails).
 * Only unlinks when this process still owns the lock — a contender may have
 * reclaimed an age-stale lock while we were still running; deleting theirs
 * would drop mutual exclusion.
 * Exported for unit tests of the ownership guard.
 */
export function releaseLock() {
  try {
    const meta = readLock();
    if (!meta) return;
    if (meta.pid !== process.pid || meta.hostname !== hostname()) {
      log.debug("lock not owned; skip release", {
        pid: process.pid,
        owner: meta.pid,
        ownerHostname: meta.hostname,
      });
      return;
    }
    unlinkSync(lockFile());
    log.debug("lock released", { pid: process.pid });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Worker (background)
// ---------------------------------------------------------------------------

/**
 * Parse the `Supported package managers are: a, b, c` line from `jf setup --help`.
 * @returns {Set<string>|null} lowercase tokens, or null if help could not be parsed
 */
function supportedPackageManagers() {
  try {
    const res = spawnSync("jf", ["setup", "--help"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const m = out.match(/Supported package managers are:\s*([^\n]+)/i);
    if (!m) return null;
    return new Set(
      m[1]
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    return null;
  }
}

/**
 * Distill `jf setup` output into a concise cause. Keeps `[Error]`/`[Fatal]`
 * lines (prefix stripped), else the trimmed tail.
 * @param {string|null|undefined} stdout
 * @param {string|null|undefined} stderr
 * @returns {string}
 */
function extractJfError(stdout, stderr) {
  const raw = `${stdout ?? ""}\n${stderr ?? ""}`;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const stripPrefix = (l) =>
    l.replace(/^\d{1,2}:\d{2}:\d{2}\s+\[(?:Error|Fatal)\]\s*/i, "").trim();
  const errors = lines
    .filter((l) => /\[(?:Error|Fatal)\]/i.test(l))
    .map(stripPrefix)
    .filter(Boolean);
  const detail = errors.length ? errors.join("; ") : (lines.at(-1) ?? "");
  return detail.slice(0, 300);
}

/**
 * Run `jf setup <packageManager> --server-id --repo` with a per-PM timeout.
 * @param {string} packageManager
 * @param {string} serverId
 * @param {string} repoKey
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function runJfSetup(packageManager, serverId, repoKey) {
  const args = ["setup", packageManager, "--server-id", serverId, "--repo", repoKey];
  const res = spawnSync("jf", args, {
    encoding: "utf8",
    timeout: PER_PACKAGE_MANAGER_TIMEOUT_MS,
  });
  if (res.error) {
    return { ok: false, reason: `spawn error: ${res.error.message}` };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      reason: `exit ${res.status}: ${extractJfError(res.stdout, res.stderr)}`,
    };
  }
  return { ok: true };
}

/**
 * Background worker body. Acquire lock → re-check receipt → `jf setup` per job →
 * record results → release lock. Best-effort; never throws to the caller.
 * @param {{ serverId:string, url:string, jobs:{type:string,repoKey:string,packageManager:string}[] }} payload
 */
export async function runWorker(payload) {
  const { serverId, url, jobs } = payload;
  if (!Array.isArray(jobs) || !jobs.length) return;

  if (!acquireLock(serverId, jobs.length)) return;
  try {
    const { cacheTtlDays } = loadAgentsConfig().packageResolution;
    // Re-read the receipt UNDER the lock — another worker may have finished
    // between the foreground spawn and this acquire.
    const root = await readReceipt();
    const supported = supportedPackageManagers();

    for (const job of jobs) {
      if (!packageManagerBinaryOnPath(job.packageManager)) {
        log.warn("worker skip: package manager binary not on PATH", {
          type: job.type,
          packageManager: job.packageManager,
        });
        continue;
      }
      const need = evaluateSetupNeed(root, {
        serverId,
        url,
        packageManager: job.packageManager,
        repoKey: job.repoKey,
        ttlDays: cacheTtlDays,
      });
      if (need.skip) {
        log.debug("worker skip: receipt fresh under lock", {
          packageManager: job.packageManager,
          reason: need.reason,
        });
        continue;
      }
      if (supported && !supported.has(job.packageManager)) {
        log.warn("worker skip: package manager unsupported by jf setup", {
          type: job.type,
          packageManager: job.packageManager,
        });
        continue;
      }

      const result = runJfSetup(job.packageManager, serverId, job.repoKey);
      if (result.ok) {
        applySetupResult(root, {
          serverId,
          url,
          packageManager: job.packageManager,
          repoKey: job.repoKey,
          status: "ok",
        });
        log.info("jf setup", {
          serverId,
          type: job.type,
          packageManager: job.packageManager,
          repoKey: job.repoKey,
          status: "ok",
        });
      } else {
        applySetupResult(root, {
          serverId,
          url,
          packageManager: job.packageManager,
          repoKey: job.repoKey,
          status: "failed",
          reason: result.reason,
        });
        log.warn("jf setup", {
          serverId,
          type: job.type,
          packageManager: job.packageManager,
          repoKey: job.repoKey,
          status: "failed",
          reason: result.reason,
        });
      }
      // Persist progress after each package manager so a crash mid-run keeps prior results.
      await writeReceipt(root);
    }
  } finally {
    releaseLock();
  }
}

// ---------------------------------------------------------------------------
// CLI entry (worker mode)
// ---------------------------------------------------------------------------

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain && process.argv[2] === "--run") {
  const b64 = process.argv[3];
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    await runWorker(payload);
  } catch (err) {
    log.warn("worker failed to parse/run payload", {
      error: err?.message ?? String(err),
    });
  }
}
