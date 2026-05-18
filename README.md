# JFrog Cursor Plugin (Experimental)

JFrog Platform integration for [Cursor](https://cursor.com) — artifact management, security scanning, and supply-chain best practices powered by the JFrog MCP Server.

## What's included

| Component | Path | Description |
|---|---|---|
| **MCP** | `plugins/jfrog/mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Skills** | `plugins/jfrog/skills/` | 11 AI skills covering Artifactory, Security, Access, CLI, Curation, Distribution, AppTrust, Runtime, Mission Control, Workers, and Patterns |
| **Rule** | `plugins/jfrog/rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `plugins/jfrog/agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |
| **Hook** | `plugins/jfrog/hooks/hooks.json` + `plugins/jfrog/scripts/inject-instructions.mjs` | `sessionStart` hook gated by the `JF_AGENT_GUARD_FORCE_ENABLE` env var: when set to `"true"` it injects `templates/jfrog-mcp-management.md` as `additional_context`; otherwise it emits `{}` and stays silent |
| **Template** | `plugins/jfrog/templates/jfrog-mcp-management.md` | Agent Guard governance rule body — loaded by the hook above (not auto-discovered as a Cursor rule) only when `JFROG_AGENT_GUARD_FORCE_ENABLE=true` or when the administration AI/ML settings are enabled via the platform. Teaches the agent how to add, remove, and list MCP servers exclusively through `npx @jfrog/agent-guard`. |

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
