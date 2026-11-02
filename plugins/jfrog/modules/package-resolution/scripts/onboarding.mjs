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
import {
  isNeverConfiguredScaffold,
  matchPruneTarget,
  matchShippedScaffold,
  sha256Canonical,
} from "../../core/scaffold-fingerprint.mjs";
import { createLogger } from "../../core/logger.mjs";
import {
  declineOnboardingType,
  listDeclinedOnboardingTypes,
} from "./onboarding-decline-cache.mjs";
import { BROKEN_KEY_CAUSES, PACKAGE_TYPES } from "./repo-types.mjs";
import { getUnresolvedInfo, prepareSessionResolve } from "./resolver.mjs";

const log = createLogger("onboarding");
const here = path.dirname(fileURLToPath(import.meta.url));
const NUDGE_TEMPLATE = path.join(here, "../onboarding/session-start-nudge.md");

export const CURSOR_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/cursor-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const CLAUDE_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/claude-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const COPILOT_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/vscode-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const CODEX_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/codex-plugin/blob/main/docs/package-resolution-admin-guide.md";

const ADMIN_GUIDE_URL_BY_IDE = {
  claude_code: CLAUDE_ADMIN_GUIDE_URL,
  cursor: CURSOR_ADMIN_GUIDE_URL,
  copilot: COPILOT_ADMIN_GUIDE_URL,
  codex: CODEX_ADMIN_GUIDE_URL,
};

/** Human-readable list of APR package types (keeps nudge copy in sync with code). */
export function supportedTypesPhrase() {
  return PACKAGE_TYPES.join(", ");
}

function adminGuideUrlForIde(ide) {
  return ADMIN_GUIDE_URL_BY_IDE[ide] ?? CLAUDE_ADMIN_GUIDE_URL;
}

export function configureCommandPath() {
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
 * Apply the registered migration for a plugin-written agents-conf.json.
 * `enable` turns on a never-configured template that shipped off (and sets
 * onboardingPrompt:auto when absent so the offer gate survives the
 * fingerprint change). `clear-repos` drops the example repo keys on a file the
 * user turned off, so turning it back on later does not restore them. A file
 * that is turned on keeps its keys for {@link maybePruneScaffoldRepos} to
 * check. `silence` sets onboardingPrompt:off on a
 * file the user turned off: the result is no longer plugin-written, so no
 * plugin version (old or new) offers setup or turns it back on. A file the
 * user turned off has no `enable`, and the write only happens while the file
 * still has the matched content, so a concurrent edit wins.
 * @returns {{ migrated: false } | { migrated: true, fingerprint: string }}
 */
export function maybeMigrateScaffold() {
  const match = matchShippedScaffold();
  if (!match?.migrate.length) return { migrated: false };

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (match.migrate.includes("clear-repos")) patch.defaultGlobalRepos = {};
  if (match.migrate.includes("enable")) {
    patch.enabled = true;
    if (!("onboardingPrompt" in (match.config.packageResolution ?? {}))) {
      patch.onboardingPrompt = "auto";
    }
  }
  if (match.migrate.includes("silence")) patch.onboardingPrompt = "off";
  if (!Object.keys(patch).length) return { migrated: false };
  const written = mergeAgentsConfigPatch(
    { packageResolution: patch },
    { onlyIf: (current) => sha256Canonical(current) === match.sha256 },
  );
  if (!written) return { migrated: false };

  log.info("onboarding.scaffold.migrated", {
    fingerprint: match.id,
    changed: Object.keys(patch).join(","),
  });
  return { migrated: true, fingerprint: match.id };
}

/**
 * `prune-repos`: a plugin-written file that an older migration turned on with
 * the example repo keys may already route through some of them (a server can
 * really have `npm-virtual`). Drop only the keys this session's verify proved
 * wrong; a key that works, or that could not be checked, stays. A file this
 * plugin already pruned in part stays eligible, via the id written on it,
 * until a later session proves a kept example key wrong. Routing mode
 * only — reuses the session's verify pass, so it adds no network calls.
 * @param {{ workspaceRoots?: string[] }} [opts]
 * @returns {Promise<{ pruned: [] } | { fingerprint: string, pruned: string[], kept: string[] }>}
 */
export async function maybePruneScaffoldRepos({ workspaceRoots } = {}) {
  const match = matchPruneTarget();
  if (!match) return { pruned: [] };

  await prepareSessionResolve({ workspaceRoots });
  const repos = match.config.packageResolution?.defaultGlobalRepos ?? {};
  const pruned = Object.keys(repos).filter((type) => {
    const info = getUnresolvedInfo(type);
    return info?.repoKey === repos[type] && BROKEN_KEY_CAUSES.has(info.cause);
  });
  if (!pruned.length) return { pruned: [] };

  const keptRepos = Object.fromEntries(
    Object.entries(repos).filter(([type]) => !pruned.includes(type)),
  );
  const written = mergeAgentsConfigPatch(
    {
      packageResolution: {
        defaultGlobalRepos: keptRepos,
        // Empty means the file is a known template again; drop the marker.
        scaffoldLineage: Object.keys(keptRepos).length ? match.id : null,
      },
    },
    { onlyIf: (current) => sha256Canonical(current) === match.sha256 },
  );
  if (!written) return { pruned: [] };

  const result = {
    fingerprint: match.id,
    pruned,
    kept: Object.keys(keptRepos),
  };
  log.info("onboarding.scaffold.pruned", {
    fingerprint: result.fingerprint,
    pruned: pruned.join(","),
    kept: result.kept.join(","),
  });
  return result;
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
