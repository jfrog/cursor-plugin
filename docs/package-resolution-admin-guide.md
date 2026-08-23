# Agent Package Resolution: Admin Guide (Preview)

Route AI-assisted package installs through your JFrog Artifactory repositories when developers use the **JFrog plugin** for Cursor, Claude Code, or VS Code.

Agent Package Resolution runs at the start of each agent session. When enabled, it injects routing policy and resolved Artifactory URLs into the session so the agent prefers your repositories over public registries. Durable enforcement still comes from **package manager configuration** (`jf setup`) and **JFrog Curation** on the server.

This guide is for **platform administrators** and **developers** onboarding the JFrog coding-agent plugins. For installing the plugin itself, see the JFrog documentation for your IDE ([Cursor](https://docs.jfrog.com/ai-ml/docs/cursor), [Claude Code](https://docs.jfrog.com/ai-ml/docs/claude-code/), [VS Code](https://docs.jfrog.com/ai-ml/docs/vs-code)).

> **Related:** [Use the MCP Registry with Agent Guard](https://docs.jfrog.com/ai-ml/docs/configure-coding-agents) covers MCP governance. Agent Package Resolution is a separate capability in the same JFrog plugin family and uses the same local configuration file for admin settings.

---

## Setup summary

| Step | Action                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 1    | Install the JFrog plugin in your coding assistant                                                          |
| 2    | Install and configure the JFrog CLI (`jf config add`) — required for **routing** mode                      |
| 3    | Confirm `~/.jfrog/agents-conf.json` (shipped template enables APR with empty bindings; or deploy your own) |
| 4    | Start a **new agent session** — policy and URLs are injected once per session                              |

The shipped template turns Agent Package Resolution **on** (`enabled: true`) with empty `defaultGlobalRepos`. Nothing is routed until Consent Enable or an administrator adds bindings. Set `enabled: false` or `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` to keep it off.


**At a glance:**

- **Default:** on, but routes nothing until you add repositories.
- **To route installs:** add repository keys under `defaultGlobalRepos` (org config or Consent Enable).
- **To turn it off org-wide:** deploy your own `agents-conf.json` with `"enabled": false` (see [Turning Agent Package Resolution off](#turning-agent-package-resolution-off-admins)). Setting `"enabled": false` on the plugin's **default file without also deploying your own** is not durable — the plugin re-enables it on the next session.


---

## Prerequisites

- **JFrog Platform access** with Artifactory repositories for the package types you use (npm, PyPI, Maven, Go, Docker, Helm, NuGet). The developer environment must be able to reach your JFrog Platform URL — Agent Package Resolution resolves routing from live platform identity and repository metadata.
- **JFrog plugin** installed for your coding assistant.
- **JFrog CLI (`jf`) configured** with `jf config add` (or equivalent). Platform identity for **routing** mode comes **only** from `jf config` (server URL + access token **or** username + password / API key stored by the CLI).

### Identity and environment variables

| Variable / source        | Used by Agent Package Resolution?   | Purpose                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jf config` (CLI server) | **Yes — required for routing mode** | URL + token used to resolve repos and run eager `jf setup`                                                                                                                                                             |
| `JFROG_PLATFORM_URL`     | **Hint only**                       | Optional. When set in the IDE launch environment, the “routing not ready” notice can show this hostname so the developer knows which platform to configure. It does **not** authenticate or activate routing by itself |
| `JFROG_URL`              | **No**                              | Not read by Agent Package Resolution (may be used by other JFrog products / Agent Guard docs — do not rely on it here)                                                                                                 |
| `JFROG_ACCESS_TOKEN`     | **No**                              | Not read by Agent Package Resolution. Setting a token in the environment does **not** put the hook into routing mode                                                                                                   |

If `jf` is missing or has no usable configured server, the feature stays in **pending** mode (advisory “routing not ready” notice) even when `packageResolution.enabled` is `true`.

---

## Configuration file: `~/.jfrog/agents-conf.json`

All Agent Package Resolution admin settings live in a single JSON file on the developer machine:

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

When a developer opens their first agent session after installing the plugin:

1. If `~/.jfrog/agents-conf.json` **does not exist**, the plugin copies the **shipped default template** into that path.
2. The template ships with Agent Package Resolution **enabled** (`packageResolution.enabled: true`), empty `defaultGlobalRepos`, and `onboardingPrompt: "auto"`. Never-configured legacy scaffolds (`enabled: false` that still match a shipped fingerprint) are migrated to `enabled: true` on SessionStart (hand-edited / MDM configs and `onboardingPrompt: "off"` are left alone).
3. When the offer gate is open (`onboardingPrompt: "auto"` or an untouched scaffold fingerprint) **and** at least one APR package type is missing from `defaultGlobalRepos` and not durably declined, SessionStart injects a short **onboarding nudge** directly into the agent's context (`additional_context` for Cursor, `additionalContext` for Claude Code and VS Code Copilot) — **all three harnesses get it**; nothing is written to disk for the nudge itself. SessionStart injects it on every eligible session; the injected text itself instructs the agent to hold off raising it until a real package-manager install is happening, not on every unrelated chat. It names only the still-offerable types, so it only ever shrinks as types get bound or declined; it is injected fresh on every eligible SessionStart.
4. The offer is **per package type**, not one-time-and-done. **No** for one type runs `dismiss --type <t>`, which durably declines just that type in `~/.jfrog/skills-cache/apr-onboarding-v1.json` — other unbound, undeclined types stay offerable. **Yes** runs Consent Enable / `enable` for binding, which stops offering just the types that got bound. A bare `dismiss` (no `--type`) is the global escape hatch: it sets `onboardingPrompt: "off"` and durably silences every type until that config value changes.
5. Routing policy is injected when `packageResolution.enabled` is `true` **and** `jf` identity is usable (`routing`); otherwise `pending` when enabled but `jf` is missing — including when `defaultGlobalRepos` is still empty.

This lets organizations **pre-deploy** their own `agents-conf.json` (via MDM, Ansible, fleet policy, etc.) **before** developers run the plugin. A pre-deployed file is never clobbered. The `onboardingPrompt` field is the **global** offer gate:

| `onboardingPrompt` | Behavior                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `"off"`            | Never offer, for any type — global silence (bare `dismiss`, or admin-set)                              |
| `"auto"`           | Explicit opt-in — keep offering whichever types remain unbound and undeclined                          |
| absent             | Offer only when the file still matches a shipped scaffold fingerprint; a hand-edited file stays silent |

Per-type durable declines live in `~/.jfrog/skills-cache/apr-onboarding-v1.json` (not in `agents-conf.json`).

### Consent Enable (developer chat flow)

When the nudge fires, the agent walks the developer through enabling APR **in chat** (no hand-editing JSON):

1. Confirm `jf` is installed and has a usable server.
2. Ask **which package types** to govern (free text; default is not “all”).
3. Configure **one type at a time**. For each type, ask for an Artifactory **project key** or **repository** key/name (either is enough). Resolve with the base **`jfrog` skill** only through a bounded path — never list the catalog, all virtuals, or wildcards (`*-virtual`, `*<type>*`):
   - Repository given → `configure.mjs verify-repo` on that key only (ignore a project if also given).
   - Project given, no repository → one filtered call: that project + `type=virtual` + this `packageType`. 0 → ask again; 1 → bind; 2–10 → show name+key and ask; more than 10 → discard the payload and ask for the exact repository name.
   - Neither given → point-lookup `<type>-virtual`, `<type>-default`, then `<type>-release`. 0 hits → ask again; 1 → bind; 2–3 → ask among those keys only.
   - Query/auth errors are not “none found” — fix and retry the same bounded call. If the type never binds, leave it off and say so (suggest contacting an Artifactory admin). Verify every key with `configure.mjs verify-repo`. There is no discovery skill and no `configure.mjs discover`.
4. Enable and turn on zero-touch `autoSetup` for the bound types (no second auto-setup ask). `enable` **replaces** `defaultGlobalRepos` (it does not merge) — re-include already-bound types. `auto-setup` **replaces** `autoSetup` the same way. `enable` re-verifies keys fail-closed; the types just bound stop being offered, other unbound/undeclined types keep being offered:
   ```bash
   node <plugin>/modules/package-resolution/scripts/configure.mjs enable --repos '{"pypi":"pypi-virtual","go":"go-virtual"}'
   node <plugin>/modules/package-resolution/scripts/configure.mjs auto-setup --types '["pypi","go"]'
   ```
5. Load the in-session routing table and wait for setup: `JFROG_EAGER_SETUP_SYNC=1 node …/print-policy.mjs`. That stdout is the Package Resolution table for this chat. Do not install while the note says `setting up in the background`. Types that show as already set up must use the normal package-manager command (**no** `--registry` / `--index-url` / `GOPROXY=…`). Report pending/failed/conflict types as not ready; do not claim overall success unless every bound type set up.
6. Suggest starting a **new chat/session** so SessionStart injects the full routing table into context.

Other `configure.mjs` commands: `status [--json]` (includes `offerable`/`declined` type lists), `onboarding-procedure` (prints the full Consent Enable steps — the injected nudge only carries the short ask and points here), `verify-repo --type <t> --repo <k>`, `dismiss --type <t>` (per-type decline in `apr-onboarding-v1.json`), and bare `dismiss` (global silence via `onboardingPrompt: "off"`).

### Shipped default template

The plugin bundles a read-only template equivalent to:

```json
{
  "logLevel": "info",
  "packageResolution": {
    "enabled": true,
    "verifyRepos": true,
    "cacheTtlDays": 7,
    "onboardingPrompt": "auto",
    "defaultGlobalRepos": {},
    "autoSetup": []
  }
}
```

The empty map means no package types are governed yet — installs are not
rewritten to Artifactory until you add bindings. With `enabled: true`, SessionStart
can still inject a pending-mode advisory until `jf` is usable, and the onboarding
nudge may still offer to bind whichever types remain unbound and undeclined on
install intent. Add only the package types
and repository keys that exist on your JFrog Platform (via Consent Enable with
the `jfrog` skill + `verify-repo`, or manually — see
[Selective governance](#selective-governance-choose-which-package-types-to-route)).
With default `verifyRepos: true`, Consent Enable / `configure.mjs enable` accepts
keys Artifactory confirms as virtual repositories of the requested package type.

---


### Turning Agent Package Resolution off (admins)

> **Why `enabled: false` alone may not stick.** Because the feature now ships **on**, the plugin re-enables its **own default file** if it finds it still turned off. "Default file" means the `agents-conf.json` the plugin auto-created and that no one has changed except (at most) the `enabled` flag. As soon as you deploy your **own** config, or add any other setting (like `onboardingPrompt`), the plugin treats it as yours and never re-enables it.

**Pick the option that matches how you manage machines:**

| Your situation | Do this | Result |
| -------------- | ------- | ------ |
| You push config with MDM / a golden image | Deploy your own `agents-conf.json` with `"enabled": false` | Durable off — your file is never overwritten or re-enabled |
| You only edited the plugin's auto-created file | Set **both** `"enabled": false` **and** `"onboardingPrompt": "off"` | Durable off — `onboardingPrompt` marks the file as yours, so it is not re-enabled |
| You need an immediate, per-machine kill switch (CI, break-glass) | Set env var `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` | Off for that process, even if the file says `enabled: true` |

**Recommended config for a durable off (works in every case):**

```json
{
  "packageResolution": {
    "enabled": false,
    "onboardingPrompt": "off"
  }
}
```

Setting **only** `"onboardingPrompt": "off"` stops the Consent Enable prompts but does **not** turn the feature off — leave `enabled: false` in place for that. See also [emergency disable](#environment-variable-emergency-disable) for the environment variable.

## Admin control: deploy `agents-conf.json` across your organization

Use standard endpoint management to place a consistent `agents-conf.json` on every developer machine.

**Typical rollout pattern:**

1. Build a golden `agents-conf.json` for your org (see [examples](#configuration-examples) below).
2. Deploy to `~/.jfrog/agents-conf.json` with your MDM or configuration management tool.
3. Ensure developers have a configured `jf` CLI (`jf config add`).
4. Ask developers to **start a new chat/session** after deployment (hooks run once per session).

**Tips for administrators**

| Goal                                             | Approach                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enable Agent Package Resolution org-wide         | Set `"packageResolution": { "enabled": true, ... }` in the deployed file                                                                                     |
| Map to your Artifactory repos                    | Edit `defaultGlobalRepos` with your real repo keys                                                                                                           |
| Govern only some package types                   | List only those types in `defaultGlobalRepos` — others stay out of scope ([Selective governance](#selective-governance-choose-which-package-types-to-route)) |
| Auto-configure package managers at first session | Add types to `autoSetup` ([Zero-touch setup](#zero-touch-setup-autosetup))                                                                                   |
| Force all cached state to refresh                | Set `"cacheTtlDays": 0` (this also re-runs eligible zero-touch `jf setup` each session), or edit `agents-conf.json`                                          |
| Support troubleshooting                          | Set `"logLevel": "debug"` temporarily; logs go to `~/.jfrog/logs/agent-hooks.log`                                                                            |
| Keep APR **off** (durable)                       | Deploy your own file with `"enabled": false`, **or** set `"enabled": false` **and** `"onboardingPrompt": "off"` on the plugin's default file — see [Turning off](#turning-agent-package-resolution-off-admins) |
| Silence Consent Enable offers only               | Set `"onboardingPrompt": "off"` (does not disable APR while `enabled` is `true`)                                                                             |

---

## Operating modes

After enablement is resolved, Agent Package Resolution runs in one of three modes each session:

| Mode        | When                                                                 | What the developer sees                                                                                                                     |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **off**     | `packageResolution.enabled` is not `true`, or disable env var is set | No routing/pending policy. If `enabled` is simply `false` and the offer gate is open, the eligible onboarding nudge can still be injected; the disable env var suppresses that too |
| **pending** | Enabled, but `jf` is missing or not configured                       | Advisory notice: routing is not ready, with setup steps and the governed package types                                                      |
| **routing** | Enabled and `jf` is installed with a usable configured server        | Full routing policy for the **governed** package types + resolved Artifactory URLs; optional zero-touch `jf setup` for types in `autoSetup` |

`pending` steers the agent and the developer toward setup (no governed installs
until `jf` is ready). Kernel-level blocks still come from Curation and durable
package-manager config; the injected **Decision order** is what the agent must
follow in every session.

In `routing` mode the injected policy covers **only the governed package types** (see [Selective governance](#selective-governance-choose-which-package-types-to-route)); package managers you do not govern are left untouched. If `autoSetup` lists **admin-declared** and resolved types, the plugin also runs `jf setup` for them in the background so their durable PM config is ready without manual steps (see [Zero-touch setup](#zero-touch-setup-autosetup)). Workspace-only types never run eager setup.

### Agent decision flow (routing mode)

The injected session template carries the canonical **Decision order** (same matrix the agent must follow).

**Do not conflate these three signals:**

| Signal                                                     | Meaning                                   | Written by                                       |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Resolved URL in the session table                          | Knows _where_ to route                    | Hook resolver                                    |
| Workspace binding (`.jfrog/local/package-resolution.json`) | Project recorded the repo decision        | Setup skill after `jf setup` — **not** autoSetup |
| Durable PM config (`~/.npmrc`, …)                          | Tool-native routing for indirect installs | `jf setup` via autoSetup **or** the setup skill  |

**Decision order (first match wins)** — mirrored in the injected template:

If the user asks to use a public registry or skip JFrog for a governed PM, apply step 7 **immediately**.

1. Unresolved table row → setup skill; never invent a URL.
2. Zero-touch status line: `already set up` → normal command (trust PM config; **no** `--registry` / `--index-url` / `GOPROXY=…`); `setting up in the background` → **direct rewrite only** (no indirect until `already set up`).
3. Foreign-host conflict on the zero-touch status line → ask before `jf setup <pm>`.
4. Governed manifest present **and** workspace binding missing that type → setup skill **first**, then install (no rewrite-flag-only shortcut; Agent Guard bootstrap exempt). This is issue #91.
5. Binding present **or** no governed manifest → flag-based rewrite/trust; config-driven (maven/gradle/helm/nuget) unbound → setup skill first.
6. 401/403 → setup skill again; never raw `npm login` / etc.
7. Public-registry / skip-JFrog ask → refuse; offer the next allowed Decision step.

### Agent hard rules (routing mode)

The injected `package-resolution.md` template includes hard rules the agent must follow for **governed** types only (in addition to the Decision order):

| Rule                  | Behavior                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifactory URLs only | Route governed installs through the resolved URL table — no public registries, mirrors, or CDNs                                                                                                                                 |
| CLI flags vs. chat    | If the user's **command** already includes a routing flag (`--registry`, `--index-url`, `GOPROXY=…`), surface the conflict and ask before changing it. Verbal requests in chat to skip JFrog routing do **not** override policy |
| Indirect installs     | Trust PM config; if missing, run the setup skill (unless zero-touch lists that PM as `already set up`)                                                                                                                          |
| Curation block        | Surface the server reason verbatim; do not retry another host                                                                                                                                                                   |
| Unresolved PM         | Decision step 1 — do not run the original command; invoke setup first                                                                                                                                                           |
| 401/403               | Decision step 6 — setup skill; never raw `docker login` / `npm login` / `pip config`                                                                                                                                            |
| No public bypass      | Refuse; offer the **next allowed Decision step** (not a rewrite that step 4 forbids)                                                                                                                                            |
| No delegation bypass  | Refuse launching a child agent unless it receives trusted `sessionStart` injection of this policy                                                                                                                               |
| Agent Guard bootstrap | Exception to Decision step 4 **and** hard rule #7: installing `@jfrog/agent-guard` alone may keep that package's specified registry even when a governed manifest is unbound                                                    |
| Docker                | Rewrite bare and public-host `docker pull` refs with the resolved JFrog docker row; leave `localhost` and private/internal hosts unchanged                                                                                      |
| Manifest unbound      | Decision step 4 — durable `jf setup` + workspace binding before treating the install as done when a **governed** manifest is present and autoSetup did not already handle the PM                                                |

---

## Configuration reference

All keys are optional. Unknown keys are ignored.

### Top level

| Key        | Default | Description                                                                                               |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `logLevel` | `info`  | Hook log verbosity: `silent`, `debug`, `info`, `warn`, `error`. Log file: `~/.jfrog/logs/agent-hooks.log` |

### `packageResolution`

| Key                  | Default      | Description                                                                                                                                                                                                                                                                       |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `true`       | Shipped scaffold default. `true` turns Agent Package Resolution on for the user (subject to a usable `jf` config and the disable env var). Empty `defaultGlobalRepos` means no **admin** governed types yet; a resolved workspace overlay can still govern types in that project. |
| `verifyRepos`        | `true`       | When `true`, each repo key in `defaultGlobalRepos` **and** in the workspace overlay is verified against Artifactory before use                                                                                                                                                    |
| `cacheTtlDays`       | `7`          | Days to reuse a per-server result before re-checking. Governs **both** the verified repo snapshot and eager `jf setup` receipt. `0` always re-checks; use it only when deliberately avoiding all cached state.                                                                    |
| `defaultGlobalRepos` | See template | Map of package type → Artifactory **repository key**. These keys are the **admin** governed set (workspace overlay can add resolved types; see below). `configure.mjs enable --repos` **replaces** this map (it does not merge)                                                   |
| `autoSetup`          | `[]`         | **Admin-declared** types to auto-configure with `jf setup` at session start. Array of type names, or `true` for all admin types (not workspace-only). `configure.mjs auto-setup --types` **replaces** this list. See [Zero-touch setup](#zero-touch-setup-autosetup)              |

**Supported package types:** `npm`, `pypi`, `maven`, `gradle`, `go`, `docker`, `helm`, `nuget`.

**Governed vs. ungoverned.** A package type is **governed** when it is an
administrator key in `defaultGlobalRepos`, **or** a workspace
`.jfrog/local/package-resolution.json` key that **resolved** this session
(validated + verified when `verifyRepos` is on). A workspace file can override
the repository for an admin type or add a type. A workspace-only type that
fails verification is dropped (not shown, not blocked). Only governed types
appear in the injected policy:

- **Governed + resolved** — routed: a table row + rewrite rule. Eager `jf setup` (`autoSetup`) runs only when the type is **also** in `defaultGlobalRepos`.
- **Governed + unresolved** (admin-declared but the repo is missing or fails verification) — shown as `<no … repo resolved>` and blocked until setup, so a misconfiguration is never silently sent to a public registry.
- **Ungoverned** (not admin-declared and not a resolved workspace overlay) — **out of scope**: omitted from the policy entirely.

### Repo resolution order (per package type)

1. **Workspace overlay** — `.jfrog/local/package-resolution.json` in the project (if present)
2. **Cached snapshot** — `~/.jfrog/skills-cache/package-resolution.json` (per JFrog server, respects TTL)
3. **Admin defaults** — `defaultGlobalRepos` in `agents-conf.json` (on cache miss or stale cache)

---

## Selective governance: choose which package types to route

Agent Package Resolution governs **only the package types you declare**. This lets you onboard incrementally — start with, say, `pypi` and `npm`, and leave `docker`, `go`, and everything else untouched until you are ready.

- **To govern a type org-wide**, add it to `defaultGlobalRepos`.
- **To govern a type in one project**, add a supported key in `.jfrog/local/package-resolution.json` (Artifactory verification only when `verifyRepos` is on). That type is in policy for the session; it is **not** autoSetup-eligible.
- **To leave a type alone**, don't declare it in either place. Ungoverned types never appear in the injected policy and the agent installs them normally, with no JFrog routing and no "unresolved" blocking.

Example — govern only PyPI, leave Docker (and the rest) alone:

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "pypi": "corp-pypi-virtual"
    }
  }
}
```

A workspace can override an administrator-approved repository key for its own
checkout. The override is verified when `verifyRepos` is enabled:

```json
{
  "repositories": {
    "pypi": "team-pypi-virtual"
  }
}
```

With the two files above, that project still governs only `pypi`, but resolves it
through `team-pypi-virtual`; everything else stays out of scope. Adding another
validated key in the workspace file (for example `"npm": "team-npm-virtual"`)
would govern npm **in that project only**, without running eager `jf setup` for it.

---

## Zero-touch setup: `autoSetup`

Without `autoSetup`, the injected Decision order still applies: when a governed
project manifest is present and there is no workspace binding, the agent must
run `jfrog-setup-package-managers` (durable `jf setup`) **before** treating a
direct install as done — a rewrite-flag install alone is not enough. With
`autoSetup`, the plugin performs that `jf setup` **automatically at session
start** for the types you choose (and the session note marks them as already
set up / setting up), so a developer's first session already resolves indirect
installs (`npx`, `pip install -r`, postinstall scripts) through Artifactory
without forcing the skill again.

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "corp-npm-virtual",
      "pypi": "corp-pypi-virtual"
    },
    "autoSetup": ["pypi"]
  }
}
```

- `autoSetup` is a **list of type names**, or `true` to mean "all **admin-declared** types" (not workspace-only).
- It is **repo-agnostic**: setup targets whatever repo actually resolves for that type this session (a workspace override of an admin type wins over the org default).
- Only types that are **in `defaultGlobalRepos` and resolved** are eligible. Workspace-only types are skipped even when `autoSetup` is `true`. Names that aren't admin-declared are ignored (logged as a warning).
- For each eligible type, the plugin runs `jf setup` for **every client tool in that type's family** that the installed CLI supports and that is present on PATH (e.g. `pypi` → pip, pipenv, uv; `npm` → npm, pnpm). Missing binaries are skipped with a warning (no failed receipt) and listed in the zero-touch note. `pip` requires `pip3`/`pip` on PATH (`jf setup pip` runs `pip config set`). `maven` and `gradle` are separate governed types and are not PATH-gated — `jf setup` only writes `~/.m2/settings.xml` / a Gradle init script (wrapper-only projects still get config). On Windows, PATH lookup also honors `PATHEXT` (`.cmd`, `.exe`, …).
- `jf setup` mutates **user-global** PM config (`~/.npmrc`, `~/.docker/config.json`, …). It runs **off the critical path** in a background worker, so the session's instructions are still injected immediately — the 7-second session-start budget is never at risk.
- Runs are **idempotent**: a receipt at `~/.jfrog/skills-cache/package-setup-v2.json` (schema `2`, keyed by server + **package-manager token**, e.g. `pip` / `uv`) records each result — success **or** failure — and it is trusted for `cacheTtlDays`. A re-run is triggered by a changed repo key, a different server, or an expired TTL; a fresh result (within the TTL) is skipped. The v2 file is separate from legacy `package-setup.json` (schema 1) so older plugin builds cannot thrash the ledger; first run after upgrade starts empty and re-fills via idempotent `jf setup`.
- `jf setup` validates the repo itself; a bad repo or missing permission is recorded as a **failure** for that PM and, crucially, is **not** retried every session — it is deferred until the `cacheTtlDays` window elapses (self-heals if you create/fix the repo server-side) or retried immediately when you correct the repo key or switch servers. The failure is surfaced in the next session's note, and advisory routing always still applies.
- **Foreign-host conflict:** when an existing PM config already points at a **different** Artifactory (or public registry) host, zero-touch **skips** that package manager — it is left unchanged (no silent overwrite). The session note lists each skipped tool with `existingHost → targetHost` and instructs the agent to ask _"Switch to this JFrog instance?"_ before running explicit `jf setup <package-manager>` (with `--server-id` / `--repo` as needed) **only** for the tools the user approves — not bare `jf setup`. Explicit `jf setup` from the user or skill can still overwrite after confirmation.

**Prerequisite:** eager setup only runs in `routing` mode (a configured `jf` server). In `pending` mode nothing is auto-configured; once `jf` is configured, running the refresh command (`node <plugin>/modules/package-resolution/scripts/print-policy.mjs`) triggers eager setup exactly as a fresh session would — no restart needed.

During **Consent Enable**, the agent sets `autoSetup` for the types just configured via `configure.mjs auto-setup --types '[…]'` (no separate second ask), then runs `JFROG_EAGER_SETUP_SYNC=1 node …/print-policy.mjs` so setup finishes in that turn. Types that show as already set up must later install without rewrite flags. Admins can also pre-deploy `autoSetup` in `agents-conf.json` as shown above.

---

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
      "gradle": "corp-gradle-virtual",
      "go": "corp-go-virtual",
      "docker": "art-docker",
      "helm": "corp-helm-local",
      "nuget": "corp-nuget-virtual"
    }
  }
}
```

Deploy this file to `~/.jfrog/agents-conf.json` on developer machines, then have users start a **new agent session**.

### npm and Docker only (minimal rollout)

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "docker": "docker-virtual"
    }
  }
}
```

Only `npm` and `docker` are governed here. All other package types are **out of scope** — the agent installs them normally with no JFrog routing until you add them to the map. See [Selective governance](#selective-governance-choose-which-package-types-to-route).

### Debug logging for support

```json
{
  "logLevel": "debug",
  "packageResolution": {
    "enabled": true
  }
}
```

Inspect `~/.jfrog/logs/agent-hooks.log` on the developer machine. Return to `"logLevel": "info"` after troubleshooting.

---

## Environment variable: emergency disable

Organizations can force Agent Package Resolution **off** for a process without editing `agents-conf.json`. This is useful for CI images, break-glass support, or temporary rollback.

| Variable                              | Value | Effect                                                                                                               |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `JF_AGENT_PACKAGE_RESOLUTION_DISABLE` | `1`   | Agent Package Resolution stays **off** for that IDE/terminal process, even if `agents-conf.json` has `enabled: true` |

**Precedence (enablement):**

1. `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` → **off**
2. `packageResolution.enabled: true` in `agents-conf.json` → **on** (if `jf` / auth allows)
3. Otherwise → **off** (explicit `enabled: false`, or a hand-edited file that is not the shipped scaffold)

### macOS / Linux (Zsh or Bash)

Add to the IDE launch environment or shell profile:

```bash
export JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1
```

Restart the coding assistant after changing environment variables.

### Windows (PowerShell — user scope)

```powershell
[Environment]::SetEnvironmentVariable("JF_AGENT_PACKAGE_RESOLUTION_DISABLE", "1", "User")
```

Restart the IDE completely so it inherits the new value.

> **Note:** Removing the variable (or setting it to anything other than `1`) restores file-based enablement from `agents-conf.json`.

### Optional: platform URL hint (`JFROG_PLATFORM_URL`)

When `jf` is missing or unconfigured, the hook injects a “routing not ready” notice. If `JFROG_PLATFORM_URL` is set in the **IDE launch environment**, that value is included in the notice as a setup hint (which hostname to use with `jf config add`).

This variable is **not** a substitute for `jf config`. It does not supply credentials and does not move the session into **routing** mode. `JFROG_ACCESS_TOKEN` and `JFROG_URL` are likewise **not** used for Agent Package Resolution identity.

---

## Workspace-level repository overrides

Developers (or project templates) can override global defaults for a specific repository checkout:

**File:** `<workspace>/.jfrog/local/package-resolution.json`

```json
{
  "repositories": {
    "npm": "team-npm-virtual",
    "pypi": "team-pypi-virtual"
  }
}
```

Workspace values win over `agents-conf.json` for matching types during that session. Use this for mono-repo or team-specific repo keys without changing the org-wide `agents-conf.json`.

---

## Troubleshooting

| Symptom                                 | What to check                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No routing policy in the agent          | `packageResolution.enabled` is `true` in `~/.jfrog/agents-conf.json`, then run `node <plugin>/modules/package-resolution/scripts/print-policy.mjs` to load the policy                                                                                                                                                                                          |
| “Routing not ready” notice              | Install and configure `jf` (`jf config add`). Env vars alone (`JFROG_ACCESS_TOKEN`, `JFROG_URL`) will **not** clear this. Optional: set `JFROG_PLATFORM_URL` so the notice shows your platform hostname. After configuring `jf`, run the notice's refresh command (`node <plugin>/modules/package-resolution/scripts/print-policy.mjs`) or start a new session |
| Policy still off despite enabled config | `JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1` in the IDE environment                                                                                                                                                                                                                                                                                                 |
| Wrong repository URLs                   | Verify `defaultGlobalRepos` keys exist on your Platform; check `verifyRepos` and `~/.jfrog/skills-cache/package-resolution.json`                                                                                                                                                                                                                               |
| Invalid config ignored                  | Malformed JSON logs a **WARN** in `~/.jfrog/logs/agent-hooks.log` and falls back to the shipped template defaults (`enabled: true`, empty bindings)                                                                                                                                                                                                            |
| A governed type isn't in the policy     | Admin types come from `defaultGlobalRepos`. Workspace-only types appear only when the overlay key is supported (and verified when `verifyRepos` is on); a failed workspace-only key is dropped                                                                                                                                                                 |
| `autoSetup` type not auto-configured    | Must be **admin-declared** + resolved and in `routing` mode (workspace-only types never run eager `jf setup`); check `~/.jfrog/logs/agent-hooks.log` for the `jf setup` result and `~/.jfrog/skills-cache/package-setup-v2.json` for the recorded status. If another session holds the setup lock, the note says setup is deferred until the next session      |
| Re-run an eager `jf setup`              | Change the repo key (or server), delete the PM's entry (e.g. `pip`, `uv`) in `~/.jfrog/skills-cache/package-setup-v2.json` (or the whole file), or wait for `cacheTtlDays` to expire                                                                                                                                                                           |
| A bad repo keeps retrying every session | Fixed in current behavior — a failed `jf setup` is deferred for `cacheTtlDays` instead of retried each session. Correct the repo key to retry immediately, or fix the repo/permission in Artifactory (it self-heals after the TTL)                                                                                                                             |
| Reset to shipped defaults               | Delete `~/.jfrog/agents-conf.json` and start a new session (template is recopied). Optionally delete `~/.jfrog/skills-cache/package-resolution.json` and `~/.jfrog/skills-cache/package-setup-v2.json` to clear cached snapshots + setup receipts                                                                                                              |

---

## Related documentation

- [JFrog Plugins overview](https://docs.jfrog.com/ai-ml/docs/jfrog-plugins)
- [Install JFrog Plugin for Cursor](https://docs.jfrog.com/ai-ml/docs/install-jfrog-plugin-for-cursor)
- [Install JFrog Plugin for Claude Code](https://docs.jfrog.com/ai-ml/docs/install-jfrog-plugin-for-claude-code)
- [Install JFrog Plugin for VS Code](https://docs.jfrog.com/ai-ml/docs/install-jfrog-plugin-for-vs-code)
- [Use the MCP Registry with Agent Guard](https://docs.jfrog.com/ai-ml/docs/configure-coding-agents)
