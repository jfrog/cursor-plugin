// Replace one broken `defaultGlobalRepos` key in ~/.jfrog/agents-conf.json.
//
// Backs `configure.mjs set-repo`, which the routing policy's Repair note asks
// the agent to run after the user picks a repository. Only a key that also
// fails in sessions may be replaced; everything else in the file is kept as
// written.

import {
  getAgentsConfigSection,
  loadAgentsConfig,
  mergeAgentsConfigPatch,
} from "../../core/agents-config.mjs";
import { createLogger } from "../../core/logger.mjs";
import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import {
  BROKEN_KEY_CAUSES,
  PACKAGE_TYPES,
  isSafeRepoKey,
  repoMatchesPackageType,
} from "./repo-types.mjs";
import { verifyRepoKey } from "./verify-repo.mjs";

const log = createLogger("set-repo");

/** Verify causes that describe the key; anything else is auth, network, or server. */
const KEY_VERDICT_CAUSES = new Set([...BROKEN_KEY_CAUSES, "not-virtual"]);

/**
 * A key is broken only when sessions also reject it: missing, or confirmed to
 * be another package type. Sessions accept non-virtual repos and repos without
 * a packageType, so those count as working here too.
 * @param {{ ok: boolean, cause?: string, packageType?: string }} result
 * @param {string} type
 */
function isBrokenKey(result, type) {
  if (result.ok || !KEY_VERDICT_CAUSES.has(result.cause)) return false;
  if (result.cause === "not-found") return true;
  return Boolean(result.packageType) && !repoMatchesPackageType(result, type);
}

function refuse(message) {
  return { ok: false, message };
}

/** The fields set-repo writes. Compared before and after the network checks. */
function repoSectionSnap(section) {
  return JSON.stringify({
    enabled: section?.enabled,
    defaultGlobalRepos: section?.defaultGlobalRepos ?? {},
  });
}

/**
 * @param {{ type?: string, repoKey?: string }} opts
 * @returns {Promise<
 *   | { ok: true, type: string, repoKey: string, replaced: string | null, changed: boolean }
 *   | { ok: false, message: string }
 * >}
 */
export async function setGlobalRepo({ type, repoKey } = {}) {
  if (!type || !repoKey) {
    return refuse("set-repo requires --type <packageType> --repo <repoKey>");
  }
  if (!PACKAGE_TYPES.includes(type)) {
    return refuse(`unsupported package type: ${type}`);
  }
  if (!isSafeRepoKey(repoKey)) {
    return refuse("--repo must be a repository key (letters, digits, . _ -)");
  }
  const flag = await isPackageResolutionEnabled();
  if (flag.mode === "off") {
    return refuse(
      `set-repo requires Agent Package Resolution to be on (${flag.reason})`,
    );
  }

  // Patch the map as written, so entries sessions ignore are not dropped.
  // Captured before any network call: an edit made while checking wins.
  const section = getAgentsConfigSection("packageResolution") ?? {};
  const raw = section.defaultGlobalRepos ?? {};
  const expected = repoSectionSnap(section);
  const current = loadAgentsConfig().packageResolution.defaultGlobalRepos[type];
  if (current) {
    const result = await verifyRepoKey({ type, repoKey: current });
    if (!result.ok && !KEY_VERDICT_CAUSES.has(result.cause)) {
      return refuse(
        `set-repo could not check current repo ${type}=${current}: ${result.cause ?? "verify-failed"}; keeping it`,
      );
    }
    if (!isBrokenKey(result, type) && current !== repoKey) {
      return refuse(
        `set-repo refused: ${type} already uses working repo ${current}`,
      );
    }
  }

  const next = await verifyRepoKey({ type, repoKey });
  if (!next.ok) {
    return refuse(
      `set-repo refused unverified repo ${type}=${repoKey}: ${next.cause ?? "verify-failed"}`,
    );
  }
  if (current === repoKey) {
    const latest = getAgentsConfigSection("packageResolution") ?? {};
    if (repoSectionSnap(latest) !== expected) {
      return refuse(
        "set-repo refused: agents-conf.json changed while checking; run it again",
      );
    }
    return { ok: true, type, repoKey, replaced: null, changed: false };
  }

  const written = mergeAgentsConfigPatch(
    { packageResolution: { defaultGlobalRepos: { ...raw, [type]: repoKey } } },
    {
      onlyIf: (onDisk) =>
        repoSectionSnap(onDisk?.packageResolution) === expected,
    },
  );
  if (!written) {
    return refuse(
      "set-repo refused: agents-conf.json changed while checking; run it again",
    );
  }
  log.info("set-repo", { type, repoKey, replaced: current ?? null });
  return { ok: true, type, repoKey, replaced: current ?? null, changed: true };
}
