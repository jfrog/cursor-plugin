// APR onboarding offer eligibility + managed rule sync.
//
// Soft-bridge (2026-08-17): offer while the global gate is open AND at least
// one package type is unbound in defaultGlobalRepos and not declined in
// ~/.jfrog/skills-cache/apr-onboarding-v1.json. Per-type No does not set
// onboardingPrompt: "off". Bare dismiss still does (global kill).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  getOnboardingPromptState,
  loadAgentsConfig,
  mergeAgentsConfigPatch,
} from "../../core/agents-config.mjs";
import { isNeverConfiguredScaffold } from "../../core/scaffold-fingerprint.mjs";
import { createLogger } from "../../core/logger.mjs";
import {
  declineOnboardingType,
  listDeclinedOnboardingTypes,
} from "./onboarding-decline-cache.mjs";
import { PACKAGE_TYPES } from "./repo-types.mjs";
import { syncOnboardingOfferRules } from "./sync-onboarding-rule.mjs";

const log = createLogger("onboarding");

/**
 * Flip never-configured scaffolds to enabled:true (and onboardingPrompt:auto
 * when the field was absent so the offer gate survives the fingerprint change).
 * @returns {{ migrated: boolean }}
 */
export function maybeMigrateScaffoldEnabled() {
  if (!isNeverConfiguredScaffold()) return { migrated: false };
  if (getOnboardingPromptState() === "off") return { migrated: false };
  const cfg = loadAgentsConfig();
  if (cfg.packageResolution.enabled === true) return { migrated: false };

  /** @type {Record<string, unknown>} */
  const patch = { enabled: true };
  if (getOnboardingPromptState() === "absent") {
    patch.onboardingPrompt = "auto";
  }
  mergeAgentsConfigPatch({ packageResolution: patch });
  log.info("onboarding.scaffold.enabled_migrated", {
    setOnboardingPromptAuto: patch.onboardingPrompt === "auto",
  });
  return { migrated: true };
}

/**
 * Global offer gate (ignores per-type declines / bindings).
 * @returns {{ open: boolean, reason: string }}
 */
export function evaluateOnboardingGate() {
  const prompt = getOnboardingPromptState();
  if (prompt === "off") {
    return { open: false, reason: "prompt-off" };
  }
  if (prompt === "auto") {
    return { open: true, reason: "prompt-auto" };
  }
  if (isNeverConfiguredScaffold()) {
    return { open: true, reason: "fingerprint-match" };
  }
  return { open: false, reason: "fingerprint-miss" };
}

/**
 * @param {string} [home]
 * @returns {Record<string, string>}
 */
function defaultGlobalReposFor(home = homedir()) {
  if (home === homedir()) {
    return loadAgentsConfig().packageResolution.defaultGlobalRepos ?? {};
  }
  try {
    const conf = path.join(home, ".jfrog", "agents-conf.json");
    if (!existsSync(conf)) return {};
    const raw = JSON.parse(readFileSync(conf, "utf8"));
    const repos = raw?.packageResolution?.defaultGlobalRepos;
    return repos && typeof repos === "object" && !Array.isArray(repos)
      ? repos
      : {};
  } catch {
    return {};
  }
}

/**
 * Types that may still receive a Consent Enable offer.
 * @param {string} [home]
 * @returns {string[]}
 */
export function listOfferablePackageTypes(home = homedir()) {
  const repos = defaultGlobalReposFor(home);
  const declined = new Set(listDeclinedOnboardingTypes(home));
  return PACKAGE_TYPES.filter((type) => {
    const key = repos[type];
    const bound = typeof key === "string" && key.trim().length > 0;
    return !bound && !declined.has(type);
  });
}

/**
 * Whether SessionStart may keep the managed offer rules.
 * @returns {{ eligible: boolean, reason: string, offerable?: string[] }}
 */
export function evaluateOnboardingEligibility() {
  const gate = evaluateOnboardingGate();
  if (!gate.open) {
    return { eligible: false, reason: gate.reason };
  }
  const offerable = listOfferablePackageTypes();
  if (!offerable.length) {
    return { eligible: false, reason: "nothing-to-offer" };
  }
  return { eligible: true, reason: gate.reason, offerable };
}

/**
 * Whether SessionStart should keep the offer rule.
 */
export function evaluateOnboardingOfferWindow() {
  return evaluateOnboardingEligibility();
}

/**
 * SessionStart path: keep/write the relevance-gated offer while eligible;
 * otherwise delete it.
 * @param {{ actor?: object }} [opts]
 * @returns {{ offer: boolean, reason: string, offerable?: string[] }}
 */
export function tryBeginOnboardingNudge(opts = {}) {
  const elig = evaluateOnboardingEligibility();
  if (!elig.eligible) {
    log.info("onboarding.offer.cleared", {
      reason: elig.reason,
      actor: opts.actor,
    });
    syncOnboardingOfferRules({ present: false });
    return { offer: false, reason: elig.reason };
  }

  return presentOfferRules(elig.reason, elig.offerable, opts);
}

/**
 * Write the offer rules unless the user resolved onboarding while we were
 * deciding (concurrent global dismiss / last type bound).
 * Exported for the interleaved `resolved-elsewhere` unit test.
 * @param {string} reason
 * @param {string[]} offerable
 * @param {{ actor?: object }} [opts]
 */
export function presentOfferRules(reason, offerable, opts = {}) {
  if (isOfferResolved()) {
    log.info("onboarding.offer.cleared", {
      reason: "resolved-elsewhere",
      actor: opts.actor,
    });
    syncOnboardingOfferRules({ present: false });
    return { offer: false, reason: "resolved-elsewhere" };
  }
  const sync = syncOnboardingOfferRules({ present: true });
  if (sync.skipped || sync.wrote.length === 0) {
    log.info("onboarding.offer.cleared", {
      reason: sync.reason ?? "write-failed",
      actor: opts.actor,
    });
    return { offer: false, reason: sync.reason ?? "write-failed" };
  }
  log.info("onboarding.offer.written", {
    eligibility: reason,
    offerable,
    actor: opts.actor,
  });
  return { offer: true, reason, offerable };
}

/** Global off or nothing left to offer. */
function isOfferResolved() {
  return (
    getOnboardingPromptState() === "off" ||
    listOfferablePackageTypes().length === 0
  );
}

/** Clear managed rules on both harnesses. */
export function clearOnboardingOfferRules() {
  log.info("onboarding.offer.cleared", { reason: "resolved" });
  syncOnboardingOfferRules({ present: false });
}

/**
 * Delete managed rules without changing agents-conf (kill switch) so a pending
 * offer can still be presented once the block lifts.
 */
export function removeOnboardingOfferRules() {
  log.info("onboarding.offer.cleared", { reason: "removed" });
  syncOnboardingOfferRules({ present: false });
}

/** Write onboardingPrompt: "off" into agents-conf.json. */
export function persistOnboardingPromptOff() {
  mergeAgentsConfigPatch({
    packageResolution: { onboardingPrompt: "off" },
  });
}

/** Global silence — bare dismiss. */
export function dismissOnboardingPrompt() {
  persistOnboardingPromptOff();
  clearOnboardingOfferRules();
}

/**
 * Per-type No — durable decline for one APR package type.
 * @param {string} type
 * @returns {{ ok: true, declinedType: string, offerable: string[], offer: boolean }}
 */
export function dismissOnboardingType(type) {
  declineOnboardingType(type);
  const nudge = tryBeginOnboardingNudge();
  return {
    ok: true,
    declinedType: type,
    offerable: listOfferablePackageTypes(),
    offer: nudge.offer,
  };
}
