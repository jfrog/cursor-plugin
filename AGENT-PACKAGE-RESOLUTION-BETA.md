# Agent Package Resolution beta (internal) — Cursor

Internal dogfooding branch **`feature/package-resolution`**. Not on the public marketplace yet.

> **Note:** The older branch `feature/package-guard` is deprecated for new installs; use `feature/package-resolution` instead. The old branch remains on the remote for now.

| Component | What it does |
|-----------|----------------|
| **package-resolution** hook | Session-start policy + resolved Artifactory URLs (**governed types only**) |
| **agent-guard** hook | MCP catalog governance |
| **jfrog** skill | Platform CLI / API workflows |
| **jfrog-package-safety-and-download** skill | Package safety checks |
| **jfrog-setup-package-managers** skill | `jf setup` PM binding |

## Prerequisites

- **Cursor** with AI features enabled
- **Node.js** ≥ 14 on `PATH` (hooks run via `node`)
- **`jf` CLI** configured (`jf config add`) for **active** routing — see [Identity / env vars](#identity--environment-variables)
- Cursor settings below (two different places — easy to confuse)

### Identity / environment variables

Agent Package Resolution identity comes **only** from `jf config` (server URL + token in the CLI).

| Source | Role |
|--------|------|
| `jf config add` | **Required** for active mode (resolved URLs, eager `jf setup`) |
| `JFROG_PLATFORM_URL` | **Optional hint** in the “routing NOT READY” notice when `jf` is missing — does **not** activate routing |
| `JFROG_ACCESS_TOKEN` | **Ignored** by Package Resolution |
| `JFROG_URL` | **Ignored** by Package Resolution |

### Two Cursor settings (do not mix these up)

Local beta install puts files under `~/.cursor/plugins/local/jfrog-beta/`. Getting the plugin **and** SessionStart hooks to work involves **two unrelated toggles**:

| Setting | Where it lives | Who can change it | What it does |
|---------|----------------|-------------------|--------------|
| **Allow Local Plugin Imports** | **Cloud Dashboard** (cursor.com) → team **Settings** → **Security & Identity** → **Marketplace and Plugins** | **Enterprise Admins only** (Members never see this in the IDE) | Org gate for loading plugins from `~/.cursor/plugins/local/`. Defaults **off** on Enterprise. Search team Settings for **“plugins”**. Not an IDE Settings page. |
| **Include third-party Plugins, Skills, and other configs** | **IDE** → **Cursor Settings** → **Rules, Skills, Subagents** (green switch under the filter chips) | Every user | Required for **session-start hooks** to inject Package Resolution policy. Skills/MCP can work without it; hooks will not. |

If the beta plugin is missing from **Settings → Plugins**, ask a Cursor Enterprise Admin to turn on **Allow Local Plugin Imports**, then **Cmd+Q** and reopen. If the plugin is installed but SessionStart has no JFrog text, turn on the IDE third-party toggle and start a **new Agent chat**.

Forum context: [local plugin loading](https://forum.cursor.com/t/regression-on-local-plugin-loading-discovery/161161), [plugin hooks](https://forum.cursor.com/t/plugin-hooks-not-loading-into-cursor-ide/156702).

## Install

```bash
git clone -b feature/package-resolution --depth 1 https://github.com/jfrog/cursor-plugin.git ~/.jfrog/cursor-plugin-beta && \
  node ~/.jfrog/cursor-plugin-beta/scripts/install-beta.mjs --repo-path ~/.jfrog/cursor-plugin-beta
```

Branch: [`feature/package-resolution`](https://github.com/jfrog/cursor-plugin/tree/feature/package-resolution)

Then **Cmd+Q** quit Cursor fully, reopen, and start a **new Agent chat**.

### Verify install (SessionStart)

Ask in a **new Agent chat**:

> what are the jfrog instruction you received in sessionstart (show as is)

With Package Resolution enabled and `jf` configured, you should see the injected **Package Resolution — Artifactory First** policy verbatim (resolved URL table). If `jf` is missing, you should see the **routing NOT READY** notice instead.

Also confirm **Settings → Plugins → Installed** shows **JFrog Platform** (local name: `jfrog-beta`).

If you already use the marketplace **JFrog** plugin, you can keep both — the beta installs as **`jfrog-beta`** under local plugins.

## Configure (onboarding phases)

Work through these in order. After any `agents-conf.json` change, open a **new Agent chat** (or **Developer → Reload Window**) so the hook reloads.

### Phase 1 — JFrog CLI and credentials

Ensure `jf` is installed and configured (`jf config add`). Active mode reads identity **only** from `jf config` — not from `JFROG_ACCESS_TOKEN` / `JFROG_URL`.

Eager setup and resolved URLs both need **active** mode: a usable `jf` server. If `jf` is missing/unconfigured, the hook injects a “routing NOT READY” notice instead and skips auto `jf setup`. If `JFROG_PLATFORM_URL` is set in the IDE launch env, that URL appears in the notice as a setup hint.

### Phase 2 — Enable + choose governed package types

Edit `~/.jfrog/agents-conf.json`. **`enabled: true` alone is not enough** — also declare **which package managers to govern** under `defaultGlobalRepos`. Only those types are routed through Artifactory; everything else stays out of scope.

Example — govern **npm and PyPI only**:

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

Replace repo keys with ones that exist on your Artifactory. Optional: a project can add/override types via `.jfrog/local/package-resolution.json` (union with the global list).

### Phase 3 — Zero-touch PM setup (`enforceOnStartup`)

Advisory routing (Phase 2) tells the agent which URLs to use. **Durable** PM config (`~/.npmrc`, `pip.conf`, …) still needs `jf setup`. Enable eager setup so the hook runs that automatically on session start for the types you list:

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "pypi": "pypi-virtual"
    },
    "enforceOnStartup": ["npm", "pypi"]
  }
}
```

Notes:

- Use a list of governed type names, or `"enforceOnStartup": true` for **all** governed types.
- Only **governed + resolved** types are eligible; others are ignored (logged).
- Runs in a **background** worker — session injection stays fast; check the injected note for “Zero-touch package-manager setup”.
- Idempotent via `~/.jfrog/skills-cache/package-setup.json` (skips fresh successes/failures until TTL / repo / server change).

**Verify Phase 3**

1. Start a **new Agent chat**.
2. Confirm the injected policy shows resolved URLs for your governed types and (when pending/done) a zero-touch status line.
3. Check durable config, e.g. `~/.npmrc` registry points at Artifactory after `npm` is in `enforceOnStartup`.
4. On failure or silence: `~/.jfrog/logs/agent-hooks.log` and `~/.jfrog/skills-cache/package-setup.json`.

### Phase 4 — Start using it

1. Confirm the plugin is installed (Settings → Plugins).
2. Phases 1–2 done (`enabled` + `defaultGlobalRepos`); Phase 3 optional but recommended for dogfooding eager setup.
3. Open a **new Agent chat** in a project with a package manifest (e.g. `package.json`) or ask the agent to run package commands.

Full reference: [configure-agent-package-resolution](https://github.jfrog.info/JFROG/jfrog-agent-hooks/blob/master/docs/product/configure-agent-package-resolution.md).

## Try it

### Example A — manual PM setup via skill (works with or without `enabled: true`)

Ask the agent:

> Configure my npm to use JFrog Artifactory

Uses **jfrog-setup-package-managers** (`jf setup` + workspace binding). Honors governed scope — won’t proactively onboard ungoverned PMs unless you ask.

### Example B — eager setup already configured the PM

With Phase 3 enabled for `npm`, start a **new Agent chat** (wait a few seconds if the note says “configuring in the background”), then ask:

> Run `npx cowsay hello`

**Expected:** indirect installs use durable Artifactory config from eager `jf setup` — you should **not** need to ask the agent to configure npm first.

### Example C — routing for a **governed** type (requires Phases 1–2)

With `npm` + `pypi` governed, start a **new Agent chat** and ask:

> Run `npm install express`

**Expected:** routes through Artifactory (`--registry <resolved npm URL>`). Policy says something like **"This policy governs only: npm, pypi"**.

Same for `pip install …` if `pypi` is governed.

### Example D — **ungoverned** types are left alone

With **no `docker`** in `defaultGlobalRepos`, ask:

> Run `docker pull alpine:latest`

**Expected:** no block/rewrite — docker is out of scope (may hit Docker Hub). To govern it, add `"docker": "<repo-key>"` (and optionally to `enforceOnStartup`), then start a new chat.

### Example E — disabled

With `packageResolution.enabled: false`, governed routing is off; public registries are allowed unless you ask for JFrog explicitly.

## Update the plugin

Pull the latest beta branch and re-run the installer:

```bash
cd ~/.jfrog/cursor-plugin-beta && \
  git pull origin feature/package-resolution && \
  node scripts/install-beta.mjs --repo-path ~/.jfrog/cursor-plugin-beta
```

Then **Cmd+Q** and reopen Cursor (or **Developer → Reload Window**) and open a **new Agent chat**.

To get a completely fresh clone instead:

```bash
rm -rf ~/.jfrog/cursor-plugin-beta && \
  git clone -b feature/package-resolution --depth 1 https://github.com/jfrog/cursor-plugin.git ~/.jfrog/cursor-plugin-beta && \
  node ~/.jfrog/cursor-plugin-beta/scripts/install-beta.mjs --repo-path ~/.jfrog/cursor-plugin-beta
```

## Uninstall

```bash
node ~/.jfrog/cursor-plugin-beta/scripts/install-beta.mjs --uninstall
```

Optional — remove the clone:

```bash
rm -rf ~/.jfrog/cursor-plugin-beta
```

Re-install the public marketplace plugin from **Settings → Plugins** if needed.

Does **not** remove `~/.jfrog/agents-conf.json` — edit or delete that file manually if you want to turn off package resolution.

## Troubleshooting

**Plugin files exist but nothing in Settings → Plugins**

Files land in `~/.cursor/plugins/local/jfrog-beta/`. On Cursor **Enterprise**, loading them can be blocked until an **Admin** enables **Allow Local Plugin Imports** in the **cloud Dashboard** (not IDE Settings) — see [Two Cursor settings](#two-cursor-settings-do-not-mix-these-up). Symptom in logs: `userLocal=false` in **Cursor Plugins.log**. After the Admin flips it, **Cmd+Q** and reopen.

**Plugin listed but no JFrog SessionStart instructions**

Enable **Include third-party Plugins, Skills, and other configs** under **IDE → Rules, Skills, Subagents**, then open a **new Agent chat** and re-run the [SessionStart verify](#verify-install-sessionstart) prompt.

**Still on “routing NOT READY” after setting env tokens**

Package Resolution does **not** use `JFROG_ACCESS_TOKEN` or `JFROG_URL`. Run `jf config add` (and ensure `jf` is on `PATH`). `JFROG_PLATFORM_URL` only affects the hint text in the notice.
