// Scaffold fingerprint — detect never-configured agents-conf.json.
//
// Hash the user's config (canonical JSON) against every historically shipped
// template. Untouched scaffold ⇒ eligible for onboarding; any deviation ⇒
// treat as deliberate (admin/MDM/hand-edit) and stay silent when
// onboardingPrompt is absent.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentsConfigPath } from "./agents-config.mjs";

const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const FINGERPRINTS_PATH = path.join(
  PLUGIN_ROOT,
  "assets",
  "agents-conf-fingerprints.json",
);

const TEMPLATE_PATH = path.join(
  PLUGIN_ROOT,
  "assets",
  "agents-default-conf.json",
);

/** Deterministic JSON for hashing (sorted keys, no whitespace). */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`)
    .join(",")}}`;
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function loadFingerprintSet() {
  const set = new Set();
  try {
    const raw = JSON.parse(readFileSync(FINGERPRINTS_PATH, "utf8"));
    for (const entry of raw?.fingerprints ?? []) {
      if (typeof entry?.sha256 === "string" && entry.sha256) {
        set.add(entry.sha256);
      }
    }
  } catch {
    // fall through — still register current template below
  }
  try {
    const tmpl = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
    set.add(sha256Canonical(tmpl));
  } catch {
    // ignore
  }
  return set;
}

/**
 * True when agents-conf.json is missing or matches a shipped template hash.
 * @param {string} [configPath]
 */
export function isNeverConfiguredScaffold(configPath = agentsConfigPath()) {
  if (!existsSync(configPath)) return true;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const known = loadFingerprintSet();
  return known.has(sha256Canonical(parsed));
}

/** Guard for tests: current shipped template must be registered. */
export function currentTemplateFingerprint() {
  const tmpl = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  return sha256Canonical(tmpl);
}

export function registeredFingerprints() {
  return [...loadFingerprintSet()];
}
