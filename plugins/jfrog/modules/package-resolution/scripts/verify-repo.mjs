// Fail-closed virtual-repo verify for Consent Enable / configure enable.
//
// GET /artifactory/api/repositories/<key> — confirms virtual + packageType.
// Listing repos is owned by the base jfrog skill, not this module.

import {
  authHeader,
  getPlatformIdentity,
  isHttpsIdentityUrl,
  safeErrorMessage,
} from "../../core/jf-identity.mjs";
import { createLogger } from "../../core/logger.mjs";
import { PACKAGE_TYPES, repoMatchesPackageType } from "./repo-types.mjs";

const log = createLogger("verify-repo");

const VERIFY_TIMEOUT_MS = 45_000;

/**
 * @param {string | undefined | null} type
 * @returns {string | null} normalized APR package type or null
 */
export function normalizeAprType(type) {
  if (typeof type !== "string") return null;
  const key = type.trim().toLowerCase();
  return PACKAGE_TYPES.includes(key) ? key : null;
}

function testHarnessActive() {
  return process.env.JFROG_TEST_HARNESS === "1";
}

/**
 * Test-only verify override (JFROG_TEST_HARNESS=1):
 *   JFROG_TEST_VERIFY_REPO=ok
 *   JFROG_TEST_VERIFY_REPO=fail:<cause>
 * @returns {object | null}
 */
function testHarnessVerifyOverride({ type, repoKey }) {
  if (!testHarnessActive()) return null;
  const mode = process.env.JFROG_TEST_VERIFY_REPO;
  if (!mode) return null;
  if (mode === "ok") {
    return {
      ok: true,
      type,
      repoKey,
      packageType: type,
      rclass: "virtual",
    };
  }
  if (mode === "fail" || mode.startsWith("fail:")) {
    const cause = mode.startsWith("fail:")
      ? mode.slice(5) || "not-found"
      : "not-found";
    return { ok: false, cause, type, repoKey };
  }
  return null;
}

/**
 * Verify one user-provided repo key (fast GET by key).
 * @param {{ type: string, repoKey: string }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   cause?: string,
 *   type?: string,
 *   repoKey?: string,
 *   packageType?: string,
 *   rclass?: string,
 *   url?: string,
 *   serverId?: string,
 *   platformUrl?: string,
 * }>}
 */
export async function verifyRepoKey({ type, repoKey }) {
  const aprType = normalizeAprType(type);
  const key = typeof repoKey === "string" ? repoKey.trim() : "";
  if (!aprType || !key) {
    return { ok: false, cause: "bad-args" };
  }

  const harness = testHarnessVerifyOverride({ type: aprType, repoKey: key });
  if (harness) return harness;

  const { identity, cause } = getPlatformIdentity();
  if (!identity) {
    return { ok: false, cause: cause || "jf-not-configured" };
  }

  if (!isHttpsIdentityUrl(identity)) {
    log.warn("refusing to verify repo over a non-HTTPS platform URL", {
      type: aprType,
      repoKey: key,
    });
    return {
      ok: false,
      cause: "insecure-url",
      type: aprType,
      repoKey: key,
      serverId: identity.serverId,
      platformUrl: identity.url,
    };
  }

  const authorization = authHeader(identity);
  if (!authorization) {
    return { ok: false, cause: "jf-unsupported-auth" };
  }

  const url = `${identity.url}/artifactory/api/repositories/${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    log.info("verifying repo key", { type: aprType, repoKey: key, url });
    const res = await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (res.status === 404) {
      return {
        ok: false,
        cause: "not-found",
        type: aprType,
        repoKey: key,
        serverId: identity.serverId,
        platformUrl: identity.url,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        cause: `http-${res.status}`,
        type: aprType,
        repoKey: key,
        serverId: identity.serverId,
        platformUrl: identity.url,
      };
    }
    const cfg = await res.json();
    const rclass = String(cfg?.rclass ?? cfg?.type ?? "").toLowerCase();
    if (rclass !== "virtual") {
      return {
        ok: false,
        cause: "not-virtual",
        type: aprType,
        repoKey: key,
        packageType: cfg?.packageType ? String(cfg.packageType) : undefined,
        rclass: rclass || undefined,
        serverId: identity.serverId,
        platformUrl: identity.url,
      };
    }
    // Verify path fail-closed: missing packageType is not a match.
    if (!cfg?.packageType || !repoMatchesPackageType(cfg, aprType)) {
      return {
        ok: false,
        cause: "package-type-mismatch",
        type: aprType,
        repoKey: key,
        packageType: cfg?.packageType ? String(cfg.packageType) : undefined,
        rclass,
        serverId: identity.serverId,
        platformUrl: identity.url,
      };
    }
    return {
      ok: true,
      type: aprType,
      repoKey: key,
      packageType: String(cfg.packageType),
      rclass,
      ...(typeof cfg?.url === "string" ? { url: cfg.url } : {}),
      serverId: identity.serverId,
      platformUrl: identity.url,
    };
  } catch (err) {
    log.warn("verify repo threw", {
      repoKey: key,
      error: safeErrorMessage(err),
    });
    return {
      ok: false,
      cause: "unreachable",
      type: aprType,
      repoKey: key,
    };
  } finally {
    clearTimeout(timer);
  }
}
