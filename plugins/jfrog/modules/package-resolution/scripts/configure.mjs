#!/usr/bin/env node
// Agent Package Resolution configure CLI — status + Consent Enable.
//
// Invoked by the agent (absolute path baked into the session-injected
// onboarding nudge / onboarding-procedure). Mutates ~/.jfrog/agents-conf.json.
// Per-type No writes ~/.jfrog/skills-cache/apr-onboarding-v1.json (declining
// pypi does not silence a later npm offer); bare dismiss sets
// onboardingPrompt: "off" (global silence, every type).
// Bounded repo lookup is via the base jfrog skill; this CLI verifies + writes.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ensureAgentsConfigScaffold,
  getOnboardingPromptState,
  loadAgentsConfig,
  mergeAgentsConfigPatch,
  normalizeAutoSetup,
  normalizeRepoMap,
} from "../../core/agents-config.mjs";
import { createLogger, setLogContext } from "../../core/logger.mjs";
import { isNeverConfiguredScaffold } from "../../core/scaffold-fingerprint.mjs";
import { PACKAGE_TYPES } from "./repo-types.mjs";
import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { verifyRepoKey } from "./verify-repo.mjs";
import { listDeclinedOnboardingTypes } from "./onboarding-decline-cache.mjs";
import {
  dismissOnboardingPrompt,
  dismissOnboardingType,
  evaluateOnboardingEligibility,
  evaluateOnboardingOfferWindow,
  listOfferablePackageTypes,
} from "./onboarding.mjs";

const log = createLogger("configure");
const here = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `Usage: node configure.mjs <command> [options]

Commands:
  status                 Print APR + onboarding status (JSON)
  verify-repo --type <t> --repo <key>  Verify one virtual repo key
  enable --repos <json>  Write enabled:true + defaultGlobalRepos
  auto-setup --types <json|true>  Set autoSetup policy
  dismiss [--type <t>]   Per-type decline, or global onboardingPrompt off
  onboarding-procedure   Print stage-2 Consent Enable instructions
`;
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (
      a === "--repos" ||
      a === "--types" ||
      a === "--type" ||
      a === "--repo"
    ) {
      const v = args[++i];
      if (v === undefined) fail(`missing value for ${a}`);
      opts[a.slice(2)] = v;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return { command, opts };
}

function parseJsonArg(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} must be valid JSON`);
  }
}

function validateRepos(repos) {
  const map = normalizeRepoMap(repos);
  const keys = Object.keys(map);
  if (!keys.length) fail("--repos must include at least one type → repoKey");
  const allowed = new Set(PACKAGE_TYPES);
  for (const t of keys) {
    if (!allowed.has(t)) fail(`unsupported package type: ${t}`);
  }
  return map;
}

async function cmdStatus() {
  ensureAgentsConfigScaffold();
  const flag = await isPackageResolutionEnabled();
  const cfg = loadAgentsConfig();
  const prompt = getOnboardingPromptState();
  const elig = evaluateOnboardingEligibility();
  const window = evaluateOnboardingOfferWindow();
  const declined = listDeclinedOnboardingTypes();
  const offerable = listOfferablePackageTypes();
  const out = {
    mode: flag.mode,
    reason: flag.reason,
    cause: flag.cause,
    enabled: cfg.packageResolution.enabled,
    onboardingPrompt: prompt,
    scaffoldUntouched: isNeverConfiguredScaffold(),
    eligible: elig.eligible,
    eligibilityReason: elig.reason,
    offerWindowOpen: window.eligible,
    offerWindowReason: window.reason,
    declined,
    offerable,
    defaultGlobalRepos: cfg.packageResolution.defaultGlobalRepos,
    autoSetup: cfg.packageResolution.autoSetup,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

async function cmdVerifyRepo(opts) {
  if (!opts.type || !opts.repo) {
    fail("verify-repo requires --type <packageType> --repo <repoKey>");
  }
  const result = await verifyRepoKey({ type: opts.type, repoKey: opts.repo });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}

async function cmdEnable(opts) {
  if (!opts.repos) fail("enable requires --repos '<json>'");
  const repos = validateRepos(parseJsonArg(opts.repos, "--repos"));
  ensureAgentsConfigScaffold();

  /** @type {Record<string, string>} */
  const verified = {};
  for (const [type, repoKey] of Object.entries(repos)) {
    const result = await verifyRepoKey({ type, repoKey });
    if (!result.ok) {
      fail(
        `enable refused unverified repo ${type}=${repoKey}: ${result.cause ?? "verify-failed"}`,
      );
    }
    verified[type] = repoKey;
  }

  mergeAgentsConfigPatch({
    packageResolution: {
      enabled: true,
      defaultGlobalRepos: verified,
    },
  });
  const elig = evaluateOnboardingEligibility();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      enabled: true,
      defaultGlobalRepos: verified,
      offer: elig.eligible,
      offerable: listOfferablePackageTypes(),
      next: [
        `node "${path.join(here, "configure.mjs")}" auto-setup --types '<json-array of enabled types>'`,
        `JFROG_EAGER_SETUP_SYNC=1 node "${path.join(here, "print-policy.mjs")}"`,
        "After auto-setup + sync print-policy: suggest a new chat so hooks reload cleanly",
      ],
    })}\n`,
  );
}

function cmdAutoSetup(opts) {
  if (opts.types === undefined)
    fail("auto-setup requires --types '<json|true>'");
  ensureAgentsConfigScaffold();
  const cfg = loadAgentsConfig();
  if (cfg.packageResolution.enabled !== true) {
    fail("auto-setup requires packageResolution.enabled: true");
  }
  const bound = Object.keys(cfg.packageResolution.defaultGlobalRepos ?? {});
  if (!bound.length) {
    fail(
      "auto-setup requires at least one type in packageResolution.defaultGlobalRepos",
    );
  }
  const boundSet = new Set(bound);
  /** @type {true | string[]} */
  let autoSetup;
  if (opts.types === "true" || opts.types === true) {
    // Expand to currently bound types only — never schedule unbound types.
    autoSetup = [...bound].sort();
  } else {
    const raw = parseJsonArg(opts.types, "--types");
    autoSetup = normalizeAutoSetup(raw);
    if (autoSetup === true) {
      autoSetup = [...bound].sort();
    } else if (!autoSetup.length) {
      fail("--types must be true or a non-empty JSON array of package types");
    } else {
      const allowed = new Set(PACKAGE_TYPES);
      for (const t of autoSetup) {
        if (!allowed.has(t)) fail(`unsupported package type: ${t}`);
        if (!boundSet.has(t)) {
          fail(
            `auto-setup type not in defaultGlobalRepos: ${t} (bound: ${bound.sort().join(", ")})`,
          );
        }
      }
    }
  }
  mergeAgentsConfigPatch({ packageResolution: { autoSetup } });
  process.stdout.write(`${JSON.stringify({ ok: true, autoSetup })}\n`);
}

function cmdDismiss(opts) {
  if (opts.type !== undefined) {
    const allowed = new Set(PACKAGE_TYPES);
    if (!allowed.has(opts.type)) {
      fail(`unsupported package type: ${opts.type}`);
    }
    const out = dismissOnboardingType(opts.type);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }
  dismissOnboardingPrompt();
  process.stdout.write(
    `${JSON.stringify({ ok: true, onboardingPrompt: "off" })}\n`,
  );
}

function cmdOnboardingProcedure() {
  const templatePath = path.join(
    here,
    "../onboarding/package-resolution-onboarding-procedure.md",
  );
  let body;
  try {
    body = readFileSync(templatePath, "utf8");
  } catch (err) {
    fail(`onboarding-procedure template unreadable: ${err?.message ?? err}`);
  }
  const configurePath = path.join(here, "configure.mjs");
  const printPath = path.join(here, "print-policy.mjs");
  body = body.replace(/\{\{CONFIGURE_COMMAND\}\}/g, configurePath);
  body = body.replace(/\{\{PRINT_POLICY_COMMAND\}\}/g, printPath);
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

async function main() {
  setLogContext({ ide: "configure" });
  const { command, opts } = parseArgs(process.argv);
  if (!command || opts.help) {
    process.stdout.write(usage());
    process.exit(command ? 0 : 1);
  }
  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "verify-repo":
      await cmdVerifyRepo(opts);
      break;
    case "enable":
      await cmdEnable(opts);
      break;
    case "auto-setup":
      cmdAutoSetup(opts);
      break;
    case "dismiss":
      cmdDismiss(opts);
      break;
    case "onboarding-procedure":
      cmdOnboardingProcedure();
      break;
    default:
      fail(`unknown command: ${command}\n${usage()}`);
  }
}

main().catch((err) => {
  log.warn("configure failed", { error: err?.message ?? String(err) });
  fail(err?.message ?? String(err));
});
