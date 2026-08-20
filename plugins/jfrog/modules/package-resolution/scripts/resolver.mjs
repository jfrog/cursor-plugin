// Repo resolver — maps package type → Artifactory repo key (+ URL for the
// session-policy instruction injection and the jf-setup skill).
//
// Session resolution (once per hook process, per jf server id).
// Identity comes from a separate local `jf config export` (always runs; cheap).
// This module only controls Artifactory HTTP:
//   1. Valid local cache ~/.jfrog/skills-cache/package-resolution.json → no HTTP
//   2. Else read defaultGlobalRepos from ~/.jfrog/agents-conf.json
//   3. Optional verify via GET …/api/repositories/{key} (verifyRepos, default true)
//   4. Write snapshot to cache file (TTL from agents-conf.json cacheTtlDays)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { createLogger } from "../../core/logger.mjs";
import {
  getAgentsConfigMtimeMs,
  loadAgentsConfig,
  globalDeclaredTypes,
} from "../../core/agents-config.mjs";
import {
  getPlatformIdentity,
  authHeader,
  isHttpsIdentityUrl,
  safeErrorMessage,
} from "../../core/jf-identity.mjs";
import { PACKAGE_TYPES, repoMatchesPackageType } from "./repo-types.mjs";
import {
  pickWorkspaceConfigRoot,
  loadWorkspaceConfig,
} from "./workspace-config.mjs";

const log = createLogger("resolver");

function cacheDir() {
  return path.join(homedir(), ".jfrog", "skills-cache");
}

function cacheFile() {
  return path.join(cacheDir(), "package-resolution.json");
}

const CACHE_SCHEMA_VERSION = 2;
// One shared window covers admin and workspace verification. Keeping the
// window below the shortest existing harness timeout prevents sequential
// verification phases from consuming the entire SessionStart budget.
const REPO_VERIFY_BUDGET_MS = 5_000;

/** In-process snapshot after first resolve pass in this hook invocation. */
const SESSION = {
  serverId: null,
  meta: null,
  byType: null,
  workspaceDeclaredTypes: [],
  overlayPreparedFor: null,
};

function identityOrNull() {
  return getPlatformIdentity().identity;
}

function effectiveServerId(hint, identity = identityOrNull()) {
  if (hint) return hint;
  if (identity?.serverId) return identity.serverId;
  // A URL is stable for an identity with no JFrog CLI server id, unlike a
  // shared literal "default" key that can leak cache state across servers.
  return identity?.url ? `url:${identity.url}` : "default";
}

function packageResolveSource(serverId, { via } = {}) {
  const suffix = via ? ` via=${via}` : "";
  return `package-resolution:${cacheFile()}#${serverId}${suffix}`;
}

/** Last session-wide resolve metadata (for inject-instructions EVENT log). */
export function getResolveSessionMeta() {
  return SESSION.meta;
}

function urlFor(type, repoKey, base) {
  switch (type) {
    case "npm":
      return `${base}/api/npm/${repoKey}/`;
    case "pypi":
      return `${base}/api/pypi/${repoKey}/simple/`;
    case "maven":
    case "gradle":
      return `${base}/${repoKey}/`;
    case "go":
      return `${base}/api/go/${repoKey}`;
    case "docker":
      return new URL(base).host + "/" + repoKey;
    case "helm":
      return `${base}/${repoKey}/`;
    case "nuget":
      return `${base}/api/nuget/v3/${repoKey}/index.json`;
    default:
      return `${base}/${repoKey}/`;
  }
}

async function readCacheFile() {
  const file = cacheFile();
  try {
    const raw = await readFile(file, "utf8");
    return { data: JSON.parse(raw), file };
  } catch {
    return { data: null, file };
  }
}

async function writeCacheFile(root) {
  const file = cacheFile();
  const payload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    servers: root.servers ?? {},
  };
  const creating = !existsSync(file);
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(file, JSON.stringify(payload, null, 2));
  if (creating) {
    log.info("created global cache file", { cache: file });
  }
}

function normalizeServerEntry(entry) {
  if (!entry?.repositories || typeof entry.repositories !== "object")
    return null;
  return {
    repositories: { ...entry.repositories },
    cached_at: entry.cached_at,
    source: entry.source,
    agentsConfigMtimeMs: entry.agentsConfigMtimeMs,
    url: typeof entry.url === "string" ? entry.url : null,
  };
}

function isEntryFresh(entry, agentsConfigMtimeMs, cacheTtlDays, url) {
  if (!entry?.cached_at) return false;
  if (cacheTtlDays === 0) return false;
  if (entry.agentsConfigMtimeMs !== agentsConfigMtimeMs) return false;
  // Schema-1 entries have no URL. Refresh them once instead of trusting an
  // entry verified against a server the user may have switched away from.
  if (!entry.url || entry.url !== url) return false;
  const ttlMs = cacheTtlDays * 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(entry.cached_at).getTime();
  return age >= 0 && age < ttlMs;
}

/** Normalize on-disk cache to `{ schemaVersion, servers }` (migrates legacy flat layout). */
function normalizeCacheRoot(data) {
  const servers = {};
  if (!data || typeof data !== "object") {
    return { schemaVersion: CACHE_SCHEMA_VERSION, servers };
  }
  if (data.servers && typeof data.servers === "object") {
    for (const [serverId, entry] of Object.entries(data.servers)) {
      const normalized = normalizeServerEntry(entry);
      if (normalized) servers[serverId] = normalized;
    }
    return {
      schemaVersion:
        typeof data.schemaVersion === "number"
          ? data.schemaVersion
          : CACHE_SCHEMA_VERSION,
      servers,
    };
  }
  for (const [key, val] of Object.entries(data)) {
    if (key === "schemaVersion") continue;
    const normalized = normalizeServerEntry(val);
    if (normalized) servers[key] = normalized;
  }
  return { schemaVersion: CACHE_SCHEMA_VERSION, servers };
}

async function fetchRepoConfig(repoKey, id, deadline) {
  if (!id) return null;
  if (!isHttpsIdentityUrl(id)) {
    log.warn("refusing repo verify over a non-HTTPS platform URL", { repoKey });
    return null;
  }
  const url = `${id.url}/artifactory/api/repositories/${encodeURIComponent(repoKey)}`;
  // Network call on session start (cache miss + verifyRepos) — log at info so a
  // fresh session's Artifactory calls are visible without enabling debug.
  log.info("verifying repo via Artifactory API", { repoKey, url });
  const authorization = authHeader(id);
  if (!authorization) return null;
  // Bound the call so a stalled Artifactory can't hang session start.
  const controller = new AbortController();
  const remaining = Math.max(0, deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.debug("repo verify miss", { repoKey, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    log.warn("repo verify threw", {
      repoKey,
      error: safeErrorMessage(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildResolveMeta(serverId, entry, { via, cacheFile }) {
  return {
    serverId,
    source: packageResolveSource(serverId, { via }),
    cacheFile,
    resolveSource: entry.source ?? via,
    cached_at: entry.cached_at,
    cacheHit: via === "cache",
  };
}

function entryToByType(entry, base) {
  const byType = {};
  for (const [type, repoKey] of Object.entries(entry.repositories ?? {})) {
    if (!repoKey) continue;
    byType[type] = {
      type,
      repoKey,
      baseUrl: urlFor(type, repoKey, base),
    };
  }
  return byType;
}

async function refreshServerCache(
  serverId,
  id = identityOrNull(),
  verifyDeadline = Date.now() + REPO_VERIFY_BUDGET_MS,
) {
  const base = id ? `${id.url}/artifactory` : "";
  const repositories = {};
  const pr = loadAgentsConfig().packageResolution;
  const verifyRepos = pr.verifyRepos;
  const adminRepos = pr.defaultGlobalRepos ?? {};
  const agentsConfigMtimeMs = getAgentsConfigMtimeMs();
  const configured = PACKAGE_TYPES.flatMap((type) => {
    const repoKey = adminRepos[type];
    if (!repoKey) {
      log.debug("unconfigured type", { type });
      return [];
    }
    return [{ type, repoKey }];
  });
  const adminConfiguredCount = configured.length;

  if (verifyRepos) {
    // Each repository lookup is independent. Parallel verification keeps a
    // cold session within the hook's 15-second budget instead of multiplying
    // the five-second request timeout by every configured package type.
    const verified = await Promise.all(
      configured.map(async ({ type, repoKey }) => {
        const config = await fetchRepoConfig(repoKey, id, verifyDeadline);
        return {
          type,
          repoKey,
          verified: Boolean(config && repoMatchesPackageType(config, type)),
        };
      }),
    );
    for (const { type, repoKey, verified: isVerified } of verified) {
      if (!isVerified) {
        log.warn("repo verify failed", { type, repoKey, serverId });
        continue;
      }
      repositories[type] = repoKey;
      log.debug("resolved from agents-conf.json (verified)", { type, repoKey });
    }
  } else {
    for (const { type, repoKey } of configured) {
      repositories[type] = repoKey;
      log.debug("resolved from agents-conf.json (trusted)", { type, repoKey });
    }
  }

  const source = verifyRepos ? "verified" : "agents-config";

  const { data: cacheRoot, file } = await readCacheFile();
  const root = normalizeCacheRoot(cacheRoot);
  const priorEntry = root.servers[serverId];
  const priorHasRepos = Boolean(
    priorEntry?.repositories && Object.keys(priorEntry.repositories).length,
  );

  // A total verify failure (every admin-configured type failed the repo
  // check — e.g. Artifactory briefly unreachable) must not pin an empty
  // `repositories: {}` with a fresh `cached_at` for the full TTL:
  // - prior good entry → keep it (and its cached_at)
  // - no prior → skip writeCacheFile so the next session retries verify
  if (
    verifyRepos &&
    adminConfiguredCount > 0 &&
    Object.keys(repositories).length === 0
  ) {
    if (priorHasRepos) {
      log.warn(
        "repo verify failed for every configured type — keeping prior cache " +
          "entry instead of pinning an empty one",
        { serverId, configuredCount: adminConfiguredCount },
      );
      SESSION.serverId = serverId;
      SESSION.byType = entryToByType(priorEntry, base);
      SESSION.meta = buildResolveMeta(serverId, priorEntry, {
        via: "refresh-verify-failed-kept-prior",
        cacheFile: file,
      });
      return;
    }
    log.warn(
      "repo verify failed for every configured type — skipping empty cache " +
        "write so the next session retries verification",
      { serverId, configuredCount: adminConfiguredCount },
    );
    const empty = {
      repositories: {},
      cached_at: new Date().toISOString(),
      source,
      agentsConfigMtimeMs,
      url: id?.url ?? null,
    };
    SESSION.serverId = serverId;
    SESSION.byType = {};
    SESSION.meta = buildResolveMeta(serverId, empty, {
      via: "refresh-verify-failed-no-cache",
      cacheFile: file,
    });
    return;
  }

  // Partial verify failure: keep prior keys for admin-configured types that
  // failed this round so a transient blip on one type does not ungover that
  // type for the full cache TTL.
  if (verifyRepos && priorHasRepos) {
    for (const [type, repoKey] of Object.entries(priorEntry.repositories)) {
      if (repositories[type] || !adminRepos[type]) continue;
      repositories[type] = repoKey;
      log.warn("repo verify failed — keeping prior cache value for type", {
        type,
        repoKey,
        serverId,
      });
    }
  }

  const entry = {
    repositories,
    cached_at: new Date().toISOString(),
    source,
    agentsConfigMtimeMs,
    url: id?.url ?? null,
  };

  root.servers[serverId] = entry;
  await writeCacheFile(root);

  const via = verifyRepos ? "refresh-verified" : "refresh-agents-config";
  SESSION.serverId = serverId;
  SESSION.byType = entryToByType(entry, base);
  SESSION.meta = buildResolveMeta(serverId, entry, { via, cacheFile: file });
  log.debug("cache refreshed", {
    serverId,
    source,
    resolved: Object.keys(repositories).join(","),
    cache: file,
  });
}

async function loadFreshCacheEntry(serverId, id = identityOrNull()) {
  const pr = loadAgentsConfig().packageResolution;
  const agentsConfigMtimeMs = getAgentsConfigMtimeMs();
  const { data, file } = await readCacheFile();
  const entry = normalizeServerEntry(
    normalizeCacheRoot(data).servers[serverId],
  );
  if (
    !entry ||
    !isEntryFresh(entry, agentsConfigMtimeMs, pr.cacheTtlDays, id?.url ?? "")
  )
    return null;

  const base = id ? `${id.url}/artifactory` : "";
  SESSION.serverId = serverId;
  SESSION.byType = entryToByType(entry, base);
  SESSION.meta = buildResolveMeta(serverId, entry, {
    via: "cache",
    cacheFile: file,
  });
  log.debug("cache hit", {
    serverId,
    source: entry.source,
    ageMs: Date.now() - new Date(entry.cached_at).getTime(),
    cache: file,
  });
  return entry;
}

async function ensureSessionResolved(
  serverIdHint,
  verifyDeadline = Date.now() + REPO_VERIFY_BUDGET_MS,
) {
  const rawId = identityOrNull();
  if (rawId && !isHttpsIdentityUrl(rawId)) {
    log.warn("refusing to resolve package URLs over a non-HTTPS platform URL");
    SESSION.serverId = effectiveServerId(serverIdHint, rawId);
    SESSION.byType = {};
    SESSION.meta = null;
    return;
  }

  const id = rawId;
  const serverId = effectiveServerId(serverIdHint, id);
  if (SESSION.serverId === serverId && SESSION.byType) return;

  const cached = await loadFreshCacheEntry(serverId, id);
  if (cached) return;

  await refreshServerCache(serverId, id, verifyDeadline);
}

function workspaceOverlayMetaApplied(workspaceRoots, pick, overridden) {
  return {
    workspaceRootsCount: workspaceRoots.length,
    workspaceConfigFile: pick.configFile,
    workspaceOverrides: overridden.join(","),
  };
}

async function applyWorkspaceOverlay(
  workspaceRoots,
  verifyDeadline = Date.now() + REPO_VERIFY_BUDGET_MS,
) {
  SESSION.workspaceDeclaredTypes = [];
  const roots = workspaceRoots?.length ? workspaceRoots : [];
  const pick = pickWorkspaceConfigRoot(roots);

  if (!pick) return;

  const ws = await loadWorkspaceConfig(pick);
  if (ws.status === "invalid" || ws.status === "unreadable") {
    // The file exists and was meant to take effect; ignoring it silently makes
    // a typo (e.g. a trailing comma) look like a resolution failure. Warn so it
    // surfaces regardless of log level.
    log.warn("workspace config ignored", {
      reason: ws.status,
      file: pick.configFile,
      error: ws.error?.message,
    });
    return;
  }
  if (ws.status !== "ok") {
    log.debug("workspace overlay skipped", {
      reason: ws.status,
      root: pick.root,
    });
    return;
  }

  const id = identityOrNull();
  if (id && !isHttpsIdentityUrl(id)) {
    log.warn("refusing workspace overlay over a non-HTTPS platform URL");
    return;
  }
  const base = id ? `${id.url}/artifactory` : "";
  const pr = loadAgentsConfig().packageResolution;
  const overridden = [];
  const declared = [];

  const requested = Object.entries(ws.config.repositories).flatMap(
    ([type, repoKey]) => {
      if (!repoKey || !PACKAGE_TYPES.includes(type)) return [];
      return [{ type, repoKey }];
    },
  );

  const validated = pr.verifyRepos
    ? await Promise.all(
        requested.map(async ({ type, repoKey }) => {
          const config = await fetchRepoConfig(repoKey, id, verifyDeadline);
          return {
            type,
            repoKey,
            verified: Boolean(config && repoMatchesPackageType(config, type)),
          };
        }),
      )
    : requested.map(({ type, repoKey }) => ({ type, repoKey, verified: true }));

  for (const { type, repoKey, verified } of validated) {
    if (!verified) {
      log.warn("workspace repo verify failed", {
        type,
        repoKey,
        file: pick.configFile,
      });
      continue;
    }
    if (!SESSION.byType) SESSION.byType = {};
    SESSION.byType[type] = {
      type,
      repoKey,
      baseUrl: urlFor(type, repoKey, base),
    };
    overridden.push(`${type}:${repoKey}`);
    declared.push(type);
  }

  SESSION.workspaceDeclaredTypes = declared;

  if (!overridden.length) {
    log.debug("workspace overlay skipped", {
      reason: "no-repositories",
      root: pick.root,
    });
    return;
  }

  const hadGlobal = SESSION.meta?.resolveSource;
  SESSION.meta = {
    ...SESSION.meta,
    ...workspaceOverlayMetaApplied(roots, pick, overridden),
    resolveSource: hadGlobal ? "mixed-workspace" : "workspace-override",
  };

  log.debug("workspace overlay applied", {
    root: pick.root,
    file: pick.configFile,
    overridden: overridden.join(","),
  });
}

/**
 * Global cache resolve + optional workspace-local overlay (first root with a config file).
 * Call once per sessionStart before resolve(type) loops. Eager setup and
 * render both call this; the second call is a no-op for the same roots so
 * overlay verification is not given a second 5s budget.
 */
export async function prepareSessionResolve({ serverId, workspaceRoots } = {}) {
  const overlayKey = JSON.stringify(workspaceRoots ?? []);
  if (SESSION.overlayPreparedFor === overlayKey) return;
  const verifyDeadline = Date.now() + REPO_VERIFY_BUDGET_MS;
  await ensureSessionResolved(serverId, verifyDeadline);
  await applyWorkspaceOverlay(workspaceRoots, verifyDeadline);
  SESSION.overlayPreparedFor = overlayKey;
}

/**
 * Governed package types for this session = admin-declared
 * (`defaultGlobalRepos` keys) UNION workspace keys that actually resolved
 * (`.jfrog/local`). Call after prepareSessionResolve so the workspace half is
 * populated. Admin types that fail verify stay governed (and block). A
 * workspace-only type that fails verify is dropped — not blocked, not
 * autoSetup-eligible.
 * @returns {string[]}
 */
export function governedPackageTypes() {
  const union = new Set([
    ...globalDeclaredTypes(),
    ...(SESSION.workspaceDeclaredTypes ?? []),
  ]);
  return PACKAGE_TYPES.filter((type) => union.has(type));
}

export async function resolve(type, { serverId: serverIdHint } = {}) {
  log.debug("resolve start", {
    type,
    serverId: effectiveServerId(serverIdHint),
  });

  await ensureSessionResolved(serverIdHint);

  const hit = SESSION.byType?.[type];
  if (!hit) {
    log.debug("resolve miss", { type });
    return null;
  }

  const result = {
    ...hit,
    source: SESSION.meta?.source ?? "unknown",
    serverId: SESSION.meta?.serverId,
    cacheFile: SESSION.meta?.cacheFile,
  };
  log.debug("resolved", result);
  return result;
}

/** Force cache refresh (e.g. tests or future --refresh flag). */
export async function invalidateResolveCache(serverIdHint) {
  SESSION.serverId = null;
  SESSION.byType = null;
  SESSION.meta = null;
  SESSION.workspaceDeclaredTypes = [];
  SESSION.overlayPreparedFor = null;
  const serverId = effectiveServerId(serverIdHint);
  const { data } = await readCacheFile();
  const root = normalizeCacheRoot(data);
  if (root.servers[serverId]) {
    delete root.servers[serverId];
    await writeCacheFile(root);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const type = process.argv[2];
  if (!type) {
    console.error("usage: node lib/resolver.mjs <type>");
    console.error("       types: npm pypi maven gradle go docker helm nuget");
    process.exit(1);
  }
  const result = await resolve(type);
  if (!result) {
    console.error(`No repo resolved for type=${type}.`);
    console.error(
      "Live mode needs a configured `jf` server (access token or username + password / API key; run `jf c add`).",
    );
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
}
