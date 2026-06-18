# JFrog Plugin for Cursor

JFrog plugin for [Cursor](https://cursor.com): artifact management, security scanning, supply-chain best practices, and Agent Guard.

## What's new in v0.5.0

- **Official skills.** The plugin now uses the official [jfrog-skills](https://github.com/jfrog/jfrog-skills) v0.11.0, replacing the previously bundled skill content. This brings structured reference files, automation scripts, and a three-tier tool selection strategy (MCP, CLI, REST/GraphQL).
- **Package safety skill.** New `jfrog-package-safety-and-download` skill for checking whether packages are safe, curated, or allowed before downloading them through Artifactory.
---

## Features

The JFrog plugin provides the following capabilities, grouped by component:

| Component | Feature | Description |
| --- | --- | --- |
| **Skill** | JFrog Platform | Interact with Artifactory repositories, builds, permissions, users, access tokens, projects, release bundles, and platform administration via the JFrog CLI and REST/GraphQL APIs. Also covers security audits, CVE lookups, and Advanced Security exposure queries. |
| **Skill** | Package safety & download | Check whether npm, Maven, PyPI, Go, and other packages are safe, curated, or allowed, then download them through Artifactory remote caches or curation-aware package managers. |
| **Hook** | Agent Guard | Cursor manage MCPs through the JFrog Agent Guard. Through the Agent Guard you can discover, install, configure, update, and remove MCP servers from the JFrog AI Catalog approved for your project, and authenticate to remote HTTP MCPs via OAuth, API key, or bearer token. |

---

## Prerequisites

Before installing, make sure you have:

- **JFrog host URL and access token** — Your JFrog platform URL and a valid access token.
- **Cursor** — Installed with AI features enabled.
- **Node.js** (≥ 14) — with `npx` on your `PATH`.
- **Skill runtime requirements** — `jf` CLI, `jq`, and `curl` on `PATH`, plus a configured JFrog instance. For the minimum versions, see the upstream skills [`Requirements`](https://github.com/jfrog/jfrog-skills/blob/v0.11.0/README.md#requirements). Configure the CLI with `jf config add` — see [Authentication](#authentication).
- **JFrog Platform access** (optional) — If you want to use the Agent Guard feature, your JFrog subscription needs to include the AI Catalog entitlement. Contact your JFrog account team if you're unsure whether it's enabled.
- **JFrog project** (optional) — If you want to use the Agent Guard feature.

---

## Installation

### Install the Cursor plugin

Use either the marketplace link from the [Configure Cursor](https://docs.jfrog.com/ai-ml/docs/configure-cursor) documentation or Cursor's UI:

1. Open **Cursor**.
2. Open **Cursor Settings** and select **Plugins**.
3. Search for **JFrog** and open the **JFrog** plugin.
4. Choose **Add to Cursor**, then **Add Plugin**.

---

## Authentication

### 1. Set persistent environment variables

| Variable | Description |
| --- | --- |
| `JFROG_PLATFORM_URL` | Your JFrog platform URL, e.g. `mycompany.jfrog.io` |
| `JFROG_ACCESS_TOKEN` | Your JFrog access token |

### 2. Configure the JFrog CLI

Run `jf login` for browser-based setup, or set the `JFROG_ACCESS_TOKEN` environment variable. MCP-based workflows authenticate via OAuth and require no additional configuration.

---

## Usage

Once configured, interact with the JFrog plugin through natural language. Examples are grouped by capability.

### JFrog Platform skill

| Ask the agent… | What happens |
| --- | --- |
| "List my Artifactory repositories." | Returns repositories via the JFrog CLI. |
| "Upload this build to Artifactory." | Publishes build artifacts and metadata. |
| "Run a security audit on this project." | Runs an Xray / Advanced Security audit and summarizes findings. |
| "Show me details on CVE-2021-23337." | Looks up CVE details in JFrog Advanced Security. |
| "Create a scoped access token for CI." | Creates an access token with the requested scope. |
| "Promote this release bundle to production." | Uses Lifecycle / Distribution APIs to promote the bundle. |

### Package safety & download skill

| Ask the agent… | What happens |
| --- | --- |
| "Is `lodash@4.17.21` safe to install?" | Checks JFrog Public Catalog signals and curation policy for the package. |
| "Is this Maven package approved for use?" | Checks curation entitlement and policy for the requested package. |
| "Download `requests` via JFrog." | Resolves the package through an Artifactory remote cache or curation-aware package manager. |

### MCP server management (Agent Guard)

| Ask the agent… | What happens |
| --- | --- |
| "Which MCP servers can I install?" | Returns all MCP servers approved for your current project that you can install. |
| "What MCP servers do I already have?" | Returns only the MCP servers already installed on your machine. |
| "Show me the details for the filesystem MCP server." | Returns detailed metadata, required configuration (environment variables, runtime arguments), and active tool policies for a given server. |
| "Add the GitHub MCP server." | Installs an approved MCP server and syncs its tool policies locally. Secrets are requested via a CLI command — never in chat. |
| "Update the environment variables for the Slack MCP." | Replaces the configuration for an already-installed server without removing and reinstalling it. |
| "Remove the Slack MCP server." | Removes the server and its stored credentials from your local setup. Changes apply immediately. |
| "Log in to the remote Jira MCP server using OAuth." | Authenticates with a remote HTTP-based MCP server (OAuth, API key, or bearer token). |
| "Switch my project to `backend-team`." | Re-syncs approved servers and policies for the new project. |

### How secrets are handled

When an MCP server requires a sensitive configuration, the agent cannot set the value directly. Instead, it returns a CLI command for you to copy and run in your terminal. Secrets such as API keys, tokens, and connection strings are never exposed in the agent chat history.

---

## Troubleshooting

See the [JFrog MCP Registry troubleshooting guide](https://docs.jfrog.com/ai-ml/docs/mcp-registry-troubleshooting).

---

## Updating the vendored skills

The `skills/` tree is vendored from [`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at the version pinned in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json). To pull a newer upstream release into this repo:

1. Bump `pin` in `.github/scripts/sync-skills-vendor.json` to the new tag (e.g. `v0.12.0`).
2. Run the sync script from the repo root:

   ```bash
   node .github/scripts/sync-skills.mjs
   ```

   It downloads the pinned tarball from `codeload.github.com`, extracts it, and replaces the directories listed in `paths` (today: `skills/`) under `plugins/jfrog/`.
3. Bump `version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) so users actually receive the update — Cursor skips installs whose resolved version hasn't changed.
4. Update the pinned-version link in the [Prerequisites](#prerequisites) section so the skill runtime requirements point at the new tag.
5. Commit the pin bump, the regenerated `plugins/jfrog/skills/` tree, the version bump, and the README link bump together, and open a PR.

See [`VENDOR.md`](VENDOR.md) for the full picture.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development workflow and pull-request expectations.

## License

Licensed under the [Apache License 2.0](LICENSE).
