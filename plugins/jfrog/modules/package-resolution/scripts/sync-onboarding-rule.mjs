// Sync managed always-on onboarding rules for Cursor and Claude.
//
// Same stage-1 body on both harnesses. Presence is a projection of eligibility
// (SessionStart / configure success paths call this) — not a second source of truth.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "../../core/logger.mjs";
import { listDeclinedOnboardingTypes } from "./onboarding-decline-cache.mjs";
import { PACKAGE_TYPES } from "./repo-types.mjs";

const log = createLogger("sync-onboarding-rule");

const here = path.dirname(fileURLToPath(import.meta.url));
const STAGE1_TEMPLATE = path.join(
  here,
  "../onboarding/package-resolution-nudge.md",
);

export const CURSOR_RULE_NAME = "jfrog-apr-onboarding.mdc";
export const CLAUDE_RULE_NAME = "jfrog-apr-onboarding.md";

export const CURSOR_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/cursor-plugin/blob/main/docs/package-resolution-admin-guide.md";
export const CLAUDE_ADMIN_GUIDE_URL =
  "https://github.com/jfrog/claude-plugin/blob/main/docs/package-resolution-admin-guide.md";

/** Human-readable list of APR package types (keeps rule copy in sync with code). */
export function supportedTypesPhrase() {
  return PACKAGE_TYPES.join(", ");
}

export function cursorRulePath(home = homedir()) {
  return path.join(home, ".cursor", "rules", CURSOR_RULE_NAME);
}

export function claudeRulePath(home = homedir()) {
  return path.join(home, ".claude", "rules", CLAUDE_RULE_NAME);
}

function configureCommand() {
  return path.join(here, "configure.mjs");
}

function printPolicyCommand() {
  return path.join(here, "print-policy.mjs");
}

/**
 * Fill stage-1 template placeholders with absolute paths from THIS bundle.
 * @param {{ adminGuideUrl?: string }} [opts]
 * @returns {string} empty when unreadable
 */
export function loadStage1Body(opts = {}) {
  try {
    let body = readFileSync(STAGE1_TEMPLATE, "utf8");
    const configurePath = configureCommand().replace(/\\/g, "\\\\");
    body = body.replace(/\{\{CONFIGURE_COMMAND\}\}/g, configurePath);
    body = body.replace(
      /\{\{PRINT_POLICY_COMMAND\}\}/g,
      printPolicyCommand().replace(/\\/g, "\\\\"),
    );
    body = body.replace(
      /\{\{ADMIN_GUIDE_URL\}\}/g,
      opts.adminGuideUrl ?? CURSOR_ADMIN_GUIDE_URL,
    );
    body = body.replace(
      /\{\{SUPPORTED_TYPES\}\}/g,
      opts.supportedTypes ?? supportedTypesPhrase(),
    );
    return body;
  } catch (err) {
    log.warn("stage-1 template unreadable", {
      error: err?.message ?? String(err),
    });
    return "";
  }
}

function cursorRuleContents(body) {
  const types = supportedTypesPhrase();
  return `---
description: >-
  MUST read this rule BEFORE any ${types} install, package add, or Artifactory
  package-manager setup. Offer APR Consent Enable when an unbound package type
  is about to install. Body already forbids asking on unrelated chats.
alwaysApply: true
---

${body.trim()}\n`;
}

function claudeRuleContents(body) {
  return `${body.trim()}\n`;
}

function atomicWrite(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, file);
}

function safeWriteRule(file, contents) {
  try {
    atomicWrite(file, contents);
    return true;
  } catch (err) {
    log.warn("failed to write onboarding rule", {
      path: file,
      error: err?.message ?? String(err),
    });
    return false;
  }
}

/**
 * The offer rule must never exist once the global gate is off or no package
 * type remains offerable (bound in defaultGlobalRepos or declined).
 * Read the config for the same home we write into, so a mistaken `present: true`
 * caller cannot resurrect a resolved offer.
 * @param {string} home
 * @returns {string|null} suppression reason, or null when the offer may show
 */
function offerSuppressedFor(home) {
  /** @type {Record<string, string>} */
  let repos = {};
  try {
    const raw = JSON.parse(
      readFileSync(path.join(home, ".jfrog", "agents-conf.json"), "utf8"),
    );
    const pr = raw?.packageResolution ?? {};
    if (pr.onboardingPrompt === "off") return "prompt-off";
    if (pr.defaultGlobalRepos && typeof pr.defaultGlobalRepos === "object") {
      repos = pr.defaultGlobalRepos;
    }
  } catch {
    // missing or unreadable config: treat repos as empty
  }
  const declined = new Set(listDeclinedOnboardingTypes(home));
  const offerable = PACKAGE_TYPES.some((type) => {
    const key = repos[type];
    const bound = typeof key === "string" && key.trim().length > 0;
    return !bound && !declined.has(type);
  });
  if (!offerable) return "nothing-to-offer";
  return null;
}

function deleteIfExists(file) {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch (err) {
    log.warn("failed to delete onboarding rule", {
      path: file,
      error: err?.message ?? String(err),
    });
  }
}

/**
 * @param {{ present: boolean, home?: string }} opts
 * @returns {{ wrote: string[], deleted: string[], skipped: boolean, reason?: string }}
 */
export function syncOnboardingOfferRules(opts) {
  const home = opts.home ?? homedir();
  const cursorPath = cursorRulePath(home);
  const claudePath = claudeRulePath(home);

  if (!opts.present) {
    deleteIfExists(cursorPath);
    deleteIfExists(claudePath);
    return { wrote: [], deleted: [cursorPath, claudePath], skipped: false };
  }

  const suppressed = offerSuppressedFor(home);
  if (suppressed) {
    log.debug("offer rule write suppressed", { reason: suppressed });
    deleteIfExists(cursorPath);
    deleteIfExists(claudePath);
    return {
      wrote: [],
      deleted: [cursorPath, claudePath],
      skipped: true,
      reason: suppressed,
    };
  }

  const cursorBody = loadStage1Body({ adminGuideUrl: CURSOR_ADMIN_GUIDE_URL });
  const claudeBody = loadStage1Body({ adminGuideUrl: CLAUDE_ADMIN_GUIDE_URL });
  if (!cursorBody.trim() || !claudeBody.trim()) {
    deleteIfExists(cursorPath);
    deleteIfExists(claudePath);
    return {
      wrote: [],
      deleted: [cursorPath, claudePath],
      skipped: true,
      reason: "template-error",
    };
  }

  const cursorOk = safeWriteRule(cursorPath, cursorRuleContents(cursorBody));
  const claudeOk = safeWriteRule(claudePath, claudeRuleContents(claudeBody));
  // All-or-nothing: a single-harness success would burn budget for only one IDE.
  if (!cursorOk || !claudeOk) {
    deleteIfExists(cursorPath);
    deleteIfExists(claudePath);
    log.warn("onboarding rule write incomplete — rolled back both harnesses", {
      cursorOk,
      claudeOk,
    });
    return {
      wrote: [],
      deleted: [cursorPath, claudePath],
      skipped: true,
      reason: "write-failed",
    };
  }

  // Close enable/dismiss TOCTOU: config may have flipped after the first check.
  // Test-only: flip the gate after a successful write so the post-write
  // re-check can be asserted without a real race.
  if (
    process.env.JFROG_TEST_HARNESS === "1" &&
    process.env.JFROG_TEST_FLIP_OFFER_AFTER_WRITE === "1"
  ) {
    mkdirSync(path.join(home, ".jfrog"), { recursive: true });
    writeFileSync(
      path.join(home, ".jfrog", "agents-conf.json"),
      `${JSON.stringify({ packageResolution: { onboardingPrompt: "off" } })}\n`,
    );
  }
  const after = offerSuppressedFor(home);
  if (after) {
    log.debug("offer rule write rolled back after concurrent resolve", {
      reason: after,
    });
    deleteIfExists(cursorPath);
    deleteIfExists(claudePath);
    return {
      wrote: [],
      deleted: [cursorPath, claudePath],
      skipped: true,
      reason: after,
    };
  }

  log.debug("onboarding rules written", {
    wrote: `${cursorPath},${claudePath}`,
    bytes: cursorBody.length,
  });
  return {
    wrote: [cursorPath, claudePath],
    deleted: [],
    skipped: false,
  };
}
