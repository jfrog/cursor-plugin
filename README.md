# JFrog MCP Integration for Cursor


JFrog Platform integration for [Cursor](https://cursor.com): artifact management, security scanning, supply-chain practices, the **JFrog MCP Server** (remote MCP), and optional **JFrog MCP Gateway** governance so approved MCP servers can be added, removed, and listed through the gateway (`npx @jfrog/mcp-gateway`).

## What's included

| Component | Path | Description |
| --- | --- | --- |
| **Manifest** | [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) | Plugin id `jfrog`, version, metadata, skills, hooks. |
| **MCP** | [`plugins/jfrog/mcp.json`](plugins/jfrog/mcp.json) | Remote JFrog MCP server URL (OAuth; uses `JFROG_PLATFORM_URL`). |
| **Skills** | [`plugins/jfrog/skills/`](plugins/jfrog/skills/) | JFrog AI skills (Artifactory, Security, Access, CLI, Curation, Distribution, AppTrust, Runtime, Mission Control, Workers, patterns, and more). |
| **Rule** | [`plugins/jfrog/rules/jfrog-security.mdc`](plugins/jfrog/rules/jfrog-security.mdc) | Supply-chain security guidance for dependency manifests. |
| **Agent** | [`plugins/jfrog/agents/supply-chain-security.md`](plugins/jfrog/agents/supply-chain-security.md) | Dependency audit workflow (CVEs, licenses, curation). |
| **Hook** | [`plugins/jfrog/hooks/hooks.json`](plugins/jfrog/hooks/hooks.json), [`plugins/jfrog/scripts/inject-instructions.mjs`](plugins/jfrog/scripts/inject-instructions.mjs) | `sessionStart` hook: when the gateway is enabled (platform setting or force flag), injects [`plugins/jfrog/templates/jfrog-mcp-management.md`](plugins/jfrog/templates/jfrog-mcp-management.md) as `additional_context`; otherwise emits `{}`. |
| **Template** | [`plugins/jfrog/templates/jfrog-mcp-management.md`](plugins/jfrog/templates/jfrog-mcp-management.md) | Gateway governance instructions for MCP management via `@jfrog/mcp-gateway`. |

---

## Prerequisites

Before installing, ensure you have:

- **JFrog Platform access** — Active account with the **AI Catalog** enabled.
- **Project configuration** — At least one MCP server allowed for your JFrog project.
- **JFrog host** — Platform URL and a way to authenticate (see [Authentication](#authentication)).
- **Cursor** — Installed with AI features enabled.
- **Node.js** — `node` and `npx` on your `PATH` (needed for on-demand `mcp-gateway` installation when using gateway workflows).
- **JFrog MCP Server (platform)** — An administrator enables it on the platform where supported (for example **Administration → General → Settings → MCP Server**). Developers set `JFROG_PLATFORM_URL` for the remote MCP entry in this plugin (see [Remote JFrog MCP (OAuth)](#remote-jfrog-mcp-oauth)).
- **JFrog CLI** (`jf`, optional but recommended) — Used by several skills and for `jf config add` authentication.

---

## Installation

### Install the Cursor plugin

Use either the marketplace link from the [Configure Cursor](https://docs.jfrog.com/ai-ml/docs/configure-cursor) documentation or Cursor’s UI:

1. Open **Cursor**.
2. Open **Cursor Settings** and select **Plugins**.
3. Search for **JFrog** and open the **JFrog** plugin.
4. Choose **Add to Cursor**, then **Add Plugin**.

---

## Authentication

### Option A — Environment variables

Use this if you are **not** relying on the JFrog CLI for URL and token. For the settings check used by the gateway hook, set **`JFROG_URL`** and **`JFROG_ACCESS_TOKEN`** together (legacy names `JF_URL` / `JF_ACCESS_TOKEN` are still read by the hook script if present).

| Variable | Description |
| --- | --- |
| `JFROG_URL` | Your JFrog platform URL, for example `https://mycompany.jfrog.io` |
| `JFROG_ACCESS_TOKEN` | Your JFrog access token |
| `JF_PROJECT` *(optional)* | Default project key. If unset, the agent may ask when a project context is required. |

**macOS / Linux (zsh or bash) — append to `~/.zshrc` (or `~/.bashrc`):**

```bash
echo 'export JFROG_URL="https://<your-host>"' >> ~/.zshrc
echo 'export JFROG_ACCESS_TOKEN="<your-token>"' >> ~/.zshrc
# Optional:
# echo 'export JF_PROJECT="<your-project-key>"' >> ~/.zshrc
source ~/.zshrc
```

Or edit the file with an editor, add the `export` lines, save, then `source ~/.zshrc`.

**Windows (PowerShell) — persistent user environment:**

```powershell
setx JFROG_URL "<your-platform-url>"
setx JFROG_ACCESS_TOKEN "<your-access-token>"
# Optional:
# setx JF_PROJECT "<your-project-key>"
```

Fully quit and reopen Cursor (and terminals) so new environment variables are inherited.

> **Security:** If you use a `.env` file for local development, add it to `.gitignore` so access tokens are never committed.

### Option B — JFrog CLI (`jf config add`)

1. Open a terminal.
2. Run:

```bash
jf config add
```

3. Follow the prompts for platform URL and access token.
4. Restart Cursor / your terminal so the environment and CLI config are picked up.

If you have **exactly one** server in `jf` config and `JFROG_URL` is not set, the tooling can default to that server. If you have **multiple** servers configured, set `JFROG_URL` / token explicitly or ensure your environment selects the intended server (see JFrog’s [Configure Cursor](https://docs.jfrog.com/ai-ml/docs/configure-cursor) guide for current behavior).

---

## Usage

| Ask the agent… | What happens |
| --- | --- |
| "Which MCP servers can I install?" | Lists servers approved for your current project. |
| "Show me the details for the filesystem MCP server." | Returns metadata, required env vars, and active tool policies. |
| "Add the GitHub MCP server." | Installs it and syncs tool policies. Secrets are requested via a CLI command — never in chat. |
| "Remove the Slack MCP server." | Uninstalls the server and its stored credentials. |
| "Switch my project to `backend-team`." | Re-syncs approved servers and policies for the new project. |
| "Which JFrog project am I working in?" | Shows the active project and the others you can access. |


---

## Troubleshooting

### The hook does not inject MCP-management instructions

Check, in order:

1. `JFROG_URL` and `JFROG_ACCESS_TOKEN` are set in the environment Cursor inherits (or use `jf config add` per JFrog docs).
2. The **`mcp_gateway_plugin_enabled`** account setting is enabled on the JFrog Platform, **or** you set `JF_MCP_GATEWAY_FORCE_ENABLE=true`.
3. Run with **`JF_AGENT_GUARD_DEBUG=true`** and inspect **stderr** for lines prefixed with `[jfrog-agent-guard]`.

### MCP fails to start

The plugin does not install third-party runtimes. Install Docker, Python, Node, or other prerequisites required by the specific MCP server you add.

### Tools missing in chat

Permissions are **project-scoped**. Confirm the MCP is allowed for the project in your environment (`JF_PROJECT` / platform project) and that tool policies are not blocking the tools you expect.

### Getting help

1. Reproduce with `JF_AGENT_GUARD_DEBUG=true` and capture stderr from the hook.
2. Note any HTTP status from the platform settings request.
3. Open a [GitHub issue](https://github.com/jfrog/cursor-plugin/issues) or email **devrel@jfrog.com** with those details.


---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development workflow and pull-request expectations.

## License

Licensed under the [Apache License 2.0](LICENSE).
