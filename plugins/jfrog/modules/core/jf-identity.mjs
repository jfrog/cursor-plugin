// Platform identity — single source of truth for "where is JFrog and how do
// we auth to it?". Used by feature-flag.mjs and resolver.mjs.
//
// Identity ALWAYS comes from `jf config`. `jf config export [serverId]` returns
// base64(JSON({ url, accessToken, serverId, ... })) for the chosen (or default)
// server. We require both `url` AND `accessToken` (Bearer-only path).
//
// If `jf` is not on PATH, has no configured servers, or the chosen server has
// no access token, identity is null and the feature flag falls into the
// `missing-identity` path (hook goes no-op, fail closed). Same behaviour as
// before — only the configuration mechanism is simpler.
//
// One subprocess per hook process. Cached after first call within the same
// process (feature-flag + resolver share one export). Not persisted across
// sessions — `jf config export` is local and fast enough to run every time.

import { spawnSync } from "node:child_process";
import process from "node:process";

import { createLogger } from "./logger.mjs";

const log = createLogger("jf-identity");

// Module-scope cache. Keyed by the requested serverId hint (`undefined`
// means "whatever jf considers default"). Stores the full resolved object,
// including null when jf config produced nothing usable.
const CACHE = new Map();

function normalizeUrl(u) {
  if (!u) return "";
  return String(u).replace(/\/+$/, "");
}

// Resolution cause. `ok` means identity is present; the two failure causes
// drive cause-aware remediation in the enforce path:
//   jf-not-installed   — `jf` is not on PATH / could not be executed.
//   jf-not-configured  — `jf` ran but produced no usable server identity
//                        (non-zero exit, empty/undecodable export, or a
//                        server entry missing url/accessToken).
function jfConfigIdentity(serverId) {
  // `jf config export` writes base64(JSON) to stdout for the requested
  // server (or the default when no arg). We split the failure space into
  // "jf could not be run" (not-installed) vs "jf ran but has no usable
  // server" (not-configured) so the caller can give targeted remediation.
  const args = ["config", "export"];
  if (serverId) args.push(serverId);

  let result;
  try {
    result = spawnSync("jf", args, {
      encoding: "utf8",
      // jf config export reads no stdin and writes a single base64 line
      // (no terminal interaction). 2s is plenty even for cold spawns.
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    log.debug("jf spawn threw", { error: err?.message ?? String(err) });
    return { identity: null, cause: "jf-not-installed" };
  }

  if (result.error) {
    // ENOENT (and any other spawn error) means the binary could not be
    // executed — treat as not installed.
    log.debug("jf spawn error", { code: result.error.code, message: result.error.message });
    return { identity: null, cause: "jf-not-installed" };
  }
  if (result.status !== 0) {
    log.debug("jf config export non-zero exit", {
      status: result.status,
      stderr: (result.stderr || "").trim().slice(0, 200),
    });
    return { identity: null, cause: "jf-not-configured" };
  }

  const blob = (result.stdout || "").trim();
  if (!blob) {
    log.debug("jf config export returned empty stdout");
    return { identity: null, cause: "jf-not-configured" };
  }

  let parsed;
  try {
    const json = Buffer.from(blob, "base64").toString("utf8");
    parsed = JSON.parse(json);
  } catch (err) {
    log.warn("jf config export blob not decodable", { error: err?.message ?? String(err) });
    return { identity: null, cause: "jf-not-configured" };
  }

  const url = normalizeUrl(parsed?.url);
  const token = parsed?.accessToken ?? "";
  const resolvedServerId = parsed?.serverId ?? serverId ?? null;

  if (!url || !token) {
    log.debug("jf config export missing url or accessToken", {
      serverId: resolvedServerId,
      hasUrl: Boolean(url),
      hasToken: Boolean(token),
    });
    return { identity: null, cause: "jf-not-configured" };
  }

  return {
    identity: { url, token, serverId: resolvedServerId, source: "jf-config" },
    cause: "ok",
  };
}

// Public — returns { identity, cause }:
//   identity: { url, token, serverId, source } | null
//   cause:    "ok" | "jf-not-installed" | "jf-not-configured"
export function getPlatformIdentity() {
  const hint = undefined;
  if (CACHE.has(hint)) return CACHE.get(hint);

  const status = jfConfigIdentity(hint);
  if (status.identity) {
    log.debug("identity from jf-config", {
      serverId: status.identity.serverId,
      url: status.identity.url,
    });
  } else {
    log.debug("no platform identity", { cause: status.cause });
  }
  CACHE.set(hint, status);
  return status;
}

/** Test-only — reset module cache between in-process scenarios. */
export function clearPlatformIdentityCache() {
  CACHE.clear();
}

// Short label for log lines / status output, e.g. "jf-config:<your-server-id>".
export function identityLabel(identity) {
  if (!identity) return "none";
  return identity.serverId ? `jf-config:${identity.serverId}` : "jf-config";
}

// CLI:
//   node lib/jf-identity.mjs           — JSON with token redacted
//   node lib/jf-identity.mjs --label   — single line: "<label>\t<url>"  (or "none")
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
    const hint =
      cause === "jf-not-installed"
        ? "`jf` is not installed. Install the JFrog CLI, then run `jf config add`."
        : "No configured JFrog server. Run `jf config add` (must use access-token auth).";
    console.error(`No platform identity (${cause}). ${hint}`);
    process.exit(2);
  }
  const safe = { ...identity, token: identity.token ? `<${identity.token.length} chars>` : "" };
  console.log(JSON.stringify(safe, null, 2));
}
