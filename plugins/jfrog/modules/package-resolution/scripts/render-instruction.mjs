// Render the package-resolution session-start instruction text.
//
// Extracted from the poc `inject-instructions.mjs` main(): this is the pure,
// harness-agnostic renderer. It returns a markdown STRING (no stdin/stdout, no
// IDE-specific shaping) so every per-harness adapter can reuse it.
//
//   mode "off"      → "" (nothing to inject)
//   mode "enforce"  → the advisory "routing not ready" notice
//   mode "active"   → the routing policy with resolved Artifactory URLs

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resolve as resolveRepo,
  getResolveSessionMeta,
  prepareSessionResolve,
  PACKAGE_TYPES,
} from "./resolver.mjs";
import { createLogger } from "../../core/logger.mjs";

const log = createLogger("render-instruction");

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(here, "../templates");
const ACTIVE_TEMPLATE = "package-resolution.md";
const ENFORCE_TEMPLATE = "package-resolution-unconfigured.md";

// Prose fragment for the enforce-notice {{CAUSE_REMEDIATION}} placeholder.
function causeRemediation(cause) {
  if (cause === "jf-not-installed") {
    return (
      "Begin by installing the JFrog CLI (`jf`) and adding it to PATH, then " +
      "configure a JFrog server by following the login flow in the base " +
      "`jfrog` skill."
    );
  }
  return (
    "The JFrog CLI is installed and ready. Configure a JFrog server by " +
    "following the login flow in the base `jfrog` skill to finish enabling " +
    "routing."
  );
}

function jfrogPlatformUrlHint() {
  const raw = process.env.JFROG_PLATFORM_URL?.trim();
  if (!raw) {
    return (
      "When configuring `jf`, check whether `JFROG_PLATFORM_URL` is set in the " +
      "IDE launch environment and use it as the platform URL (`jfrog-login-flow.md`)."
    );
  }
  return (
    "IDE launch env `JFROG_PLATFORM_URL` is `" +
    raw +
    "` — use this when configuring `jf` (web login or `jf config add --url`; " +
    "prefix `https://` if the value is hostname-only)."
  );
}

// Rewrite "## Rewrite templates" bullets that still reference an unresolved PM
// so the agent never sees a usable-but-wrong example URL. Operates only on that
// section so the resolved-URLs table (which intentionally surfaces the
// placeholder) is untouched.
function rewriteUnresolvedBullets(markdown) {
  const lines = markdown.split("\n");
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+Rewrite templates\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/<no\s+(\w+)\s+repo\s+resolved>/);
    if (!m) continue;
    const pm = m[1].toLowerCase();
    lines[i] =
      `- \`${pm}\` — **unresolved** (no Artifactory repo for this PM yet). ` +
      `Per hard rule #5, do not invent a URL: invoke \`jfrog-setup-package-managers\` ` +
      `for \`${pm}\` BEFORE any direct command. Once the binding is recorded, ` +
      `route subsequent \`${pm}\` commands through the resolved URL yourself.`;
  }
  return lines.join("\n");
}

/**
 * Render the instruction text for a resolved feature-flag result.
 *
 * Returns BOTH the markdown and a flat `meta` object describing what happened
 * (cause / resolved repos / cache file / source …). The dispatcher folds `meta`
 * into its single "sessionStart injected" EVENT line so the default-level log
 * stays one line but still carries the detail the POC printed.
 *
 * @param {{ mode: "off"|"enforce"|"active", cause?: string }} flag
 * @param {{ workspaceRoots?: string[] }} [ctx]
 * @returns {Promise<{ text: string, meta: object }>} text is "" when there is
 *   nothing to inject.
 */
export async function renderInstruction(flag, ctx = {}) {
  if (!flag || flag.mode === "off") return { text: "", meta: { mode: "off" } };

  if (flag.mode === "enforce") {
    let notice = await readFile(path.join(TEMPLATES_DIR, ENFORCE_TEMPLATE), "utf8");
    notice = notice.replace(/\{\{CAUSE_REMEDIATION\}\}/g, causeRemediation(flag.cause));
    notice = notice.replace(/\{\{JFROG_PLATFORM_URL_HINT\}\}/g, jfrogPlatformUrlHint());
    // Detail line — kept at debug so the default level shows a single EVENT per
    // session (the dispatcher's "sessionStart injected"). Raise the level to see
    // the cause/byte breakdown.
    log.debug("enforce notice rendered", { cause: flag.cause, bytes: notice.length });
    return {
      text: notice,
      meta: { cause: flag.cause, template: ENFORCE_TEMPLATE },
    };
  }

  // active: pre-resolve every package type and substitute concrete URLs.
  await prepareSessionResolve({ workspaceRoots: ctx.workspaceRoots });
  const resolved = {};
  const unresolved = [];
  for (const t of PACKAGE_TYPES) {
    const r = await resolveRepo(t);
    if (r) resolved[t] = r;
    else unresolved.push(t);
  }

  let template = await readFile(path.join(TEMPLATES_DIR, ACTIVE_TEMPLATE), "utf8");
  template = template.replace(/\{\{(\w+)_URL\}\}/g, (_, type) => {
    const r = resolved[type.toLowerCase()];
    return r ? r.baseUrl : `<no ${type} repo resolved>`;
  });
  template = rewriteUnresolvedBullets(template);

  const resolvedCompact =
    Object.entries(resolved).map(([t, r]) => `${t}:${r.repoKey}`).join(",") || "-";
  const unresolvedCompact = unresolved.join(",") || "-";

  const rm = getResolveSessionMeta();
  // Detail line — kept at debug (see the enforce branch above) so the default
  // level shows a single EVENT per session.
  log.debug("active instruction rendered", {
    resolved: resolvedCompact,
    unresolved: unresolvedCompact,
    source: rm?.source ?? "-",
    bytes: template.length,
  });

  const meta = {
    source: rm?.source ?? "-",
    serverId: rm?.serverId ?? "-",
    cacheFile: rm?.cacheFile ?? "-",
    cacheHit: rm?.cacheHit ?? false,
    resolveSource: rm?.resolveSource ?? "-",
    resolved: resolvedCompact,
    unresolved: unresolvedCompact,
    template: ACTIVE_TEMPLATE,
  };

  // Workspace fields only when a local file was read and applied to resolution.
  if (rm?.workspaceConfigFile) {
    meta.workspaceRootsCount = rm.workspaceRootsCount;
    meta.workspaceConfigFile = rm.workspaceConfigFile;
    meta.workspaceOverrides = rm.workspaceOverrides;
  }

  return { text: template, meta };
}

export { getResolveSessionMeta };
