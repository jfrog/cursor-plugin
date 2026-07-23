// Eager `jf setup` — "auto setup on startup".
//
// Two roles in one file:
//   1. ORCHESTRATOR (foreground, imported by index.mjs): after resolution,
//      figure out which governed + `autoSetup` + resolved types still
//      need `jf setup` (per the receipt), spawn a DETACHED background worker for
//      them, and return a short status note for the injected instruction. Never
//      runs `jf setup` itself — injection must stay fast (< 7s hook budget).
//   2. WORKER (background, `node eager-setup.mjs --run <payload>`): take a
//      global lock, re-check the receipt, run `jf setup <pm> --server-id --repo`
//      one PM at a time with a per-PM timeout, and record each result. `jf setup`
//      mutates USER-GLOBAL PM config, so this is serialized across sessions.
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

const log = createLogger("eager-setup");

/** Actionable hint when autoSetup names a type that isn't governed. */
function ungovernedAutoSetupHint(type) {
  return (
    `trying to eager-configure '${type}' via autoSetup but it is not ` +
    "governed — no repo found in defaultGlobalRepos " +
    "(~/.jfrog/agents-conf.json) or repositories in " +
    ".jfrog/local/package-resolution.json"
  );
}

// Package type -> `jf setup` PM token. Validated at runtime against
// `jf setup --help` (support list drifts across CLI versions); unsupported
// mappings are skipped with a warn rather than hardcoded-trusted.
const TYPE_TO_PM = {
  npm: "npm",
  pypi: "pip",
  maven: "maven",
  go: "go",
  docker: "docker",
  helm: "helm",
  nuget: "nuget",
};

const PER_PM_TIMEOUT_MS = 60_000;

function cacheDir() {
  return path.join(homedir(), ".jfrog", "skills-cache");
}

function lockFile() {
  return path.join(cacheDir(), "package-setup.lock");
}

function workerPath() {
  return fileURLToPath(new URL("./eager-setup.mjs", import.meta.url));
}

// ---------------------------------------------------------------------------
// Orchestrator (foreground)
// ---------------------------------------------------------------------------

/**
 * Compute eligible eager-setup jobs = governed ∩ resolved ∩ autoSetup.
 * Warns when `autoSetup` names an ungoverned type (ignored, not fatal).
 * @param {string[]} governed
 * @param {Record<string, {repoKey:string}>} resolvedByType
 * @returns {{type:string, repoKey:string, pm:string}[]}
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
    const pm = TYPE_TO_PM[type];
    if (!pm) {
      log.warn("eager skip: no jf pm mapping", { type });
      continue;
    }
    jobs.push({ type, repoKey: r.repoKey, pm });
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

function statusNote({ configured, pending, deferred }) {
  const parts = [];
  if (pending.length) {
    parts.push(
      `configuring in the background via \`jf setup\`: ${pending.join(", ")}`,
    );
  }
  if (configured.length) {
    parts.push(`already configured this session: ${configured.join(", ")}`);
  }
  if (deferred.length) {
    parts.push(
      `previously failed for ${deferred.join(", ")} — will retry after the cache ` +
        `expires or once the repo/permission is fixed`,
    );
  }
  if (!parts.length) return "";
  return `> **Zero-touch package-manager setup** — ${parts.join("; ")}.`;
}

function spawnWorker(payloadB64) {
  // Synchronous mode: deterministic tests + a bounded fallback where detached
  // survival is unreliable. Otherwise spawn detached and unref so the child
  // outlives the hook process (runtime is irrelevant to the 7s budget).
  if (process.env.JFROG_EAGER_SETUP_SYNC === "1") {
    spawnSync(process.execPath, [workerPath(), "--run", payloadB64], {
      stdio: "ignore",
      env: process.env,
      timeout: 120_000,
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
    const toRun = [];
    for (const job of jobs) {
      const need = evaluateSetupNeed(receipt, {
        serverId,
        url,
        type: job.type,
        repoKey: job.repoKey,
        ttlDays: cacheTtlDays,
      });
      if (need.skip) {
        // "failed-deferred" = a still-failing entry within its TTL: don't retry
        // this session (no jf setup, no WARN), but surface it in the note.
        if (need.reason === "failed-deferred") deferred.push(job.type);
        else configured.push(job.type);
        continue;
      }
      pending.push(job.type);
      toRun.push(job);
      log.debug("eager setup needed", {
        type: job.type,
        repoKey: job.repoKey,
        reason: need.reason,
      });
    }

    if (toRun.length) {
      const payload = Buffer.from(
        JSON.stringify({ serverId, url, jobs: toRun }),
        "utf8",
      ).toString("base64");
      spawnWorker(payload);
    }

    return statusNote({ configured, pending, deferred });
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

// Stale threshold must exceed the total per-PM budget so a healthy long run is
// never reclaimed under it. Floor at 120s.
function staleThresholdMs(pmCount) {
  return Math.max(PER_PM_TIMEOUT_MS * Math.max(pmCount, 1), 120_000);
}

function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // exists but not ours
  }
}

function readLock() {
  try {
    return JSON.parse(readFileSync(lockFile(), "utf8"));
  } catch {
    return null;
  }
}

function isStaleLock(meta, pmCount) {
  if (!meta) return true;
  const ageMs = Date.now() - new Date(meta.startedAt ?? 0).getTime();
  if (ageMs >= staleThresholdMs(pmCount)) return true;
  if (meta.hostname === hostname() && !pidAlive(meta.pid)) return true;
  return false;
}

// Atomic create-exclusive (O_CREAT|O_EXCL); throws EEXIST if the lock is held.
function tryWriteLock(serverId) {
  const fd = openSync(lockFile(), "wx");
  try {
    const meta = {
      pid: process.pid,
      hostname: hostname(),
      serverId,
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
 */
function acquireLock(serverId, pmCount) {
  mkdirSync(cacheDir(), { recursive: true });
  try {
    tryWriteLock(serverId);
    log.debug("lock acquired", { pid: process.pid });
    return true;
  } catch (err) {
    if (err?.code !== "EEXIST") {
      log.warn("lock open failed", { error: err?.message ?? String(err) });
      return false;
    }
  }
  const existing = readLock();
  if (!isStaleLock(existing, pmCount)) {
    log.debug("lock held by live worker; skipping", { owner: existing?.pid });
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
    tryWriteLock(serverId);
    log.debug("lock acquired after reclaim", { pid: process.pid });
    return true;
  } catch {
    log.debug("lost race to re-acquire lock; skipping");
    return false;
  }
}

function releaseLock() {
  try {
    if (existsSync(lockFile())) unlinkSync(lockFile());
    log.debug("lock released", { pid: process.pid });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Worker (background)
// ---------------------------------------------------------------------------

// Parse the `Supported package managers are: a, b, c` line from `jf setup --help`.
function supportedPms() {
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

// Distill `jf setup` output into a concise cause. `jf` prints a full log dump
// (version, OS, trace id, HTTP calls) around the real error; keep only the
// `[Error]`/`[Fatal]` line(s) with their timestamp+level prefix stripped, and
// fall back to the trimmed tail when the output has no recognizable error line.
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

function runJfSetup(pm, serverId, repoKey) {
  const args = ["setup", pm, "--server-id", serverId, "--repo", repoKey];
  const res = spawnSync("jf", args, {
    encoding: "utf8",
    timeout: PER_PM_TIMEOUT_MS,
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
 * @param {{ serverId:string, url:string, jobs:{type:string,repoKey:string,pm:string}[] }} payload
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
    const supported = supportedPms();

    for (const job of jobs) {
      const need = evaluateSetupNeed(root, {
        serverId,
        url,
        type: job.type,
        repoKey: job.repoKey,
        ttlDays: cacheTtlDays,
      });
      if (need.skip) {
        log.debug("worker skip: receipt fresh under lock", {
          type: job.type,
          reason: need.reason,
        });
        continue;
      }
      if (supported && !supported.has(job.pm)) {
        log.warn("worker skip: pm unsupported by jf setup", {
          type: job.type,
          pm: job.pm,
        });
        continue;
      }

      const result = runJfSetup(job.pm, serverId, job.repoKey);
      if (result.ok) {
        applySetupResult(root, {
          serverId,
          url,
          type: job.type,
          repoKey: job.repoKey,
          status: "ok",
        });
        log.info("jf setup", {
          serverId,
          type: job.type,
          pm: job.pm,
          repoKey: job.repoKey,
          status: "ok",
        });
      } else {
        applySetupResult(root, {
          serverId,
          url,
          type: job.type,
          repoKey: job.repoKey,
          status: "failed",
          reason: result.reason,
        });
        log.warn("jf setup", {
          serverId,
          type: job.type,
          pm: job.pm,
          repoKey: job.repoKey,
          status: "failed",
          reason: result.reason,
        });
      }
      // Persist progress after each PM so a crash mid-run keeps prior results.
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
