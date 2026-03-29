# JFrog Cursor Plugin (Experimental)

JFrog Platform integration for [Cursor](https://cursor.com) — artifact management, security scanning, and supply-chain best practices powered by the JFrog MCP Server.

## What's included

| Component | Path | Description |
|---|---|---|
| **MCP** | `plugins/jfrog/mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Skill** | `plugins/jfrog/skills/jfrog-platform/` | AI guidance for JFrog Platform operations |
| **Rule** | `plugins/jfrog/rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `plugins/jfrog/agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |

## Prerequisites

1. A **JFrog Cloud (SaaS)** subscription.
2. An admin enables the **JFrog MCP Server** on the platform:
   - **Administration > General > Settings > MCP Server** → toggle ON.
3. Each developer configures Cursor with their JFrog Platform URL (see [Setup](#setup)).

## Setup

1. Install the plugin in Cursor.
2. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g. `mycompany.jfrog.io`).
3. Restart Cursor. An OAuth window opens in your browser — authorize access.

No tokens or API keys are required. Authentication is handled via OAuth.

## Validation

```bash
node scripts/validate-template.mjs
```
