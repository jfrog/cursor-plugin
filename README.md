# JFrog Cursor Plugin (Experimental)

JFrog Platform integration for [Cursor](https://cursor.com) — artifact management, security scanning, and supply-chain best practices powered by the JFrog MCP Server.

## What's included

| Component | Path | Description |
|---|---|---|
| **MCP** | `plugins/jfrog/mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Skills** | `plugins/jfrog/skills/` | 11 AI skills covering Artifactory, Security, Access, CLI, Curation, Distribution, AppTrust, Runtime, Mission Control, Workers, and Patterns |
| **Rule** | `plugins/jfrog/rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `plugins/jfrog/agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted).
2. An admin enables the **JFrog MCP Server** on the platform (Cloud/SaaS only):
   - **Administration > General > Settings > MCP Server** → toggle ON.
3. Each developer configures Cursor with their JFrog Platform URL (see [Setup](#setup)).
4. **JFrog CLI** (`jf`) is used by several skills for authentication and REST API operations. It will be installed automatically if missing. Install manually via `brew install jfrog-cli` or the [official install script](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli).

## Setup

1. Install the plugin in Cursor.
2. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g. `mycompany.jfrog.io`).
3. Restart Cursor. An OAuth window opens in your browser — authorize access.

No manual tokens or API keys are required. MCP workflows use OAuth; CLI/REST-based skills authenticate automatically via `jf config` browser login.

## Validation

```bash
node scripts/validate-template.mjs
```
