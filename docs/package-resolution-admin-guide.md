# Agent Package Resolution: Admin Guide (Preview)

> **Preview Notice:** This feature is in preview and licensed under the Apache License 2.0. For clarity: This software is provided "as-is" without warranty of any kind, and without support obligations or service level commitments. Behavior, APIs, conventions, and structure may change without notice between releases. JFrog makes no guarantees of backward compatibility during the preview release cycle. Use in production environments is at your own risk.

**Audience:** Artifactory administrators / DevOps teams rolling this out to users.

Thank you for testing **Agent Package Resolution**, a feature in the JFrog plugin that routes AI coding-agent package installs (Cursor, Claude Code) through your organization's Artifactory instead of public registries, automatically and without relying on the person prompting the agent to know or follow your org's package-routing practices. That matters more now that coding agents let people beyond traditional developers write code and pull dependencies too. This guide covers everything an admin needs to turn it on and configure it for your organization during this preview.

---

## Prerequisites

The only hard prerequisites are the plugin and a JFrog Platform account for each user. Everything else below adapts automatically per user, rather than being something you need to arrange in advance:

- **The JFrog plugin installed** in your users' coding assistant (Cursor and/or Claude Code), whether users install it themselves or your org distributes it centrally.
- **A JFrog Platform account for each user.** Whether their local environment is already set up to use it is not something you need to arrange; the feature detects and handles that itself, see [Operating modes](#operating-modes) below.

---

## Setup summary

Only two things are actually required from you as the admin:


| Step | Action                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | Confirm the JFrog plugin is installed in your users' coding assistant                                                     |
| 2    | Enable Agent Package Resolution and set default repositories in `~/.jfrog/agents-conf.json`, for whichever users you want |


Everything else adapts on its own, per user, without you needing to arrange it (see [Prerequisites](#prerequisites) above). Once a user's `agents-conf.json` is enabled or changed, it takes effect automatically; there is no need to start a new agent session to pick up the change.

Agent Package Resolution is **opt-in**, and enablement is per user, not global by default. You decide which users to enable it for: deploy or edit `agents-conf.json` centrally (MDM, golden image) for all or a chosen subset of machines, or have specific users edit their own file locally. For a preview, enabling it for a handful of users directly is often simpler than a full rollout. See "Configuration file" below.

---

## Configuration file: `~/.jfrog/agents-conf.json`

All Agent Package Resolution admin settings live in a single JSON file on each user's machine:

```
~/.jfrog/agents-conf.json
```


| Property              | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| **Scope**             | Per user profile (`$HOME`)                                                       |
| **Written by**        | Administrators (MDM, golden image, manual edit) or auto-created on first session |
| **Read by**           | JFrog plugin session hooks on every agent session start                          |
| **Never overwritten** | If the file already exists, the plugin does not replace it                       |


### First session behavior

When a user opens their first agent session after installing the plugin:

1. If `~/.jfrog/agents-conf.json` **does not exist**, the plugin copies the shipped default template into that path.
2. The template ships with Agent Package Resolution **disabled** (`packageResolution.enabled: false`).
3. No routing policy is injected until an administrator or user sets `packageResolution.enabled` to `true`.

This lets you **pre-deploy** your own `agents-conf.json` (via MDM, Ansible, fleet policy, etc.) **before** users ever run the plugin. A pre-deployed file is never clobbered.

### Shipped default template

```json
{
  "logLevel": "info",
  "packageResolution": {
    "enabled": false,
    "verifyRepos": true,
    "cacheTtlDays": 7,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "pypi": "pypi-virtual",
      "maven": "maven-virtual",
      "go": "go-virtual",
      "docker": "docker-virtual",
      "helm": "helm-virtual",
      "nuget": "nuget-virtual"
    },
    "autoSetup": []
  }
}
```

Replace the repository keys with the **repo keys that actually exist on your JFrog Platform**. The names above are examples only. To govern only some package types, list only those types in `defaultGlobalRepos`, see [Selective governance](#selective-governance-choose-which-package-types-to-route) below.

---

## Selective governance: choose which package types to route

You do not have to turn on every package type at once. The package types Agent Package Resolution actually routes for a session, the **governed** types, are the union of:

- the keys you list in `defaultGlobalRepos` (your org default), and
- any keys declared in a project's workspace override file (see [Workspace-level repository overrides](#workspace-level-repository-overrides) below).

Any package type you don't declare anywhere is **out of scope**: the agent installs it normally, with no routing, no friction, and no "unresolved" state to explain to your developers. This makes it easy to start narrow, for example just `npm` and `pypi`, and expand later, rather than committing to all 7 types on day one. See the "npm and PyPI only" example under [Configuration examples](#configuration-examples) below.

---

## Rolling this out to multiple users at once

If you're enabling this for more than a handful of users, use your standard endpoint management to push a consistent `agents-conf.json`, rather than editing each one by hand. This applies equally to a small preview group or a full org-wide rollout, it's the same file either way, just targeted at whichever machines you choose.

**Typical rollout pattern:**

1. Build a golden `agents-conf.json` for the users you're targeting (see the examples below).
2. Deploy it to `~/.jfrog/agents-conf.json` on their machines with your MDM or configuration management tool. That's it, the change takes effect automatically, no per-user auth check and no session restart needed (see [Prerequisites](#prerequisites)).

**Tips for administrators**


| Goal                                                   | Approach                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Enable Agent Package Resolution for the targeted users | Set `"packageResolution": { "enabled": true, ... }` in the deployed file               |
| Map to your Artifactory repos                          | Edit `defaultGlobalRepos` with your real repo keys                                     |
| Force a refresh of the cached repo snapshot            | Set `"cacheTtlDays": 0` (re-resolves repos every session; does **not** force autoSetup re-runs), or edit `agents-conf.json` (cache invalidates on file change) |
| Support troubleshooting                                | Set `"logLevel": "debug"` temporarily; logs go to `~/.jfrog/logs/agent-hooks.log`      |


---

## Operating modes

Once enablement is resolved, Agent Package Resolution runs in one of three modes each session:


| Mode        | When                                                                                  | What the user sees                                         |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **off**     | `packageResolution.enabled` is not `true`, or the disable environment variable is set | Nothing; no Agent Package Resolution injection             |
| **pending** | Enabled, but `jf` is missing or not configured                                        | An advisory notice: routing is not ready, with setup steps |
| **routing** | Enabled and `jf` is configured and usable                                             | Full routing policy with resolved Artifactory URLs         |


`pending` is **advisory**: it steers the agent and user toward setup. It is not a hard block. Hard enforcement comes from Curation and bound package manager configuration.

---

## Zero-touch setup: `autoSetup`

By default, package-manager binding (`jf setup`) happens when the developer or agent runs it, typically via a one-time confirmation the first time a project uses a given package type. `autoSetup` lets you skip that confirmation: the plugin runs `jf setup` **automatically, in the background, at session start** for whichever governed package types you list. Binding usually finishes before the developer asks for anything, including indirect installs like a postinstall script, `pip install -r`, or `npx`. Because setup is asynchronous, a very early first install in the same session can still race it.

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "pypi": "pypi-virtual"
    },
    "autoSetup": ["pypi"]
  }
}
```

- `autoSetup` takes a list of package type names, or `true` to mean "all governed types."
- Only types that are both **governed** (declared in `defaultGlobalRepos` or a workspace override) and **resolved** are eligible; other names are ignored with a warning in the log.
- It only runs in `routing` mode (a working `jf` identity). Nothing is auto-configured in `pending` mode.
- It's off by default (`[]`) and safe to leave off: without it, setup still happens, just triggered by the developer's or agent's first use of that package type instead of automatically.
- It's idempotent. Each result is recorded in `~/.jfrog/skills-cache/package-setup.json`, keyed by server and package type, and trusted for `cacheTtlDays`. A repo that fails to configure (for example, a missing repo key or no permission) is deferred rather than retried every session. It retries when the TTL expires, or immediately if you change the repo key or JFrog server URL.

---

## Configuration reference

All keys are optional. Unknown keys are ignored.

### Top level


| Key        | Default | Description                                                                                               |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `logLevel` | `info`  | Hook log verbosity: `silent`, `debug`, `info`, `warn`, `error`. Log file: `~/.jfrog/logs/agent-hooks.log` |


### `packageResolution`


| Key                  | Default            | Description                                                                                                         |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `false`            | `true` turns Agent Package Resolution on for the user (subject to `jf` / auth and the disable environment variable) |
| `verifyRepos`        | `true`             | When `true`, each repo key in `defaultGlobalRepos` is verified against Artifactory before use                       |
| `cacheTtlDays`       | `7`                | Days to reuse the verified repo snapshot **and** autoSetup receipts per JFrog server. For repo resolve, `0` re-resolves every session; for autoSetup receipts, `0` means no timer expiry (retry only on repo key / server URL change) |
| `defaultGlobalRepos` | See template above | Map of package type to Artifactory **repository key**. Keys also define which types are **governed**, see below     |
| `autoSetup`          | `[]`               | Governed types to auto-configure with `jf setup` at session start, or `true` for all. See Zero-touch setup below    |


**Supported package types:** `npm`, `pypi`, `maven`, `go`, `docker`, `helm`, `nuget`.

---

Package types not listed in `defaultGlobalRepos` (and not declared in a workspace override) are **out of scope** for that session — the agent installs them normally, with no routing and no unresolved/setup flow, until you add the mapping.

### Repo resolution order (per package type)

1. **Workspace overlay:** `.jfrog/local/package-resolution.json` in the project (if present). Lets a team override the org default for a specific repo checkout.
2. **Cached snapshot:** `~/.jfrog/skills-cache/package-resolution.json` (per JFrog server, respects `cacheTtlDays`).
3. **Admin defaults:** `defaultGlobalRepos` in `agents-conf.json` (on cache miss or stale cache).

## Configuration examples

### Enable Agent Package Resolution with your repository keys

```json
{
  "logLevel": "info",
  "packageResolution": {
    "enabled": true,
    "verifyRepos": true,
    "cacheTtlDays": 7,
    "defaultGlobalRepos": {
      "npm": "corp-npm-virtual",
      "pypi": "corp-pypi-virtual",
      "maven": "corp-maven-virtual",
      "go": "corp-go-virtual",
      "docker": "art-docker",
      "helm": "corp-helm-local",
      "nuget": "corp-nuget-virtual"
    }
  }
}
```

Deploy this file to `~/.jfrog/agents-conf.json` on users' machines. The change takes effect automatically, no restart needed.

### npm and PyPI only (minimal preview rollout)

A good way to start a preview without committing to all 7 package types at once:

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "pypi": "pypi-virtual"
    }
  }
}
```

Other package types stay out of scope until you expand the map.

### Debug logging for support

```json
{
  "logLevel": "debug",
  "packageResolution": {
    "enabled": true
  }
}
```

Inspect `~/.jfrog/logs/agent-hooks.log` on the user's machine. Return to `"logLevel": "info"` after troubleshooting.

---

## Emergency disable

You can force Agent Package Resolution **off** for a process without editing `agents-conf.json`. Useful for CI images, break-glass support, or a temporary rollback during the preview.


| Variable                              | Value | Effect                                                                                                               |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `JF_AGENT_PACKAGE_RESOLUTION_DISABLE` | `1`   | Agent Package Resolution stays **off** for that IDE/terminal process, even if `agents-conf.json` has `enabled: true` |


**Precedence (enablement):**

1. `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` → **off**
2. `packageResolution.enabled: true` in `agents-conf.json` → **on** (if `jf` / auth allows)
3. Otherwise → **off** (shipped default)

To set it:

```bash
export JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1
```

Restart the coding assistant after changing environment variables.

> Removing the variable (or setting it to anything other than `1`) restores file-based enablement from `agents-conf.json`.

---

## Workspace-level repository overrides

Users (or project templates) can override your org-wide defaults for a specific repository checkout: useful for mono-repos or team-specific repo keys, without touching the org-wide `agents-conf.json`.

**File:** `<workspace>/.jfrog/local/package-resolution.json`

```json
{
  "repositories": {
    "npm": "team-npm-virtual",
    "pypi": "team-pypi-virtual"
  }
}
```

Workspace values win over `agents-conf.json` for matching package types during that session.

---

## Troubleshooting


| Symptom                                 | What to check                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No routing policy in the agent          | `packageResolution.enabled` is `true` in `~/.jfrog/agents-conf.json`                                                                                                                          |
| Policy still off despite enabled config | `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` is set in the IDE environment                                                                                                                         |
| Wrong repository URLs                   | Verify `defaultGlobalRepos` keys exist on your Platform; check `verifyRepos` and `~/.jfrog/skills-cache/package-resolution.json`                                                             |
| Invalid config ignored                  | Malformed JSON logs a **WARN** in `~/.jfrog/logs/agent-hooks.log` and falls back to safe defaults (`enabled: false`)                                                                          |
| Reset to shipped defaults                | Delete `~/.jfrog/agents-conf.json`; it is recopied automatically. Optionally delete `package-resolution.json` and `package-setup.json` from the cache to clear snapshots and setup receipts   |
| `autoSetup` type not configured          | Confirm the type is governed and the session was in `routing` mode. Check `agent-hooks.log` and `package-setup.json` in the skills cache                                                       |


---

## What this preview covers

Agent Package Resolution runs at the start of every coding-agent session. When enabled, it injects routing policy and resolved Artifactory repository URLs into the session, so the agent prefers your repositories over public registries (npm, PyPI, Maven, Go, Docker, Helm, NuGet) for the rest of that session.

**About this preview (please read before rolling out):**

- **This is advisory steering, not a hard block.** The feature tells the agent which repository to use and nudges it to configure package managers accordingly. It does not intercept or rewrite the underlying install commands. If you need a hard guarantee that nothing reaches a public registry, that guarantee comes from the two mechanisms below, not from this session-injection layer alone.
- **Durable enforcement is `jf setup` (package manager configuration) plus server-side Curation.** Once a package manager is bound to your Artifactory repository (via `jf setup`, which the agent will run for you when needed), that binding persists across sessions and tools, independent of this feature. Curation policies on the server are what actually block disallowed packages.
- **All 7 package types are configurable** (npm, PyPI, Maven, Go, Docker, Helm, NuGet), but you do not have to turn them all on at once. A narrower starting scope (for example, just npm and PyPI) is a reasonable way to begin a preview rollout; see the configuration examples above. Package types you don't declare are left completely alone, see [Selective governance](#selective-governance-choose-which-package-types-to-route).
- **Package-manager binding can happen automatically** if you turn on `autoSetup` for a package type, instead of waiting for a developer's or agent's first use to trigger it. See [Zero-touch setup](#zero-touch-setup-autosetup).
- This is a **preview**. Expect rough edges, and please route feedback through the channel below.

---

## Feedback and support

This is a preview. Please report issues, confusion, or surprises.

File an issue on GitHub, in whichever plugin repo you use:

- Cursor: [github.com/jfrog/cursor-plugin/issues](https://github.com/jfrog/cursor-plugin/issues)
- Claude Code: [github.com/jfrog/claude-plugin/issues](https://github.com/jfrog/claude-plugin/issues)
- Email: plugins-feedback@jfrog.com

We're especially interested in: whether the enablement steps above were clear, whether routing behaved as expected once enabled, and anything that felt broken or surprising during rollout.