# JFrog Plugin for Cursor

JFrog plugin for [Cursor](https://cursor.com): artifact management, security scanning, supply-chain best practices, and Agent Guard.

## What's new

- **Skills governance.** A hook checks the skills you invoke against your JFrog governance policy and blocks the ones it disallows. See [Skills governance](#skills-governance).
- **Agent Package Resolution (Preview).** A hook automatically routes the packages your AI agent installs through your JFrog Artifactory instead of public registries. See [Agent Package Resolution](#agent-package-resolution-preview).
- **AI Catalog skill.** New `jfrog-ai-catalog-skills` skill to discover, install, update, and publish agent skills hosted in the JFrog AI Catalog.
---

## Features

The JFrog plugin provides the following capabilities, grouped by component:

| Component | Feature | Description |
| --- | --- | --- |
| **MCP** | JFrog MCP server | Remote JFrog MCP server auto-attached to every session via `mcp.json` at `https://${JFROG_PLATFORM_URL}/mcp` (OAuth, no API keys). |
| **Skill** | JFrog Platform | Interact with Artifactory repositories, builds, permissions, users, access tokens, projects, release bundles, and platform administration via the JFrog CLI and REST/GraphQL APIs. Also covers security audits, CVE lookups, and Advanced Security exposure queries. |
| **Skill** | Package curation | Check whether npm, Maven, PyPI, Go, and other packages are safe, curated, or allowed, then download them through Artifactory remote caches or curation-aware package managers. |
| **Hook + Skill** | Agent Package Resolution (Preview) | Automatically route packages installed by the AI agent through your organization's JFrog Artifactory, keeping agent-driven installs inside your Curation, Xray, and governance perimeter. |
| **Hook** | Agent Guard | Cursor manage MCPs through the JFrog Agent Guard. Through the Agent Guard you can discover, install, configure, update, and remove MCP servers from the JFrog AI Catalog approved for your project, and authenticate to remote HTTP MCPs via OAuth, API key, or bearer token. |
| **Hook** | Skills governance | When a skill is invoked, the plugin checks it against your JFrog governance policy and blocks disallowed or unscanned skills before they run. Covers the two entry points that carry a skill's identity: skills you run with `/<skill-name>`, and any read of a `SKILL.md` (how a skill's body reaches the model, since Cursor has no dedicated `Skill` tool). Content that reaches the model without a `Read` tool call is outside both — see [Skills governance](#skills-governance). Enforced only when your account is entitled to AI Catalog skills governance. |

---

## Prerequisites

Before installing, make sure you have:

- **JFrog host URL and access token** — Your JFrog platform URL and a valid access token.
- **Cursor** — Installed with AI features enabled.
- **Node.js** (≥ 18) — with `npx` on your `PATH`.
- **Skill runtime requirements** — `jf` CLI, `jq`, and `curl` on `PATH`, plus a configured JFrog instance. For the minimum versions, see the upstream skills [`Requirements`](https://github.com/jfrog/jfrog-skills/blob/main/README.md#requirements). Configure the CLI with `jf config add` — see [Authentication](#authentication).
- **JFrog Platform access** (optional) — If you want to use the Agent Guard feature, your JFrog subscription needs to include the AI Catalog entitlement. Contact your JFrog account team if you're unsure whether it's enabled.
- **JFrog CLI ≥ 2.105.0** (optional) — If you want the Agent Guard to auto-resolve the credentials/server ID from the JFrog CLI configuration. Older CLIs don't support the `--format` flag used by `jf config show`/`jf config export` for this.
- **JFrog project** (optional) — If you want to use the Agent Guard feature.

---

## Installation

### Install the Cursor plugin

Use either the marketplace link from the [Configure Cursor](https://docs.jfrog.com/ai-ml/docs/configure-cursor) documentation or Cursor's UI:

1. Open **Cursor**.
2. Open **Cursor Settings** and select **Plugins**.
3. Search for **JFrog** and open the **JFrog** plugin.
4. Choose **Add to Cursor**, then **Add Plugin**.

Run **`/jfrog-init`** after install, **restart Cursor** if MCP config changed, then complete [Verify](#verify).

---

## Verify

Verification is a required install step, not a troubleshooting fallback:

1. **Cursor Settings → Plugins** — the JFrog plugin is installed.
2. **`/jfrog-init`** — the readiness walk completes without blocking errors.
3. `jf rt ping` — succeeds against your configured server.

If a check fails, see [Recovery](#recovery). `JFROG_PLATFORM_URL` is for MCP
placeholder resolution only. Setting it does not repair a failed `/jfrog-init`.

## Recovery

| Symptom | Do this | Do **not** do this |
| --- | --- | --- |
| MCP missing after install | Run `/jfrog-init`, complete OAuth if prompted, **restart Cursor**, re-check MCP tools. | Assume `JFROG_PLATFORM_URL` alone will register MCP. |
| `/jfrog-init` stopped at CLI/auth | Follow the skill prompt (`jf config add`, web login, or token path), then **re-run `/jfrog-init`**. | Skip init and only export env vars. |
| Placeholder URL still in plugin MCP config | Fix `jf config` for the intended server, re-run `/jfrog-init`. | Reinstall the plugin when the detector says auth/URL resolution failed. |

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

## Agent Package Resolution (Preview)

> **Preview Notice:** This feature is in preview and licensed under the Apache License 2.0. For clarity: This software is provided "as-is" without warranty of any kind, and without support obligations or service level commitments. Behavior, APIs, conventions, and structure may change without notice between releases. JFrog makes no guarantees of backward compatibility during the preview release cycle. Use in production environments is at your own risk.

The plugin can now automatically route the packages your AI agent installs (npm, PyPI, Maven, Go, Docker, Helm, and NuGet) through your organization's JFrog Artifactory instead of public registries. This keeps agent-driven dependency installs inside your organization's governance perimeter.

Agent Package Resolution is in preview. The shipped template enables it with empty repository bindings (nothing is routed until Consent Enable or an admin adds `defaultGlobalRepos`). To get started:

- **Users:** see the [User Guide](docs/package-resolution-user-guide.md).
- **Admins:** see the [Admin Guide](docs/package-resolution-admin-guide.md).

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

### Package curation skill

| Ask the agent… | What happens |
| --- | --- |
| "Is `lodash@4.17.21` safe to install?" | Checks JFrog Public Catalog signals and curation policy for the package. |
| "Is this Maven package approved for use?" | Checks curation entitlement and policy for the requested package. |
| "Download `requests` via JFrog." | Resolves the package through an Artifactory remote cache or curation-aware package manager. |

### Agent Package Resolution

When Agent Package Resolution is enabled and configured, no special prompt syntax is required. Ask the agent to install or use a package as you normally would, and the plugin routes supported package operations through your organization's Artifactory.

| Ask the agent…                         | What happens                                                             |
| -------------------------------------- | ------------------------------------------------------------------------ |
| "Add `lodash` to this project."        | Resolves the npm package through the configured Artifactory repository.  |
| "Add Excel file import to this app."   | The agent selects a suitable package and resolves it through the configured Artifactory repository. |
| "Pull the `alpine` Docker image."      | Pulls the image through the configured Artifactory Docker repository.    |

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

### Skills governance

When a skill is about to run, a hook checks it against your JFrog governance policy and blocks it if policy disallows it. Cursor has no dedicated `Skill` tool, so it covers the two entry points that actually carry a skill's identity:

- you running a skill with `/<skill-name>`,
- and the agent reading a skill's `SKILL.md` — how a skill's body reaches the model, and so also the path a model-decided invocation funnels through, since the agent must read the file before it can act on it. This is caught at `preToolUse` (matcher `Read`), before Cursor reads the file's bytes off disk rather than after.

These are the two entry points that carry a skill's identity; they are not a claim to cover every way content can reach the model. A skill whose name the hook cannot resolve to a folder on disk is **allowed**, not blocked — resolution completeness is therefore a security property, and the searched locations are listed in the Agent Guard's architecture notes. Anything that puts a file's contents in front of the model without going through a `Read` tool call is outside both surfaces.

For each, the hook computes the skill's content **fingerprint** and asks the JFrog governance service for a verdict:

| Verdict | What happens |
| --- | --- |
| **Allowed** | The skill runs. |
| **Blocked** | The skill is prevented from running, and each violated policy is named along with the reason it failed. |
| **Not yet scanned** | The skill is submitted for an on-the-fly scan and blocked with a "scan started — retry shortly" message. |
| **Not entitled** | If your account isn't entitled to AI Catalog skills governance, enforcement is skipped and skills run normally. |

#### Requesting a waiver

When a policy block carries a waiver scope, the block message shows the command that requests one, against the blocking policy's application, stage, and gate, with your justification attached. The Agent Guard files it — `agent-guard --request-waiver` — so the plugin holds no credentials and no waiver logic of its own.

On a blocked `Read` the agent is given the command and can run it once you say why you need access. On a blocked `/<skill-name>` there is no model turn, so the command is printed for you to copy and run yourself. Either way the request goes to your project admin for review — it does not unblock the skill on its own, and nothing is submitted unless you ask for it and give a reason.

**Requirements & behavior**

> [!IMPORTANT]
> **A verdict reaches Cursor as JSON on the hook's stdout.** Three outcomes, and they are distinct:
>
> - **Your JFrog policies deny the skill** — **blocked**, naming the policies it violated and the
>   command to request a waiver.
> - **The Agent Guard reaches the check but cannot finish it in time** — **blocked**. It writes a
>   refusal explaining that it could not answer, and exits 2. It got as far as the check, so it does
>   not guess.
> - **The Agent Guard cannot be *run at all*** — `npx` missing, the registry unreachable, no JFrog
>   server configured, or it fails internally — **allowed**. A machine that cannot get a verdict is
>   not governed by it, and blocking there would stop work without enforcing anything.
>
> One case is Cursor-specific: the hooks carry `failClosed: false`, so if **Cursor** kills the hook
> at its own `timeout` the action is allowed. That is a different clock from the Agent Guard's own
> budget, which is deliberately the shorter of the two so it answers first.
>
> A user who is entitled to nothing is unaffected either way: the Agent Guard answers "allow" for an
> unconfigured or unentitled user, so no setup is needed to opt out of the feature.

- Set `JFROG_URL` and `JF_ACCESS_TOKEN` (or configure the JFrog CLI — see [Authentication](#authentication)) and `JF_PROJECT` (the JFrog project the skill runs in). For an entitled account with credentials but no project, skills are **blocked** with a message telling you what to set; with no credentials at all they are **allowed**, per the table above.
- **Node.js (≥ 18) with `npx` on your `PATH`** — the hook resolves the Agent Guard through `npx`. Without it, governed actions are allowed unchecked.
- **POSIX shell required.** Cursor's hook schema has no `shell` field, so the command runs in the platform's default shell. It uses POSIX syntax (`${VAR:-default}`, `$(( ))`), so on Windows `cmd`/PowerShell it cannot run — and governed actions are allowed unchecked. macOS and Linux are unaffected.
- **Cost per call.** The hook spawns a shell, `npx` and the Agent Guard on *every* prompt submission (`beforeSubmitPrompt` is unmatched, so it sees all of them) and on *every* `Read`. There is no throttle and no cache of a recent verdict, so a read-heavy session pays it repeatedly. Measured warm on macOS: **~1.1s** per prompt, where the Agent Guard is revalidated against the registry so a released fix reaches you, and **~0.3s** per `Read`, which reads the copy that revalidation left in the cache.
- The Agent Guard logs its decisions to stderr; run Cursor with hook output visible to see them.
- To turn enforcement off, remove the `beforeSubmitPrompt`/`preToolUse` entries from `plugins/jfrog/hooks/hooks.json`.

---

## Troubleshooting

See the [JFrog MCP Registry troubleshooting guide](https://docs.jfrog.com/ai-ml/docs/mcp-registry-troubleshooting).

---

## Updating the vendored skills

The `skills/` tree is vendored from [`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at the version pinned in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json). To pull a newer upstream release into this repo:

1. Bump `pin` in `.github/scripts/sync-skills-vendor.json` to the new upstream tag.
2. Run the sync script from the repo root:

   ```bash
   node .github/scripts/sync-skills.mjs
   ```

   It downloads the pinned tarball from `codeload.github.com`, extracts it, and replaces the directories listed in `paths` (today: `skills/`) under `plugins/jfrog/`.
3. Bump `version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) so users actually receive the update — Cursor skips installs whose resolved version hasn't changed.
4. Commit the pin bump, the regenerated `plugins/jfrog/skills/` tree, and the version bump together, and open a PR.

See [`VENDOR.md`](VENDOR.md) for the full picture.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development workflow and pull-request expectations.

## License

Licensed under the [Apache License 2.0](LICENSE).
