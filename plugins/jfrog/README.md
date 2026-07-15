# jfrog

JFrog Platform integration for Cursor — artifact management, security scanning, supply-chain best practices, and Agent Guard.

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted).
2. An admin must **enable the JFrog MCP Server** on the platform (Cloud/SaaS only):
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g., `mycompany.jfrog.io`).
4. **JFrog CLI** (`jf`) is used by the skills for authentication and REST/GraphQL API operations. If missing, the agent will attempt to install it. You can also install manually via `brew install jfrog-cli` or the [official install script](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli).
5. **JFrog CLI ≥ 2.105.0** (optional) — required if you want the Agent Guard hook to auto-resolve credentials/server ID from the JFrog CLI instead of `JFROG_URL`/`JFROG_ACCESS_TOKEN` env vars. Older CLIs don't support the `--format` flag used by `jf config show`/`jf config export` for this.

CLI authentication options: run `jf login` for browser-based setup, or set the `JFROG_ACCESS_TOKEN` environment variable. MCP-based workflows authenticate via **OAuth** and require no additional configuration.

## Included

| Component | Path | Description |
|---|---|---|
| **MCP** | `mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Hook** | `hooks/hooks.json` | Agent Guard — MCP server governance via JFrog AI Catalog |

### Skills

| Skill | Triggers when you mention... |
|-------|------------------------------|
| **jfrog** | any JFrog product, artifactory, xray, security, access token, curation, distribution, release bundle, apptrust, runtime, mission control, worker, jf command, or best practice |
| **jfrog-ai-catalog-skills** | discovering/installing/updating/publishing agent skills, JFrog AI Catalog, `jf skills`, Agent Guard |
| **jfrog-package-safety-and-download** | package safety, curation, allowed/blocked packages, downloading packages via JFrog |

The **jfrog** skill (`skills/jfrog/`) provides platform-wide coverage via MCP tools, JFrog CLI commands, and `jf api` REST/GraphQL. It includes 24 reference files under `references/` and 3 automation scripts under `scripts/` covering Artifactory, Security/Xray, Access, Distribution, Curation, AppTrust, Mission Control, Workers, and architectural patterns.

The **jfrog-ai-catalog-skills** skill (`skills/jfrog-ai-catalog-skills/`) discovers, installs, manages, and publishes agent skills hosted in the JFrog AI Catalog via `jf skills` and Agent Guard.

The **jfrog-package-safety-and-download** skill (`skills/jfrog-package-safety-and-download/`) handles package safety checks — querying the JFrog Public Catalog, interpreting security signals, checking curation policies, and downloading packages through Artifactory remote caches.

## MCP Capabilities

The JFrog MCP Server provides:

- **Resource Management** — create and manage projects and repositories
- **Artifact Search** — AQL queries to find artifacts across your organization
- **Catalog & Curation** — package info, vulnerability status, curation compliance
- **Security Monitoring** — real-time DevSecOps reports and CVE tracking
