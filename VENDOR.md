# Vendored skills

The skill packages under `plugins/jfrog/skills/` are vendored from **[jfrog/jfrog-skills](https://github.com/jfrog/jfrog-skills)** and committed to `main`.

| | |
| --- | --- |
| **Repository** | https://github.com/jfrog/jfrog-skills |
| **Pinned release** | see `pin` in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json) |

Included directories: `jfrog/`, `jfrog-package-safety-and-download/` (as of the pinned release).

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

# Vendored modules (package-resolution beta branch)

The `plugins/jfrog/modules/` bundle is vendored from **jfrog-agent-hooks** and committed to the `feature/package-resolution` branch.

| | |
| --- | --- |
| **Repository** | `github.jfrog.info/JFROG/jfrog-agent-hooks` |
| **Pinned release** | see `pin` in [`.github/scripts/sync-modules-vendor.json`](.github/scripts/sync-modules-vendor.json) |

The bundle contains harness runners (`core/`, `cursor-session-start.mjs`), the `package-resolution/` capability, and `assets/agents-default-conf.json`.

The companion skill `jfrog-setup-package-managers` is vendored from `jfrog-agent-hooks/skill/` (not from jfrog-skills).

## Refreshing modules + companion skill

```bash
JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-modules.mjs
JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-package-resolution-skill.mjs
```
