// Feature-flag check — decides the operating `mode` for the session-policy
// hook (instruction injection).
//
// Resolution order (first match wins):
//
//   1. JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1 → mode="off" (env kill switch)
//   2. packageResolution.enabled !== true in      → mode="off" (file-primary gate;
//      ~/.jfrog/agents-conf.json                   shipped template defaults on)
//   3. jf config + readiness probe (via jf-identity)
//      → mode="routing" when identity is usable and Artifactory accepts it;
//      otherwise mode="pending" with a `cause`:
//        jf-not-installed | jf-not-configured | jf-unsupported-auth |
//        jf-auth-failed | insecure-url
//      (jf-unreachable stays routing best-effort — not a pending cause)
//
// Modes:
//   "off"     — do nothing (no injection).
//   "routing" — inject resolved Artifactory URLs + routing policy.
//   "pending" — identity missing/unusable/rejected: inject the advisory
//               "routing not ready" notice (no resolved URLs). Advisory
//               steering only — real enforcement is durable PM config
//               (jf setup) + server-side Curation.
//
// Repo keys come from agents-conf.json defaultGlobalRepos (resolver.mjs).

import process from "node:process";

import { createLogger } from "../../core/logger.mjs";
import { getAgentsConfigSection } from "../../core/agents-config.mjs";
import {
  getReadyPlatformIdentity,
  identityLabel,
  IdentityCause,
} from "../../core/jf-identity.mjs";

const log = createLogger("feature-flag");

function isEnvDisabled() {
  return process.env.JF_AGENT_PACKAGE_RESOLUTION_DISABLE === "1";
}

function isEnabledInConfig() {
  const pr = getAgentsConfigSection("packageResolution");
  return pr?.enabled === true;
}

export async function isPackageResolutionEnabled() {
  if (isEnvDisabled()) {
    log.debug("off", { reason: "DISABLE" });
    return {
      mode: "off",
      reason: "DISABLE",
      identity: "none",
      cause: IdentityCause.OK,
    };
  }

  if (!isEnabledInConfig()) {
    log.debug("off", { reason: "NOT_ENABLED" });
    return {
      mode: "off",
      reason: "NOT_ENABLED",
      identity: "none",
      cause: IdentityCause.OK,
    };
  }

  // Probe credentials so expired/revoked tokens fail closed to pending
  // instead of "routing" with every row unresolved.
  const { identity, cause } = await getReadyPlatformIdentity();
  if (!identity) {
    log.debug("pending", { reason: "missing-identity", cause });
    return {
      mode: "pending",
      reason: "missing-identity",
      identity: "none",
      cause,
    };
  }

  log.debug("routing", {
    reason: "jf-config",
    identity: identityLabel(identity),
  });
  return {
    mode: "routing",
    reason: "jf-config",
    identity: identityLabel(identity),
    cause: IdentityCause.OK,
  };
}
