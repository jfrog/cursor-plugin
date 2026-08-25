# Vendored skills

The skill packages under `plugins/jfrog/skills/` are vendored from **[jfrog/jfrog-skills](https://github.com/jfrog/jfrog-skills)** and committed to `main`.

| | |
| --- | --- |
| **Repository** | https://github.com/jfrog/jfrog-skills |
| **Pinned release** | see `pin` in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json) |

Included directories: `jfrog/`, `jfrog-ai-catalog-skills/`, `jfrog-package-safety-and-download/`, `jfrog-reference-architecture/`, `jfrog-setup-package-managers/` (as of the pinned release).

## Refreshing

When the upstream repo publishes a new release, refresh the vendored tree via a PR that:

1. Bumps `pin` in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json) to the new tag.
2. Re-syncs and commits the refreshed `plugins/jfrog/skills/` tree.
3. Bumps `version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) so users actually receive the update (Cursor skips installs whose resolved version hasn't changed).

To regenerate the tree locally before opening the PR:

```bash
node .github/scripts/sync-skills.mjs
```

The script reads its sibling `sync-skills-vendor.json`, downloads the pinned upstream tarball from `codeload.github.com`, and replaces the directories listed in `paths` (today: `skills/`) under `plugins/jfrog/`.

---

# Vendored modules

The `plugins/jfrog/modules/` bundle is vendored from **jfrog-agent-hooks** (GHE) and committed to `main`.

| | |
| --- | --- |
| **Repository** | `github.jfrog.info/JFROG/jfrog-agent-hooks` |
| **Pinned release** | see `pin` in [`.github/scripts/sync-modules-vendor.json`](.github/scripts/sync-modules-vendor.json) |

The bundle contains harness runners (`core/`, `cursor-session-start.mjs`), the `package-resolution/` capability, and `assets/agents-default-conf.json`. Automated sync PRs (`chore/sync-modules-v*`) update this tree on each `jfrog-agent-hooks` release.

Harness-specific scripts (for example `plugins/jfrog/scripts/cursor-align-mcp-json.mjs` and `cursor-mcp-json-discover.mjs`) live **outside** `modules/` so sync does not wipe them. They call shared orchestration in synced `modules/core/` (for example `rewrite-mcp-json.mjs`).

## Refreshing modules

```bash
JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-modules.mjs
```

The script reads `paths` from `sync-modules-vendor.json` (today: `paths: ["modules"]`) and optional `dest_prefix` / `keep`. It copies those paths into the destination (default: repo root) and restores any `keep` files that existed before the sync.
