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
- **`jf` CLI** configured (`jf config add`) or `JFROG_PLATFORM_URL` + `JFROG_ACCESS_TOKEN`
- **Local plugin imports allowed** — enable **Allow Local Plugin Imports** in Cursor settings (see [Troubleshooting](#troubleshooting))

## Install

```bash
git clone -b feature/package-resolution --depth 1 https://github.com/jfrog/cursor-plugin.git ~/.jfrog/cursor-plugin-beta && \
  node ~/.jfrog/cursor-plugin-beta/scripts/install-beta.mjs --repo-path ~/.jfrog/cursor-plugin-beta
```

Branch: [`feature/package-resolution`](https://github.com/jfrog/cursor-plugin/tree/feature/package-resolution)

Then **Cmd+Q** quit Cursor fully, reopen, and start a **new Agent chat**.

Verify: **Settings → Plugins → Installed** shows **JFrog Platform** (or similar).

If you already use the marketplace **JFrog** plugin, you can keep both — the beta installs as **`jfrog-beta`** under local plugins.

## Configure

### 1. JFrog CLI and credentials

Ensure `jf` works and your platform URL / token are set (`jf config add` or `JFROG_PLATFORM_URL` + `JFROG_ACCESS_TOKEN`).

### 2. Enable Agent Package Resolution (opt-in)

Edit `~/.jfrog/agents-conf.json`. **`enabled: true` alone is not enough** — you also declare **which package managers to govern** under `defaultGlobalRepos`. Only those types are routed through Artifactory; everything else is left alone (no blocking, no public-registry rewrite).

Example — govern **npm and PyPI only**; Docker, Go, Maven, etc. stay untouched:

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

Optional: add `"enforceOnStartup": ["npm", "pypi"]` (or `true` for all governed types) to run `jf setup` automatically in the background on session start.

A project can add types via `.jfrog/local/package-resolution.json` (union with the global list). Full reference: [configure-agent-package-resolution](https://github.jfrog/jfrog-agent-hooks/blob/master/docs/configure-agent-package-resolution.md).

After changing this file, open a **new Agent chat** (or **Developer → Reload Window**) so the hook picks it up.

## Start using it

1. Confirm the plugin is installed (Settings → Plugins).
2. Set `packageResolution.enabled` and declare governed types in `defaultGlobalRepos` (step above).
3. Open a **new Agent chat** in a project that has a package manifest (e.g. `package.json`) or ask the agent to run package commands.

## Try it

### Example A — configure a package manager (works with or without `enabled: true`)

Ask the agent in natural language:

> Configure my npm to use JFrog Artifactory

This uses the **jfrog-setup-package-managers** skill (`jf setup npm`, workspace binding). It does **not** require `packageResolution.enabled`.

The skill honors the session policy's **governed scope** — it won't proactively onboard package managers you haven't declared unless you ask explicitly.

### Example B — routing for a **governed** type (requires `enabled: true` + `defaultGlobalRepos`)

With the sample config above (`npm` + `pypi` governed), start a **new Agent chat** and ask:

> Run `npm install express`

**Expected:** the agent routes npm through your Artifactory repo (`--registry <resolved npm URL>`), not the public registry. The injected policy should say something like **"This policy governs only: npm, pypi"**.

Same for PyPI if you ask for `pip install …`.

### Example C — **ungoverned** types are left alone

With the same config (**no `docker` in `defaultGlobalRepos`**), ask:

> Run `docker pull alpine:latest`

**Expected:** package resolution does **not** block or rewrite docker — docker is out of scope. The agent may pull from Docker Hub unless you separately configure docker via Example A or add `"docker": "<repo-key>"` to `defaultGlobalRepos`.

To govern docker too, add it to `defaultGlobalRepos` (and optionally `enforceOnStartup`), then start a new chat — bare and explicit-host pulls should route through your Artifactory docker row.

### Example D — disabled

With `packageResolution.enabled: false`, governed routing is off entirely; the agent may use public registries unless you ask it to use JFrog explicitly.

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

**Install succeeded but plugin not in Settings**

The files are in `~/.cursor/plugins/local/jfrog-beta/`, but Cursor may ignore them if local imports are blocked (`userLocal=false` in **Cursor Plugins.log**).

Enable local plugin imports: **Dashboard → Settings → Security & Identity → Marketplace and Plugins → Allow Local Plugin Imports → ON**, then **Cmd+Q** and reopen Cursor.
