# jfrog

JFrog Platform integration for Cursor — artifact management, security scanning, supply-chain best practices, and Agent Guard.

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted).
2. An admin must **enable the JFrog MCP Server** on the platform (Cloud/SaaS only):
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g., `mycompany.jfrog.io`).
4. **JFrog CLI** (`jf`) is used by the skills for authentication and REST/GraphQL API operations. If missing, the agent will attempt to install it. You can also install manually via `brew install jfrog-cli` or the [official install script](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli).
5. **JFrog CLI ≥ 2.105.0** (optional) — required if you want the Agent Guard to auto-resolve credentials/server ID from the JFrog CLI instead of `JFROG_URL`/`JFROG_ACCESS_TOKEN` env vars. Older CLIs don't support the `--format` flag used by `jf config show`/`jf config export` for this.

CLI authentication options: run `jf login` for browser-based setup, or set the `JFROG_ACCESS_TOKEN` environment variable. MCP-based workflows authenticate via **OAuth** and require no additional configuration.

## Included

| Component | Path | Description |
|---|---|---|
| **MCP** | `mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Hook + Skill** | `hooks/hooks.json`, `skills/jfrog-setup-package-managers/` | Agent Package Resolution (Preview) — route agent package installs through Artifactory |
| **Hook** | `hooks/hooks.json`, `scripts/cursor-align-mcp-json.mjs` (+ `cursor-mcp-json-discover.mjs`) | On session start, rewrite discovered plugin `mcp.json` / `.mcp.json` files through Agent Guard (`--rewrite-mcp-json`) so stdio MCP entries launch via `@jfrog/agent-guard` |

### Skills

| Skill | Triggers when you mention... |
|-------|------------------------------|
| **jfrog** | any JFrog product, artifactory, xray, security, access token, curation, distribution, release bundle, apptrust, runtime, mission control, worker, jf command, or best practice |
| **jfrog-ai-catalog-skills** | discovering/installing/updating/publishing agent skills, JFrog AI Catalog, `jf skills`, Agent Guard |
| **jfrog-package-safety-and-download** | package safety, curation, allowed/blocked packages, downloading packages via JFrog |

The **jfrog** skill (`skills/jfrog/`) provides platform-wide coverage via MCP tools, JFrog CLI commands, and `jf api` REST/GraphQL. It includes 24 reference files under `references/` and 3 automation scripts under `scripts/` covering Artifactory, Security/Xray, Access, Distribution, Curation, AppTrust, Mission Control, Workers, and architectural patterns.

The **jfrog-ai-catalog-skills** skill (`skills/jfrog-ai-catalog-skills/`) discovers, installs, manages, and publishes agent skills hosted in the JFrog AI Catalog via `jf skills` and Agent Guard.

The **jfrog-package-safety-and-download** skill (`skills/jfrog-package-safety-and-download/`) handles package safety checks — querying the JFrog Public Catalog, interpreting security signals, checking curation policies, and downloading packages through Artifactory remote caches.

## Agent Package Resolution (Preview)

> **Preview Notice:** This feature is in preview and licensed under the Apache License 2.0. For clarity: This software is provided "as-is" without warranty of any kind, and without support obligations or service level commitments. Behavior, APIs, conventions, and structure may change without notice between releases. JFrog makes no guarantees of backward compatibility during the preview release cycle. Use in production environments is at your own risk.

The plugin can automatically route the packages your AI agent installs (npm, PyPI, Maven, Go, Docker, Helm, and NuGet) through your organization's JFrog Artifactory instead of public registries. This keeps agent-driven dependency installs inside your organization's governance perimeter.

Agent Package Resolution is in preview. The shipped template enables it with empty repository bindings (nothing is routed until Consent Enable or an admin adds `defaultGlobalRepos`). To get started:

- **Users:** see the [User Guide](https://github.com/jfrog/cursor-plugin/blob/main/docs/package-resolution-user-guide.md).
- **Admins:** see the [Admin Guide](https://github.com/jfrog/cursor-plugin/blob/main/docs/package-resolution-admin-guide.md).

## Plugin MCP rewrite (Agent Guard)

On every Cursor agent `sessionStart`, the plugin discovers plugin `mcp.json` and `.mcp.json` files under `~/.cursor/plugins/local/*` and `~/.cursor/plugins/cache/*` (marketplace installs), plus this plugin's own configs, and runs `npx @jfrog/agent-guard --rewrite-mcp-json` against those paths. Cursor can load servers from both files when both exist. Stdio MCP entries are rewritten to launch through Agent Guard; remote `url` / `http` / `sse` / `ws` entries are left unchanged. Workspace and user-level `.cursor/mcp.json` files are **not** rewritten. If a file is rewritten, the sessionStart hook asks you to **open a new session** so Cursor reconnects those MCPs.

Marketplace installs under `~/.cursor/plugins/cache` are rewritten by default (opt out via env below). Auto-discovered roots must resolve under `~/.cursor` (symlink escapes are skipped); `JF_ALIGN_MCP_JSON_ROOTS` overrides are trusted as-is and skip this plugin's own `mcp.json` unless you list that root yourself. `CURSOR_CONFIG_DIR` (CLI config) is **not** used for plugin discovery — Cursor loads plugins from `~/.cursor` regardless.

The hook soft-fails (never breaks the session): missing project key, Agent Guard gate failure, or rewrite errors log and exit 0.

| Env | Purpose |
|---|---|
| `JF_AGENT_REWRITE_MCP_JSON_DISABLE=1` | Kill switch — skip rewrite entirely |
| `JF_PROJECT` / `JFROG_PROJECT` | Project key (also inferred from existing `_JF_ARGS project=` in discovered mcp.json) |
| `JF_SERVER` / `JFROG_SERVER_ID` | Optional server ID for the gate / `--server` |
| `JFROG_AGENT_GUARD_VERSION` | Override pinned `@jfrog/agent-guard` version |
| `JFROG_AGENT_GUARD_REPO` | Private npm registry for `@jfrog/agent-guard` |
| `JFROG_AGENT_GUARD_BIN` | Local Agent Guard binary (skips npx) |
| `JF_ALIGN_MCP_JSON_ROOTS` | Replace discovery roots entirely (POSIX `:`/`,`; Windows `;`/`,`). Does not auto-include this plugin's own `mcp.json` |
| `JF_ALIGN_MCP_JSON_SKIP_CACHE=1` | Skip `~/.cursor/plugins/cache` (marketplace installs; scanned by default) |

## MCP Capabilities

The JFrog MCP Server provides:

- **Resource Management** — create and manage projects and repositories
- **Artifact Search** — AQL queries to find artifacts across your organization
- **Catalog & Curation** — package info, vulnerability status, curation compliance
- **Security Monitoring** — real-time DevSecOps reports and CVE tracking
