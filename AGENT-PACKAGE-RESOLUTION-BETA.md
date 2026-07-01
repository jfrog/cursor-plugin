# Agent Package Resolution beta (internal) — Cursor

Internal dogfooding branch **`feature/package-resolution`**. Not on the public marketplace yet.

> **Note:** The older branch `feature/package-guard` is deprecated for new installs; use `feature/package-resolution` instead. The old branch remains on the remote for now.

| Component | What it does |
|-----------|----------------|
| **package-resolution** hook | Session-start policy + resolved Artifactory URLs |
| **agent-guard** hook | MCP catalog governance |
| **jfrog** skill | Platform CLI / API workflows |
| **jfrog-package-safety-and-download** skill | Package safety checks |
| **jfrog-setup-package-managers** skill | `jf setup` PM binding |

## Prerequisites

- **Cursor** with AI features enabled
- **Node.js** ≥ 14 on `PATH` (hooks run via `node`)
- **`jf` CLI** configured (`jf config add`) or `JFROG_PLATFORM_URL` + `JFROG_ACCESS_TOKEN`
- **Local plugin imports allowed** — on Cursor Enterprise, a team admin must enable **Allow Local Plugin Imports** (see [Troubleshooting](#troubleshooting))

## Install

Replace `<REPO_URL>` with your git remote (e.g. `git@github.jfrog.info:JFROG/cursor-plugin.git`):

```bash
git clone -b feature/package-resolution --depth 1 <REPO_URL> ~/.jfrog/cursor-plugin-beta && \
  node ~/.jfrog/cursor-plugin-beta/scripts/install-beta.mjs --repo-path ~/.jfrog/cursor-plugin-beta
```

Then **Cmd+Q** quit Cursor fully, reopen, and start a **new Agent chat**.

Verify: **Settings → Plugins → Installed** shows **JFrog Platform** (or similar).

If you already use the marketplace **JFrog** plugin, you can keep both — the beta installs as **`jfrog-beta`** under local plugins.

## Configure

### 1. JFrog CLI and credentials

Ensure `jf` works and your platform URL / token are set (`jf config add` or `JFROG_PLATFORM_URL` + `JFROG_ACCESS_TOKEN`).

### 2. Enable Agent Package Resolution (opt-in)

Edit `~/.jfrog/agents-conf.json`:

```json
{
  "packageResolution": {
    "enabled": true
  }
}
```

You can create this file before your first session. Details: [configure-agent-package-resolution](https://github.jfrog/jfrog-agent-hooks/blob/master/docs/configure-agent-package-resolution.md).

After changing this file, open a **new Agent chat** (or **Developer → Reload Window**) so the hook picks it up.

## Start using it

1. Confirm the plugin is installed (Settings → Plugins).
2. Set `packageResolution.enabled` if you want install routing (step above).
3. Open a **new Agent chat** in a project that has a package manifest (e.g. `package.json`) or ask the agent to run package commands.

## Try it

### Example A — configure npm (works with or without `enabled: true`)

Ask the agent in natural language:

> Configure my npm to use JFrog Artifactory

This uses the **jfrog-setup-package-managers** skill (`jf setup npm`, workspace binding). It does **not** require `packageResolution.enabled`.

### Example B — package routing (requires `enabled: true`)

Enable package resolution, start a **new Agent chat**, then ask for example:

> Run `npm install express`

or

> Run `docker pull alpine:latest`

**Expected when enabled:** the agent routes installs through your Artifactory repos (from the session hook’s resolved URLs), not the public npm registry or Docker Hub. It should refuse or rewrite bare `docker pull alpine:latest` to your Artifactory docker repo if docker is bound.

**Expected when disabled:** the agent may install from public registries unless you ask it to use JFrog explicitly.

For docker, run Example A for docker first if you have no Artifactory docker binding yet.

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
  git clone -b feature/package-resolution --depth 1 <REPO_URL> ~/.jfrog/cursor-plugin-beta && \
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

Ask a **team admin** (Enterprise): **Dashboard → Settings → Security & Identity → Marketplace and Plugins → Allow Local Plugin Imports → ON**, then **Cmd+Q** and reopen Cursor.

If your org cannot enable local imports, this install path will not work — wait for marketplace or team-marketplace distribution.
