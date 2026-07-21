// Feature-flag check — decides the operating `mode` for the session-policy
// hook (instruction injection).
//
// Resolution order (first match wins):
//
//   1. JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1 → mode="off" (env kill switch)
//   2. packageResolution.enabled !== true in      → mode="off" (file-primary gate;
//      ~/.jfrog/agents-conf.json                   default off in shipped template)
//   3. jf config (via jf-identity)                → mode="active" when identity is
//      usable; otherwise mode="enforce" with a `cause` (jf-not-installed /
//      jf-not-configured) so the session hook can inject a targeted,
//      remediation-focused advisory notice.
//
// Modes:
//   "off"     — do nothing (no injection).
//   "active"  — inject resolved Artifactory URLs + routing policy.
//   "enforce" — jf missing/unconfigured: inject the advisory "routing not
//               ready" notice (no resolved URLs). This is advisory steering,
//               not a hard block — real enforcement is durable PM config
//               (jf setup) + server-side Curation.
//
// Repo keys come from agents-conf.json defaultGlobalRepos (resolver.mjs).

import process from "node:process";

import { createLogger } from "../../core/logger.mjs";
import { getAgentsConfigSection } from "../../core/agents-config.mjs";
import { getPlatformIdentity, identityLabel } from "../../core/jf-identity.mjs";

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
    return { mode: "off", reason: "DISABLE", identity: "none", cause: "ok" };
  }

  if (!isEnabledInConfig()) {
    log.debug("off", { reason: "NOT_ENABLED" });
    return { mode: "off", reason: "NOT_ENABLED", identity: "none", cause: "ok" };
  }

  const { identity, cause } = getPlatformIdentity();
  if (!identity) {
    log.debug("enforce", { reason: "missing-identity", cause });
    return { mode: "enforce", reason: "missing-identity", identity: "none", cause };
  }

  log.debug("active", { reason: "jf-config", identity: identityLabel(identity) });
  return {
    mode: "active",
    reason: "jf-config",
    identity: identityLabel(identity),
    cause: "ok",
  };
}
