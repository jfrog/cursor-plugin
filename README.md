# JFrog Plugin for Cursor

JFrog plugin for [Cursor](https://cursor.com): artifact management, security scanning, supply-chain best practices, and Agent Guard.

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
- **JFrog CLI** (≥ 2.x, optional) — Recommended for `jf config add` authentication (see [Authentication](#authentication)).
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
| `JFROG_URL` | Your JFrog platform URL, e.g. `https://mycompany.jfrog.io` |
| `JFROG_ACCESS_TOKEN` | Your JFrog access token |

### 2. Configure the JFrog CLI

If you have never configured the JFrog CLI on this machine:

1. Open your terminal.
2. Run:
   ```bash
   jf config add
   ```
3. Follow the interactive prompts to enter the same JFrog platform URL and access token.

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

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development workflow and pull-request expectations.

## License

Licensed under the [Apache License 2.0](LICENSE).
