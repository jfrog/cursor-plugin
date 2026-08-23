// Platform identity — single source of truth for "where is JFrog and how do
// we auth to it?". Used by feature-flag.mjs and resolver.mjs.
//
// Identity ALWAYS comes from `jf config`. `jf config export [serverId]` returns
// base64(JSON({ url, accessToken, user, password, serverId, ... })) for the
// chosen (or default) server. A usable identity needs a platform `url` plus a
// credential: an access token (Bearer) OR username + password / API key
// (Basic). Access token wins when both are present (mirrors `jf setup`).
//
// After credentials parse, an optional readiness probe (Artifactory ping)
// rejects expired/revoked/unreachable credentials so the feature flag can
// fall into pending instead of "routing with empty repos".
//
// If `jf` is not on PATH, has no configured servers, or the chosen server has
// no usable credential (e.g. SSH-key-only), identity is null and the feature
// flag falls into the `missing-identity` path (hook goes no-op, fail closed).
//
// Config export is cached per process. Probe results are cached separately
// (async) so feature-flag can await readiness without making getPlatformIdentity
// async.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";

import { createLogger } from "./logger.mjs";

const log = createLogger("jf-identity");

/** Wire-format cause codes for getPlatformIdentity() / pending remediation. */
export const IdentityCause = Object.freeze({
  OK: "ok",
  JF_NOT_INSTALLED: "jf-not-installed",
  JF_NOT_CONFIGURED: "jf-not-configured",
  /** Server present but credential shape unusable (e.g. SSH-key-only). */
  JF_UNSUPPORTED_AUTH: "jf-unsupported-auth",
  /** Credential present but Artifactory rejected it (401/403). */
  JF_AUTH_FAILED: "jf-auth-failed",
  /** Probe timed out / network / non-auth HTTP failure. */
  JF_UNREACHABLE: "jf-unreachable",
  /** Platform URL is not https — refuse to send credentials in cleartext. */
  INSECURE_URL: "insecure-url",
});

/**
 * Credentials must never travel in cleartext. `jf` accepts http:// servers;
 * callers that send Authorization headers must gate on https first.
 * @param {{ url?: string } | string | null | undefined} identityOrUrl
 */
export function isHttpsIdentityUrl(identityOrUrl) {
  try {
    const raw =
      typeof identityOrUrl === "string"
        ? identityOrUrl
        : (identityOrUrl?.url ?? "");
    return new URL(String(raw)).protocol === "https:";
  } catch {
    return false;
  }
}
const PROBE_TIMEOUT_MS = 3_000;

// Module-scope cache. Keyed by the requested serverId hint (`undefined`
// means "whatever jf considers default"). Stores the full resolved object,
// including null when jf config produced nothing usable.
const CACHE = new Map();
// Probe results are cached for the process lifetime (each hook is a fresh
// process, so there's nothing to expire within one). Both ok and non-ok
// results are memoized so feature-flag + resolver share one round-trip.
/** @type {Map<string, { ok: boolean, cause: string }>} */
const PROBE_CACHE = new Map();

function normalizeUrl(u) {
  if (!u) return "";
  return String(u).replace(/\/+$/, "");
}

function jfConfigIdentity(serverId) {
  const args = ["config", "export"];
  if (serverId) args.push(serverId);

  let result;
  try {
    result = spawnSync("jf", args, {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    log.debug("jf spawn threw", { error: err?.message ?? String(err) });
    return { identity: null, cause: IdentityCause.JF_NOT_INSTALLED };
  }

  if (result.error) {
    log.debug("jf spawn error", {
      code: result.error.code,
      message: result.error.message,
    });
    return { identity: null, cause: IdentityCause.JF_NOT_INSTALLED };
  }
  if (result.status !== 0) {
    log.debug("jf config export non-zero exit", {
      status: result.status,
      stderr: (result.stderr || "").trim().slice(0, 200),
    });
    return { identity: null, cause: IdentityCause.JF_NOT_CONFIGURED };
  }

  const blob = (result.stdout || "").trim();
  if (!blob) {
    log.debug("jf config export returned empty stdout");
    return { identity: null, cause: IdentityCause.JF_NOT_CONFIGURED };
  }

  let parsed;
  try {
    const json = Buffer.from(blob, "base64").toString("utf8");
    parsed = JSON.parse(json);
  } catch (err) {
    log.warn("jf config export blob not decodable", {
      error: err?.message ?? String(err),
    });
    return { identity: null, cause: IdentityCause.JF_NOT_CONFIGURED };
  }

  const url = normalizeUrl(parsed?.url);
  const token = parsed?.accessToken ?? "";
  const user = parsed?.user ?? "";
  const password = parsed?.password ?? "";
  const resolvedServerId = parsed?.serverId ?? serverId ?? null;

  if (!url) {
    log.debug("jf config export missing url", {
      serverId: resolvedServerId,
      hasUrl: false,
      hasToken: Boolean(token),
      hasUser: Boolean(user),
      hasPassword: Boolean(password),
    });
    return { identity: null, cause: IdentityCause.JF_NOT_CONFIGURED };
  }

  // Access token wins when both are present (mirrors jf setup precedence).
  let auth = null;
  if (token) {
    auth = { kind: "bearer", token };
  } else if (user && password) {
    auth = { kind: "basic", user, password };
  }

  if (!auth) {
    log.debug("jf config export has url but no usable credential", {
      serverId: resolvedServerId,
      hasUrl: true,
      hasToken: Boolean(token),
      hasUser: Boolean(user),
      hasPassword: Boolean(password),
    });
    return { identity: null, cause: IdentityCause.JF_UNSUPPORTED_AUTH };
  }

  log.debug("jf config export identity accepted", {
    serverId: resolvedServerId,
    hasUrl: true,
    authKind: auth.kind,
  });

  return {
    identity: {
      url,
      serverId: resolvedServerId,
      source: "jf-config",
      auth,
    },
    cause: IdentityCause.OK,
  };
}

/**
 * HTTP Authorization header value for Artifactory API calls, or null.
 * Rejects credentials with CR/LF so Node never throws a header error that
 * echoes the secret in `err.message`.
 */
export function authHeader(identity) {
  const auth = identity?.auth;
  if (!auth) return null;
  if (auth.kind === "bearer") {
    const token = String(auth.token ?? "");
    if (!token || /[\r\n]/.test(token)) return null;
    return `Bearer ${token}`;
  }
  if (auth.kind === "basic") {
    const user = String(auth.user ?? "");
    const password = String(auth.password ?? "");
    if (!user || !password || /[\r\n]/.test(user) || /[\r\n]/.test(password)) {
      return null;
    }
    return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }
  return null;
}

/** Strip credential material from error strings before logging. */
export function safeErrorMessage(err) {
  const raw = err?.message ?? String(err ?? "");
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/Basic\s+\S+/gi, "Basic <redacted>");
}

function probeCacheKey(identity) {
  const auth = identity?.auth;
  if (!auth) return "none";
  const url = identity.url ?? "";
  if (auth.kind === "bearer") {
    const digest = createHash("sha256")
      .update(`bearer\0${auth.token ?? ""}`)
      .digest("hex")
      .slice(0, 16);
    return `${url}|bearer|${digest}`;
  }
  const digest = createHash("sha256")
    .update(`basic\0${auth.user ?? ""}\0${auth.password ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `${url}|basic|${digest}`;
}

/** Test hooks only apply when the unit/integration harness sets this. */
function testHarnessActive() {
  return process.env.JFROG_TEST_HARNESS === "1";
}

function syntheticProbeResult() {
  if (!testHarnessActive()) return null;
  const mode = process.env.JFROG_TEST_IDENTITY_PROBE;
  if (!mode || mode === "skip") return null;
  if (mode === "ok") return { ok: true, cause: IdentityCause.OK };
  if (mode === "401" || mode === "403" || mode === "auth-failed") {
    return { ok: false, cause: IdentityCause.JF_AUTH_FAILED };
  }
  if (mode === "error" || mode === "unreachable") {
    return { ok: false, cause: IdentityCause.JF_UNREACHABLE };
  }
  return null;
}

/**
 * Probe Artifactory with the resolved credentials. Fail-closed: any non-OK
 * response or network error means the identity is not ready for routing.
 *
 * Test hooks (require `JFROG_TEST_HARNESS=1` — never honored in production):
 *   JFROG_TEST_IDENTITY_PROBE=skip — do not probe; treat as ok
 *   ok / 401 / error — synthetic results
 *
 * Production kill switch: `JF_AGENT_IDENTITY_PROBE=0` skips the probe.
 *
 * @param {object | null} identity
 * @returns {Promise<{ ok: boolean, cause: string }>}
 */
export async function probePlatformIdentity(identity) {
  if (!identity) {
    return { ok: false, cause: IdentityCause.JF_NOT_CONFIGURED };
  }

  const synthetic = syntheticProbeResult();
  if (synthetic) return synthetic;

  if (testHarnessActive() && process.env.JFROG_TEST_IDENTITY_PROBE === "skip") {
    return { ok: true, cause: IdentityCause.OK };
  }

  if (!isHttpsIdentityUrl(identity)) {
    log.warn("refusing identity probe over a non-HTTPS platform URL");
    const result = { ok: false, cause: IdentityCause.INSECURE_URL };
    const keyEarly = probeCacheKey(identity);
    PROBE_CACHE.set(keyEarly, result);
    return result;
  }

  if (process.env.JF_AGENT_IDENTITY_PROBE === "0") {
    return { ok: true, cause: IdentityCause.OK };
  }

  const key = probeCacheKey(identity);
  const cached = PROBE_CACHE.get(key);
  if (cached) {
    return { ok: cached.ok, cause: cached.cause };
  }

  const authorization = authHeader(identity);
  if (!authorization) {
    const result = { ok: false, cause: IdentityCause.JF_UNSUPPORTED_AUTH };
    PROBE_CACHE.set(key, result);
    return result;
  }

  // Auth-required endpoint: `system/ping` is anonymous-capable, so a
  // revoked/expired token would still return 200 and wrongly pass readiness.
  // `system/version` requires an authenticated (non-anonymous) caller.
  const pingUrl = `${identity.url}/artifactory/api/system/version`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  /** @type {{ ok: boolean, cause: string }} */
  let result;
  try {
    const res = await fetch(pingUrl, {
      method: "GET",
      headers: { Authorization: authorization },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      result = { ok: false, cause: IdentityCause.JF_AUTH_FAILED };
    } else if (!res.ok) {
      result = { ok: false, cause: IdentityCause.JF_UNREACHABLE };
    } else {
      result = { ok: true, cause: IdentityCause.OK };
    }
  } catch (err) {
    log.debug("identity probe failed", {
      url: pingUrl,
      error: safeErrorMessage(err),
    });
    result = { ok: false, cause: IdentityCause.JF_UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }

  log.debug("identity probe result", {
    url: identity.url,
    ok: result.ok,
    cause: result.cause,
  });
  PROBE_CACHE.set(key, result);
  return result;
}

/**
 * Config-only identity (sync). Does not probe reachability.
 * @returns {{ identity: object | null, cause: string }}
 */
export function getPlatformIdentity() {
  const hint = undefined;
  if (CACHE.has(hint)) return CACHE.get(hint);

  const status = jfConfigIdentity(hint);
  if (status.identity) {
    log.debug("identity from jf-config", {
      serverId: status.identity.serverId,
      url: status.identity.url,
      authKind: status.identity.auth?.kind,
    });
  } else {
    log.debug("no platform identity", { cause: status.cause });
  }
  CACHE.set(hint, status);
  return status;
}

/**
 * Config identity + readiness probe. Prefer this from async session paths
 * (feature-flag) so dead tokens fail closed to pending.
 * @returns {Promise<{ identity: object | null, cause: string }>}
 */
export async function getReadyPlatformIdentity() {
  const status = getPlatformIdentity();
  if (!status.identity) return status;

  const probe = await probePlatformIdentity(status.identity);
  if (probe.ok) return status;

  // Rejected / structurally-unusable credentials are a stable fact → fail
  // closed to pending so we don't inject "routing" with an unusable identity.
  if (
    probe.cause === IdentityCause.JF_AUTH_FAILED ||
    probe.cause === IdentityCause.JF_UNSUPPORTED_AUTH ||
    probe.cause === IdentityCause.INSECURE_URL
  ) {
    log.debug("identity not ready after probe", { cause: probe.cause });
    return { identity: null, cause: probe.cause };
  }

  // Transient failure (timeout / network / 5xx): keep routing best-effort
  // rather than downgrading a healthy setup to pending on a blip. The resolver
  // already fails safe per-repo (keeps prior cache, skips empty writes).
  log.warn("identity probe unreachable — routing best-effort", {
    cause: probe.cause,
  });
  return status;
}

/** Test-only — reset module caches between in-process scenarios. */
export function clearPlatformIdentityCache() {
  CACHE.clear();
  PROBE_CACHE.clear();
}

export function identityLabel(identity) {
  if (!identity) return "none";
  return identity.serverId ? `jf-config:${identity.serverId}` : "jf-config";
}

/** Redact credential material for CLI / harness stdout (keeps kind + user). */
export function redactIdentity(identity) {
  if (!identity) return null;
  const auth = identity.auth;
  if (!auth) return { ...identity, auth: null };
  if (auth.kind === "bearer") {
    return {
      ...identity,
      auth: {
        kind: "bearer",
        token: auth.token ? `<${auth.token.length} chars>` : "",
      },
    };
  }
  return {
    ...identity,
    // Preserve the real kind — redactIdentity is exported and the harness may
    // pass shapes other than "basic"; reporting them all as "basic" misleads.
    auth: {
      kind: auth.kind ?? "unknown",
      user: auth.user ?? "",
      password: auth.password ? `<${auth.password.length} chars>` : "",
    },
  };
}

function noIdentityHint(cause) {
  if (cause === IdentityCause.JF_NOT_INSTALLED) {
    return "`jf` is not installed. Install the JFrog CLI, then run `jf config add`.";
  }
  if (cause === IdentityCause.JF_UNSUPPORTED_AUTH) {
    return (
      "Configured server auth method is not supported. Use an access token " +
      "or username + password / API key (`jf config add`)."
    );
  }
  if (cause === IdentityCause.JF_AUTH_FAILED) {
    return (
      "Configured credentials were rejected by Artifactory (expired, revoked, " +
      "or wrong). Refresh with `jf config add` / re-login."
    );
  }
  if (cause === IdentityCause.JF_UNREACHABLE) {
    return (
      "Artifactory did not respond to a readiness probe. Check network / " +
      "platform URL, then retry."
    );
  }
  if (cause === IdentityCause.INSECURE_URL) {
    return (
      "Configured platform URL is not HTTPS. Reconfigure with `jf config add` " +
      "using an https:// URL so credentials are not sent in cleartext."
    );
  }
  return (
    "No configured JFrog server. Run `jf config add` (access token or " +
    "username + password / API key)."
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const labelOnly = process.argv.includes("--label");
  const { identity, cause } = getPlatformIdentity();
  if (labelOnly) {
    if (!identity) {
      console.log("none");
      process.exit(0);
    }
    console.log(`${identityLabel(identity)}\t${identity.url}`);
    process.exit(0);
  }
  if (!identity) {
    console.error(`No platform identity (${cause}). ${noIdentityHint(cause)}`);
    process.exit(2);
  }
  console.log(JSON.stringify(redactIdentity(identity), null, 2));
}
