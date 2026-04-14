# JFrog Cursor Plugin (Experimental)

JFrog Platform integration for [Cursor](https://cursor.com) — artifact management, security scanning, and supply-chain best practices powered by the JFrog MCP Server.

## What's included

| Component | Path | Description |
|---|---|---|
| **MCP** | `plugins/jfrog/mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Skill** | `plugins/jfrog/skills/` | Unified AI skill covering Artifactory, Security, Access, CLI, Curation, Distribution, AppTrust, Runtime, Mission Control, Workers, and architectural patterns |
| **Rule** | `plugins/jfrog/rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `plugins/jfrog/agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted, version 7.64.0+).
2. An admin must **enable the JFrog MCP Server** on the platform (Cloud/SaaS only):
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. **JFrog CLI** (`jf`) — see [install options](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli): `brew install jfrog-cli` (macOS), `curl -fL https://install-cli.jfrog.io | sh` (Linux), `choco install jfrog-cli` (Windows). Used by several skills for authentication and REST operations.

## Installation

### 1. Add the plugin registry to Cursor

Open Cursor and go to **Settings → Features → Plugins**. Add this repository as a plugin source:

```
https://github.com/jfrog/cursor-plugin
```

Install the **jfrog** plugin from the list.

### 2. Set your JFrog Platform URL

**macOS / Linux** — add to your shell profile (`~/.zshrc`, `~/.bashrc`, or equivalent):

```bash
export JFROG_PLATFORM_URL=mycompany.jfrog.io
```

**Windows (PowerShell):**

```powershell
[System.Environment]::SetEnvironmentVariable('JFROG_PLATFORM_URL', 'mycompany.jfrog.io', 'User')
```

Reload your shell or open a new terminal.

### 3. Restart Cursor and authenticate

Restart Cursor. An OAuth browser window will open — authorize access to your JFrog instance. No API keys or tokens are needed.

For CLI-based skills, authenticate once:

```bash
jf config add
```

Follow the browser login prompt. Credentials are stored in `~/.jfrog/jfrog-cli.conf.v6` and reused automatically.

## Uninstallation

1. Go to **Settings → Features → Plugins** in Cursor and uninstall the **jfrog** plugin.
2. Remove the plugin registry source from the same settings page.
3. Remove `JFROG_PLATFORM_URL` from your shell profile.
4. Optionally clean up JFrog CLI credentials: `jf config remove <server-id>`

## Validation

```bash
node scripts/validate-template.mjs
```
