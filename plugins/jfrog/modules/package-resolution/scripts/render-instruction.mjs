// Render the package-resolution session-start instruction text.
//
// Extracted from the poc `inject-instructions.mjs` main(): this is the pure,
// harness-agnostic renderer. It returns a markdown STRING (no stdin/stdout, no
// IDE-specific shaping) so every per-harness adapter can reuse it.
//
//   mode "off"      → "" (nothing to inject)
//   mode "pending"  → the advisory "routing not ready" notice
//   mode "routing"  → the routing policy with resolved Artifactory URLs

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resolve as resolveRepo,
  getResolveSessionMeta,
  prepareSessionResolve,
  governedPackageTypes,
} from "./resolver.mjs";
import { createLogger } from "../../core/logger.mjs";
import { globalDeclaredTypes } from "../../core/agents-config.mjs";
import { IdentityCause } from "../../core/jf-identity.mjs";

const log = createLogger("render-instruction");

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(here, "../templates");
const ROUTING_TEMPLATE = "package-resolution.md";
const PENDING_TEMPLATE = "package-resolution-unconfigured.md";

// Command the agent runs after configuring `jf` to load routing in the SAME
// session (no restart). Absolute path so it works regardless of the agent's cwd
// or where the plugin is vendored.
function refreshCommand() {
  return `node "${path.join(here, "print-policy.mjs")}"`;
}

// Opening-clause fragment for the pending-notice {{CAUSE_INTRO}} placeholder.
// Kept in sync with causeRemediation / causeChecklist so the notice never
// contradicts itself (intro vs remediation vs numbered steps).
function causeIntro(cause) {
  if (cause === IdentityCause.JF_NOT_INSTALLED) {
    return "`jf` is not installed (or not on PATH)";
  }
  if (cause === IdentityCause.JF_UNSUPPORTED_AUTH) {
    return (
      "`jf` has a configured server, but its auth method is not supported " +
      "(need an access token or username + password / API key)"
    );
  }
  if (cause === IdentityCause.JF_AUTH_FAILED) {
    return "`jf` credentials were rejected by Artifactory (expired, revoked, or wrong)";
  }
  if (cause === IdentityCause.INSECURE_URL) {
    return "`jf` is configured with a non-HTTPS platform URL (credentials would be sent in cleartext)";
  }
  if (cause === IdentityCause.JF_UNREACHABLE) {
    return "Artifactory did not respond to a readiness probe (network / URL / outage)";
  }
  return "`jf` has no configured server";
}

// Prose fragment for the pending-notice {{CAUSE_REMEDIATION}} placeholder.
function causeRemediation(cause) {
  if (cause === IdentityCause.JF_NOT_INSTALLED) {
    return (
      "Begin by installing the JFrog CLI (`jf`) and adding it to PATH, then " +
      "configure a JFrog server by following the login flow in the base " +
      "`jfrog` skill."
    );
  }
  if (cause === IdentityCause.JF_UNSUPPORTED_AUTH) {
    return (
      "The JFrog CLI is installed and a server is configured, but Agent " +
      "Package Resolution only supports access-token or username + password " +
      "/ API-key auth. Reconfigure with `jf config add` using one of those " +
      "methods (SSH-key-only servers are not supported)."
    );
  }
  if (cause === IdentityCause.JF_AUTH_FAILED) {
    return (
      "The JFrog CLI is installed and a server is configured, but Artifactory " +
      "rejected the credentials. Refresh the access token or password / API " +
      "key with `jf config add` / re-login, then retry."
    );
  }
  if (cause === IdentityCause.INSECURE_URL) {
    return (
      "The JFrog CLI is installed and a server is configured, but the platform " +
      "URL is not HTTPS. Reconfigure with `jf config add` using an https:// URL " +
      "so credentials are not sent in cleartext."
    );
  }
  if (cause === IdentityCause.JF_UNREACHABLE) {
    return (
      "The JFrog CLI is installed and a server is configured, but Artifactory " +
      "did not answer a readiness probe. Confirm the platform URL, network, " +
      "and that Artifactory is up, then retry."
    );
  }
  return (
    "The JFrog CLI is installed and ready. Configure a JFrog server by " +
    "following the login flow in the base `jfrog` skill to finish enabling " +
    "routing."
  );
}

// Numbered steps for {{CAUSE_CHECKLIST}}. When jf is already present, omit the
// "Confirm jf is installed" step so it does not contradict remediation.
function causeChecklist(cause) {
  const configure =
    "Configure a JFrog server (login flow or `jf config add` with access " +
    "token or username + password / API key);\n" +
    "   confirm with `jf config show`.";
  const reconfigure =
    "Reconfigure the server with a supported auth method (`jf config add` " +
    "with access token or username + password / API key);\n" +
    "   confirm with `jf config show`.";
  const refreshCreds =
    "Refresh credentials (`jf config add` / re-login) and confirm with " +
    "`jf config show`.";
  const reconfigureHttps =
    "Reconfigure the server with an https:// platform URL (`jf config add`) " +
    "and confirm with `jf config show`.";
  const checkReachable =
    "Confirm the platform URL is reachable and Artifactory is healthy, " +
    "then retry.";
  const setup =
    "Invoke **`jfrog-setup-package-managers`** to bind package managers this workspace needs.";
  if (cause === IdentityCause.JF_NOT_INSTALLED) {
    return (
      "1. Confirm `jf` is installed (`jf --version`).\n" +
      `2. ${configure}\n` +
      `3. ${setup}`
    );
  }
  if (cause === IdentityCause.JF_UNSUPPORTED_AUTH) {
    return `1. ${reconfigure}\n2. ${setup}`;
  }
  if (cause === IdentityCause.JF_AUTH_FAILED) {
    return `1. ${refreshCreds}\n2. ${setup}`;
  }
  if (cause === IdentityCause.INSECURE_URL) {
    return `1. ${reconfigureHttps}\n2. ${setup}`;
  }
  if (cause === IdentityCause.JF_UNREACHABLE) {
    return `1. ${checkReachable}\n2. ${setup}`;
  }
  return `1. ${configure}\n2. ${setup}`;
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

const NO_REPO = (type) => `<no ${type} repo resolved>`;

// Resolved-URLs markdown table for the governed types (one row each). Ungoverned
// types are omitted entirely; governed-but-unresolved types keep a placeholder
// row so hard-rule #5 can steer the agent to setup.
function buildResolvedTable(governed, resolved) {
  const rows = governed.map((type) => {
    const url = resolved[type]?.baseUrl ?? NO_REPO(type);
    return `| ${type} | \`${url}\` |`;
  });
  return ["| Type | Use this URL |", "|---|---|", ...rows].join("\n");
}

// Per-type "## Rewrite templates" bullet(s). Unresolved governed types get the
// "do not invent a URL" bullet instead so the agent never sees a wrong example.
function rewriteBulletFor(type, resolved) {
  const r = resolved[type];
  if (!r) {
    return (
      `- \`${type}\` — **unresolved**. Per hard rule #5: invoke \`jfrog-setup-package-managers\` ` +
      `for \`${type}\` BEFORE any direct command; then route via the resolved URL.`
    );
  }
  const url = r.baseUrl;
  switch (type) {
    case "npm":
      return (
        `- \`npm install <pkg>\` → \`npm install <pkg> --registry ${url}\`\n` +
        `- \`pnpm add <pkg>\` / \`pnpm install\` → \`pnpm add <pkg> --registry ${url}\``
      );
    case "pypi":
      return (
        `- \`pip install <pkg>\` → \`pip install <pkg> --index-url ${url}\`\n` +
        `- \`pipenv install <pkg>\` → \`pipenv install <pkg> --pypi-mirror ${url}\`\n` +
        `- \`uv add <pkg>\` → \`UV_DEFAULT_INDEX=${url} uv add <pkg>\` (or \`uv add --default-index ${url} <pkg>\`)\n` +
        `- \`uv pip install <pkg>\` → \`uv pip install <pkg> --index-url ${url}\``
      );
    case "go":
      return `- \`go get <mod>\` → \`GOPROXY=${url},direct go get <mod>\``;
    case "docker":
      return (
        `- \`docker pull [<public-host>/]acme/app:1.2\` → \`docker pull ${url}/acme/app:1.2\` ` +
        `(drop leading PUBLIC hosts: \`docker.io\`, \`ghcr.io\`, \`quay.io\`, \`gcr.io\`, …. ` +
        `Leave \`localhost\`/\`127.0.0.1\`, private/internal registries, and the JFrog host as-is; ` +
        `if unsure, resolve the host — a private/loopback IP means internal, leave it)\n` +
        `- \`podman pull …\` → same prefix rules against \`${url}\``
      );
    case "maven":
      return `- \`mvn ...\` → config-driven; run \`jfrog-setup-package-managers\` if not yet bound.`;
    case "gradle":
      return `- \`gradle ...\` → config-driven; run \`jfrog-setup-package-managers\` if not yet bound.`;
    case "helm":
      return `- \`helm ...\` → config-driven; run \`jfrog-setup-package-managers\` if not yet bound.`;
    case "nuget":
      return `- \`nuget\` / \`dotnet ...\` → config-driven; run \`jfrog-setup-package-managers\` if not yet bound.`;
    default:
      return `- \`${type} ...\` → config-driven; run \`jfrog-setup-package-managers\` if not yet bound.`;
  }
}

function buildRewriteBullets(governed, resolved) {
  return governed.map((type) => rewriteBulletFor(type, resolved)).join("\n");
}

// The "## Docker" section, rendered ONLY when docker is governed. Empty string
// otherwise so ungoverned docker never appears in the policy.
function buildDockerSection(governed, resolved) {
  if (!governed.includes("docker")) return "";
  const resolvedDocker = resolved.docker;
  const body = resolvedDocker
    ? [
        "- **Bare refs go to Docker Hub.** `docker pull alpine:latest` (no host) uses",
        "  `docker.io` — `jf setup docker` does **not** change that. Prefix with the docker",
        "  row above: `docker pull <host>/<repoKey>/<img>` (`host/repoKey`, not `https://…`).",
        "- **Explicit hosts too.** `docker pull ghcr.io/foo/bar` (or any registry host) — also",
        "  route through JFrog via the docker row; do not pull the upstream host directly.",
      ].join("\n")
    : [
        "- **Unresolved docker ⇒ no docker commands.** Do not run `docker pull/run/create`",
        "  until setup completes and you have a prefixed ref. Do not try first, fix later.",
      ].join("\n");
  return "\n## Docker (before any `docker pull`)\n\n" + body + "\n";
}

// Agent Guard carve-out only when npm is governed (the exception is npm-scoped).
function buildAgentGuardSection(governed) {
  if (!governed.includes("npm")) return "";
  return [
    "**Agent Guard bootstrap — exception to Decision step 4 and hard rule #7.** A command that installs",
    "`@jfrog/agent-guard` and no other package may keep the registry its Agent Guard policy specifies",
    "(e.g. `npx --yes --registry <url> @jfrog/agent-guard`). Nothing else is covered. This exception",
    "never authorizes a public registry, and it never widens to another package.",
    "",
  ].join("\n");
}

// Pending-mode scope line — the governed package managers are known from config
// alone (no network / no resolution needed). Notes that matching package
// managers will be
// auto-configured once routing is ready. Does NOT claim any type is routed yet.
function buildPendingGovernedScope() {
  const governed = globalDeclaredTypes();
  if (!governed.length) {
    return (
      "No package managers are declared for routing yet (`defaultGlobalRepos` is empty). " +
      "Ask an admin which package managers to govern."
    );
  }
  return (
    `**Governed package managers (once ready):** ${governed.join(", ")}. ` +
    "Package managers not listed are out of scope. Matching package managers may be auto-configured " +
    "via `jf setup` once a JFrog server is configured; nothing is routed until then."
  );
}

// "This policy governs only: …" scope line so the agent knows which package managers are in
// scope and treats everything else as hands-off.
function buildGovernedScope(governed) {
  if (!governed.length) {
    return (
      "**This policy governs no package managers** (none declared in " +
      "`defaultGlobalRepos`). Install packages normally; no JFrog routing required."
    );
  }
  return (
    `**This policy governs only:** ${governed.join(", ")}. ` +
    "Package managers not listed are out of scope — install them normally; no JFrog routing required."
  );
}

/**
 * Render the instruction text for a resolved feature-flag result.
 *
 * Returns BOTH the markdown and a flat `meta` object describing what happened
 * (cause / resolved repos / cache file / source …). The dispatcher folds `meta`
 * into its single "sessionStart injected" EVENT line so the default-level log
 * stays one line but still carries the detail the POC printed.
 *
 * @param {{ mode: "off"|"pending"|"routing", cause?: string }} flag
 * @param {{ workspaceRoots?: string[] }} [ctx]
 * @returns {Promise<{ text: string, meta: object }>} text is "" when there is
 *   nothing to inject.
 */
export async function renderInstruction(flag, ctx = {}) {
  if (!flag || flag.mode === "off") return { text: "", meta: { mode: "off" } };

  if (flag.mode === "pending") {
    let notice = await readFile(
      path.join(TEMPLATES_DIR, PENDING_TEMPLATE),
      "utf8",
    );
    notice = notice.replace(/\{\{CAUSE_INTRO\}\}/g, causeIntro(flag.cause));
    notice = notice.replace(
      /\{\{CAUSE_REMEDIATION\}\}/g,
      causeRemediation(flag.cause),
    );
    notice = notice.replace(
      /\{\{CAUSE_CHECKLIST\}\}/g,
      causeChecklist(flag.cause),
    );
    notice = notice.replace(
      /\{\{JFROG_PLATFORM_URL_HINT\}\}/g,
      jfrogPlatformUrlHint(),
    );
    notice = notice.replace(/\{\{REFRESH_COMMAND\}\}/g, refreshCommand());
    notice = notice.replace(
      /\{\{GOVERNED_SCOPE\}\}/g,
      buildPendingGovernedScope(),
    );
    // Detail line — kept at debug so the default level shows a single EVENT per
    // session (the dispatcher's "sessionStart injected"). Raise the level to see
    // the cause/byte breakdown.
    log.debug("pending notice rendered", {
      cause: flag.cause,
      bytes: notice.length,
    });
    return {
      text: notice,
      meta: { cause: flag.cause, template: PENDING_TEMPLATE },
    };
  }

  // routing: resolve governed types (admin ∪ applied workspace overlay)
  // and build the table / bullets / docker section
  // dynamically so ungoverned types disappear entirely (not blocked).
  await prepareSessionResolve({ workspaceRoots: ctx.workspaceRoots });
  const governed = governedPackageTypes();
  const resolved = {};
  const unresolved = [];
  for (const t of governed) {
    const r = await resolveRepo(t);
    if (r) resolved[t] = r;
    else unresolved.push(t);
  }

  let template = await readFile(
    path.join(TEMPLATES_DIR, ROUTING_TEMPLATE),
    "utf8",
  );
  template = template
    .replace(/\{\{GOVERNED_SCOPE\}\}/g, buildGovernedScope(governed))
    .replace(/\{\{RESOLVED_TABLE\}\}/g, buildResolvedTable(governed, resolved))
    .replace(
      /\{\{REWRITE_BULLETS\}\}/g,
      buildRewriteBullets(governed, resolved),
    )
    .replace(/\{\{DOCKER_SECTION\}\}/g, buildDockerSection(governed, resolved))
    .replace(/\{\{AGENT_GUARD_SECTION\}\}/g, buildAgentGuardSection(governed))
    .replace(
      /\{\{AUTO_SETUP_STATUS\}\}/g,
      ctx.autoSetupStatus ? `\n${ctx.autoSetupStatus}\n` : "",
    );

  const resolvedCompact =
    Object.entries(resolved)
      .map(([t, r]) => `${t}:${r.repoKey}`)
      .join(",") || "-";
  const unresolvedCompact = unresolved.join(",") || "-";

  const rm = getResolveSessionMeta();
  // Detail line — kept at debug (see the pending branch above) so the default
  // level shows a single EVENT per session.
  log.debug("routing instruction rendered", {
    governed: governed.join(",") || "-",
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
    governed: governed.join(",") || "-",
    resolved: resolvedCompact,
    unresolved: unresolvedCompact,
    template: ROUTING_TEMPLATE,
  };

  // Workspace fields only when a local file was read and applied to resolution.
  if (rm?.workspaceConfigFile) {
    meta.workspaceRootsCount = rm.workspaceRootsCount;
    meta.workspaceConfigFile = rm.workspaceConfigFile;
    meta.workspaceOverrides = rm.workspaceOverrides;
  }

  return { text: template, meta };
}
