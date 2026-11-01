// Scaffold fingerprint — detect never-configured agents-conf.json.
//
// Hash the user's config (canonical JSON) against every file a shipped plugin
// writes: historical templates plus the states later plugin writes produce.
// Untouched scaffold ⇒ eligible for onboarding; any deviation ⇒ treat as
// deliberate (admin/MDM/hand-edit) and stay silent when onboardingPrompt is
// absent. Each entry's `migrate` lists what SessionStart may change in it.

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

/** @returns {Map<string, { id: string, sha256: string, migrate: string[] }>} keyed by sha256 */
function loadFingerprints() {
  const byHash = new Map();
  try {
    const raw = JSON.parse(readFileSync(FINGERPRINTS_PATH, "utf8"));
    for (const entry of raw?.fingerprints ?? []) {
      if (typeof entry?.sha256 === "string" && entry.sha256) {
        byHash.set(entry.sha256, {
          id: String(entry.id ?? entry.sha256),
          sha256: entry.sha256,
          migrate: Array.isArray(entry.migrate) ? [...entry.migrate] : [],
          exampleRepos: exampleReposOf(entry.exampleRepos),
        });
      }
    }
  } catch {
    // fall through — still register current template below
  }
  try {
    const sha256 = sha256Canonical(
      JSON.parse(readFileSync(TEMPLATE_PATH, "utf8")),
    );
    if (!byHash.has(sha256)) {
      byHash.set(sha256, { id: "current-template", sha256, migrate: [] });
    }
  } catch {
    // ignore
  }
  return byHash;
}

function readConfigObject(configPath) {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True when agents-conf.json is missing or matches a shipped template hash.
 * @param {string} [configPath]
 */
export function isNeverConfiguredScaffold(configPath = agentsConfigPath()) {
  if (!existsSync(configPath)) return true;
  const parsed = readConfigObject(configPath);
  return parsed !== null && loadFingerprints().has(sha256Canonical(parsed));
}

/**
 * Registered fingerprint the file's whole content matches, with the
 * migration actions SessionStart may apply to it.
 * @param {string} [configPath]
 * @returns {{ id: string, sha256: string, migrate: string[], config: object } | null}
 *   `config` is the parsed file; null when the file is missing, unreadable,
 *   or not plugin-written
 */
export function matchShippedScaffold(configPath = agentsConfigPath()) {
  const parsed = readConfigObject(configPath);
  if (!parsed) return null;
  const entry = loadFingerprints().get(sha256Canonical(parsed));
  return entry ? { ...entry, config: parsed } : null;
}

/**
 * A plugin-written file SessionStart may prune.
 *
 * An exact `prune-repos` fingerprint matches as itself. A file this plugin
 * already pruned in part matches only when it still carries that fingerprint
 * id, every remaining key is still one of that file's example keys, and
 * putting those example keys back (and dropping the id) hashes to the
 * registered file. A hand edit, or a partial file this plugin did not mark,
 * matches nothing.
 * @param {string} [configPath]
 * @returns {{ id: string, sha256: string, migrate: string[], config: object } | null}
 *   `sha256` is the file as it is now, for the compare-and-swap.
 */
export function matchPruneTarget(configPath = agentsConfigPath()) {
  const parsed = readConfigObject(configPath);
  if (!parsed) return null;
  const sha256 = sha256Canonical(parsed);
  const exact = loadFingerprints().get(sha256);
  if (exact?.migrate.includes("prune-repos")) {
    return { ...exact, sha256, config: parsed };
  }

  const lineage = parsed.packageResolution?.scaffoldLineage;
  if (typeof lineage !== "string") return null;
  const origin = [...loadFingerprints().values()].find(
    (entry) => entry.id === lineage,
  );
  if (!origin?.migrate.includes("prune-repos") || !origin.exampleRepos) {
    return null;
  }
  const repos = parsed.packageResolution?.defaultGlobalRepos;
  if (!repos || typeof repos !== "object" || Array.isArray(repos)) return null;
  for (const [type, key] of Object.entries(repos)) {
    if (origin.exampleRepos[type] !== key) return null;
  }
  const restored = JSON.parse(JSON.stringify(parsed));
  delete restored.packageResolution.scaffoldLineage;
  restored.packageResolution.defaultGlobalRepos = { ...origin.exampleRepos };
  if (sha256Canonical(restored) !== origin.sha256) return null;
  return { ...origin, sha256, config: parsed };
}

/** @param {unknown} raw */
function exampleReposOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const repos = {};
  for (const [type, key] of Object.entries(raw)) {
    if (typeof key !== "string") return null;
    repos[type] = key;
  }
  return Object.keys(repos).length ? repos : null;
}

let shippedExampleRepoKeys;

/**
 * True for a placeholder key shipped in a prune-repos fingerprint
 * (`docker-virtual`, `npm-virtual`, …). Some Artifactory servers answer
 * HTTP 400, not 404, when that repository does not exist.
 * @param {string} repoKey
 */
export function isShippedExampleRepoKey(repoKey) {
  if (!shippedExampleRepoKeys) {
    shippedExampleRepoKeys = new Set();
    for (const entry of loadFingerprints().values()) {
      for (const key of Object.values(entry.exampleRepos ?? {})) {
        if (typeof key === "string") shippedExampleRepoKeys.add(key);
      }
    }
  }
  return shippedExampleRepoKeys.has(repoKey);
}

/** Guard for tests: current shipped template must be registered. */
export function currentTemplateFingerprint() {
  const tmpl = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  return sha256Canonical(tmpl);
}

export function registeredFingerprints() {
  return [...loadFingerprints().keys()];
}
