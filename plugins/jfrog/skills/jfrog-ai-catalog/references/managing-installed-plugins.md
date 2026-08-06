# Managing installed plugins

## List currently installed plugins

A plugin can be installed in two separate places: the **project/harness** location
and the **global** location. For a full inventory, always run **both** lists and
present the union, not just the first:

```bash
# Project/harness install (the default target)
jf agent plugins list --server-id "<SID>" --harness "<harness>" --format json
# Global install (a separate location, always check it too)
jf agent plugins list --server-id "<SID>" --harness "<harness>" --global --format json
# Add --check-updates to compare installed versions against the registry
jf agent plugins list --server-id "<SID>" --harness "<harness>" --check-updates
```

Resolve `<harness>` to the current agent (see `installing-plugins.md`).
**Never run a bare `jf agent plugins list`** because it errors. Always pass
`--harness <h>` (installed plugins) or `--repo <key>` (registry contents).
`--check-updates` is only supported with `--harness` (not with `--repo`). Merge
the project and global results and drop duplicates before presenting. This lists
only plugins installed from the AI Catalog with `jf agent plugins install`, not
plugin-bundled or built-in agent plugins.

**Presenting installed plugins (use this exact format):**

Installed plugins (`<harness>`):

| Plugin | Version | Description |
|--------|---------|-------------|
| `<name>` | `<version>` | `<description>` |

Include the **Description** column only when the listing provides one (drop it if
every plugin's description is empty). With `--check-updates`, add an **Update to**
column (`<latest>`, or `-` when the plugin is already current). To upgrade a
plugin, see *Update an installed plugin* in `installing-plugins.md`.

## Remove a plugin

**Confirm before removing.** Show exactly what will be removed using **this exact
template** and wait for an explicit "yes":

> Removing plugin `<slug>` deletes its local install from `<harness>`. Do you want to remove it?

There is no `jf agent plugins uninstall`. Use a two-step approach: try the
harness-native CLI first, fall back to deleting the local files if unavailable.

### Step 1: try harness-native uninstall

Some harnesses register plugins in their own registry — deleting files alone leaves
a dangling entry. Before falling back to step 2, map the `--harness` value to the
actual CLI binary, then probe whether it exposes a native plugin CLI:

| `--harness` value | CLI binary |
|-------------------|------------|
| `claude-code` | `claude` |
| `cursor` | `cursor` |
| any other | same as harness value |

```bash
<binary> plugin --help 2>/dev/null || <binary> plugins --help 2>/dev/null
```

If a plugin management CLI is found, use it to look up and uninstall the slug. If
not (command not found or exits non-zero with no useful output), skip to step 2.

**claude-code** (`claude` binary) is the currently known example. It tracks plugins with ID
`<slug>@<repo>`:

```bash
# Look up the registered ID in claude's registry
ID=$(claude plugin list --json 2>/dev/null \
  | jq -r '.[] | select(.id | startswith("<slug>@")) | .id')

# Uninstall (-y required: no TTY in agent context)
claude plugin uninstall "$ID" --prune -y
```

### Step 2: fallback — delete local files

If native uninstall is unavailable or returned no match for the slug.

Plugins are installed under `<install-dir>/<repo-key>/<slug>/`. Delete the plugin
folder, then remove the parent repo directory if it is now empty:

```bash
if [ -d "<install-dir>/<repo-key>/<slug>" ]; then
  rm -rf "<install-dir>/<repo-key>/<slug>"
  rmdir "<install-dir>/<repo-key>" 2>/dev/null || true
else
  echo "Not installed, nothing to remove"
fi
```

On success, reply using **this exact template**:

> Removed `<slug>` from `<harness>`.
> Restart your agent session for the removal to take effect.
