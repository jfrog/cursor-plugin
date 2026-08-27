// APR onboarding offer eligibility + session-injected nudge rendering.
//
// The nudge used to be delivered as a standing rule file on disk. It is now
// rendered here and returned as plain text; the caller (index.mjs) hands it
// to the SessionStart hook's own additionalContext channel.
//
// Per-type: declining one package type does not silence the offer for the
// others — a durable per-type decline lives in onboarding-decline-cache.mjs,
// not in agents-conf.json. The nudge's type list is the still-offerable set
// (unbound AND undeclined), so it only ever shrinks as types get bound or
// declined — it never grows the amount of text injected at SessionStart.
// `dismiss` with no type is a global escape hatch (silences everything via
// onboardingPrompt: "off"); `dismiss --type <t>` is the normal per-type "no".

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const log = createLogger("onboarding");
const here = path.dirname(fileURLToPath(import.meta.url));
const NUDGE_TEMPLATE = path.join(here, "../onboarding/session-start-nudge.md");

export const CURSOR_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/cursor-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const CLAUDE_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/claude-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const COPILOT_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/vscode-plugin/blob/main/docs/package-resolution-admin-guide.md";

const ADMIN_GUIDE_URL_BY_IDE = {
  claude_code: CLAUDE_ADMIN_GUIDE_URL,
  cursor: CURSOR_ADMIN_GUIDE_URL,
  copilot: COPILOT_ADMIN_GUIDE_URL,
};

/** Human-readable list of APR package types (keeps nudge copy in sync with code). */
export function supportedTypesPhrase() {
  return PACKAGE_TYPES.join(", ");
}

function adminGuideUrlForIde(ide) {
  return ADMIN_GUIDE_URL_BY_IDE[ide] ?? CLAUDE_ADMIN_GUIDE_URL;
}

function configureCommandPath() {
  return path.join(here, "configure.mjs");
}

/**
 * Render the short session-injected onboarding nudge. The template's first
 * sentence is the "wait for real install intent" instruction — SessionStart
 * only fires at startup/resume/clear/compact, so that timing gate has to
 * live in the text itself, not in code.
 *
 * `types` should be the still-offerable set (unbound AND undeclined) so the
 * rendered list only ever shrinks as types get bound/declined — it never
 * grows the amount of text injected at SessionStart. Defaults to every
 * supported type for callers that don't have an eligibility result handy.
 * @param {{ ide?: string, types?: string[] }} [opts]
 * @returns {string} empty when the template is unreadable
 */
export function renderOnboardingNudge(opts = {}) {
  try {
    let body = readFileSync(NUDGE_TEMPLATE, "utf8");
    const types = opts.types ?? PACKAGE_TYPES;
    body = body.replace(/\{\{SUPPORTED_TYPES\}\}/g, types.join(", "));
    body = body.replace(
      /\{\{ADMIN_GUIDE_URL\}\}/g,
      adminGuideUrlForIde(opts.ide),
    );
    body = body.replace(
      /\{\{CONFIGURE_COMMAND\}\}/g,
      configureCommandPath().replace(/\\/g, "\\\\"),
    );
    return body.trim();
  } catch (err) {
    log.warn("onboarding nudge template unreadable", {
      error: err?.message ?? String(err),
    });
    return "";
  }
}

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
 * Types that may still receive a Consent Enable offer — unbound AND
 * undeclined. This is the list rendered into the nudge, so it only ever
 * shrinks as types get bound (via enable) or declined (via dismiss --type).
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
 * Whether the onboarding nudge may currently be shown.
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

/** Alias kept for callers that check the offer window specifically. */
export function evaluateOnboardingOfferWindow() {
  return evaluateOnboardingEligibility();
}

/**
 * Resolve whether/what to inject for this SessionStart. Code-level gate only
 * — this is layer 1 of the two-layer design in the plan header. Layer 2 (wait
 * for real install intent) lives inside the rendered text itself.
 * @param {{ ide?: string, killSwitch?: boolean }} [opts]
 * @returns {{ offer: boolean, reason: string, offerable?: string[], text: string }}
 */
export function resolveOnboardingNudge(opts = {}) {
  if (opts.killSwitch) {
    return { offer: false, reason: "DISABLE", text: "" };
  }
  const elig = evaluateOnboardingEligibility();
  if (!elig.eligible) {
    return { offer: false, reason: elig.reason, text: "" };
  }
  const text = renderOnboardingNudge({ ide: opts.ide, types: elig.offerable });
  if (!text) {
    return { offer: false, reason: "template-error", text: "" };
  }
  return { offer: true, reason: elig.reason, offerable: elig.offerable, text };
}

/** Write onboardingPrompt: "off" into agents-conf.json. */
export function persistOnboardingPromptOff() {
  mergeAgentsConfigPatch({
    packageResolution: { onboardingPrompt: "off" },
  });
}

/** Global "No" — silence the offer for every type, permanently. */
export function dismissOnboardingPrompt() {
  persistOnboardingPromptOff();
  log.info("onboarding.dismiss.recorded");
}

/**
 * Per-type "No" — durable decline for one APR package type. Other unbound,
 * undeclined types remain offerable.
 * @param {string} type
 * @returns {{ ok: true, declinedType: string, offerable: string[], offer: boolean }}
 */
export function dismissOnboardingType(type) {
  declineOnboardingType(type);
  const elig = evaluateOnboardingEligibility();
  return {
    ok: true,
    declinedType: type,
    offerable: listOfferablePackageTypes(),
    offer: elig.eligible,
  };
}
