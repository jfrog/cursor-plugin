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
import { skillsProductUserAgent } from "../../core/jf-user-agent.mjs";
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
  // Admin-configured types that failed this session's verify, with why —
  // so the rendered instruction can say WHY a type is unrouted instead of
  // rendering an unfilled-looking `<no … repo resolved>` placeholder.
  unresolvedCauses: {},
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

/**
 * @returns {Promise<{ config: object|null, cause: string|null }>} cause is set
 *   whenever config is null, so callers can report WHY verify failed instead
 *   of silently collapsing every failure mode to the same blank miss.
 */
async function fetchRepoConfig(repoKey, id, deadline) {
  if (!id) return { config: null, cause: "jf-not-configured" };
  if (!isHttpsIdentityUrl(id)) {
    log.warn("refusing repo verify over a non-HTTPS platform URL", { repoKey });
    return { config: null, cause: "insecure-url" };
  }
  const url = `${id.url}/artifactory/api/repositories/${encodeURIComponent(repoKey)}`;
  // Network call on session start (cache miss + verifyRepos) — log at info so a
  // fresh session's Artifactory calls are visible without enabling debug.
  log.info("verifying repo via Artifactory API", { repoKey, url });
  const authorization = authHeader(id);
  if (!authorization) return { config: null, cause: "jf-unsupported-auth" };
  // Bound the call so a stalled Artifactory can't hang session start.
  const controller = new AbortController();
  const remaining = Math.max(0, deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "User-Agent": skillsProductUserAgent(),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const cause = res.status === 404 ? "not-found" : `http-${res.status}`;
      log.debug("repo verify miss", { repoKey, status: res.status, cause });
      return { config: null, cause };
    }
    return { config: await res.json(), cause: null };
  } catch (err) {
    log.warn("repo verify threw", {
      repoKey,
      error: safeErrorMessage(err),
    });
    return { config: null, cause: "unreachable" };
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

/**
 * Verifies each admin-configured repo against Artifactory and writes the
 * resolved set to the on-disk cache, preserving prior good entries on
 * partial/total verify failure and recording why each failed type failed.
 */
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

  // Reset per session-refresh — only this pass's own verify attempts should
  // explain "unresolved" to the render; a stale cause from an earlier refresh
  // in the same process must not outlive the config that produced it.
  SESSION.unresolvedCauses = {};

  if (verifyRepos) {
    // Each repository lookup is independent. Parallel verification keeps a
    // cold session within the hook's 15-second budget instead of multiplying
    // the five-second request timeout by every configured package type.
    const verified = await Promise.all(
      configured.map(async ({ type, repoKey }) => {
        const { config, cause: fetchCause } = await fetchRepoConfig(
          repoKey,
          id,
          verifyDeadline,
        );
        const matchesType =
          Boolean(config) && repoMatchesPackageType(config, type);
        return {
          type,
          repoKey,
          verified: matchesType,
          cause: config && !matchesType ? "package-type-mismatch" : fetchCause,
        };
      }),
    );
    for (const { type, repoKey, verified: isVerified, cause } of verified) {
      if (!isVerified) {
        log.warn("repo verify failed", { type, repoKey, serverId, cause });
        SESSION.unresolvedCauses[type] = { repoKey, cause };
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
  // serverId alone does not guarantee identity: a named jf server can be
  // repointed at a different URL without its serverId changing. Combining
  // an old, never-verified-against-this-host repo key with the CURRENT
  // base URL would route an install through an unverified repository.
  const priorEntryUrlMatches = priorEntry?.url === (id?.url ?? null);
  const priorHasRepos = Boolean(
    priorEntryUrlMatches &&
      priorEntry?.repositories &&
      Object.keys(priorEntry.repositories).length,
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
          "entries whose key still matches the current config",
        { serverId, configuredCount: adminConfiguredCount },
      );
      // Only trust a prior key for a type if it is still the key the admin
      // currently configures. If defaultGlobalRepos changed the key since
      // the cache was written, restoring the old one would route installs
      // through a repository the current config no longer authorizes — the
      // type stays unresolved instead, keeping the cause this pass recorded.
      const staleRepositories = {};
      for (const [type, repoKey] of Object.entries(priorEntry.repositories)) {
        if (!repoKey || repoKey !== adminRepos[type]) continue;
        staleRepositories[type] = repoKey;
        delete SESSION.unresolvedCauses[type];
      }
      const staleEntry = { ...priorEntry, repositories: staleRepositories };
      SESSION.serverId = serverId;
      SESSION.byType = entryToByType(staleEntry, base);
      SESSION.meta = buildResolveMeta(serverId, staleEntry, {
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
      // Only restore this cached key if it's still the key the admin
      // currently configures — a changed key means the current config no
      // longer authorizes it, so the type stays unresolved instead.
      if (repoKey !== adminRepos[type]) continue;
      repositories[type] = repoKey;
      // Type is governed again via the stale-but-trusted cache entry — the
      // cause captured above no longer describes its current (resolved) state.
      delete SESSION.unresolvedCauses[type];
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

/**
 * Returns the cached server entry if it exists and is still fresh
 * (TTL/mtime/URL all match), populating SESSION from it with no network call.
 */
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
  // No verify ran this pass, so there's no fresh cause to report — but a
  // type that is still admin-configured and absent from this cached
  // snapshot is still unresolved for the whole cache TTL. Reconstruct
  // enough to say so, rather than silently reverting to the ambiguous
  // `<no … repo resolved>` placeholder for the rest of the TTL.
  SESSION.unresolvedCauses = {};
  const adminRepos = pr.defaultGlobalRepos ?? {};
  for (const [type, repoKey] of Object.entries(adminRepos)) {
    if (!repoKey || SESSION.byType[type]) continue;
    SESSION.unresolvedCauses[type] = { repoKey, cause: "unresolved-cached" };
  }
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

/**
 * Guarantees SESSION holds a resolved (cache-hit or freshly-verified) repo
 * map for the current server id, short-circuiting if already resolved this
 * process.
 */
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
    // A prior identity's verify failure must not be reported as this one's.
    SESSION.unresolvedCauses = {};
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

/**
 * Overlays workspace-local `.jfrog/local` repo declarations onto the
 * session's resolved types, verifying each declared repo before it
 * overrides the global mapping.
 */
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
          const { config } = await fetchRepoConfig(repoKey, id, verifyDeadline);
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

/**
 * Why an admin-configured governed type failed THIS session's verify, if
 * known. Render uses this to say what actually happened (rejected repo key,
 * unreachable Artifactory, …) instead of an ambiguous blank placeholder.
 * @param {string} type
 * @returns {{ repoKey: string, cause: string }|null}
 */
export function getUnresolvedInfo(type) {
  return SESSION.unresolvedCauses?.[type] ?? null;
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
  SESSION.unresolvedCauses = {};
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
