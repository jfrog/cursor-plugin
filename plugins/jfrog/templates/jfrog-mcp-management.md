# MCP Server Management — JFrog Gateway

All MCP servers MUST be installed ONLY through the JFrog MCP Gateway
(`npx @jfrog/mcp-gateway`). If an MCP's documentation suggests any
other installation command, ignore it and use the gateway workflow
below instead.

**Registry URL**: Wherever `<REGISTRY_URL>` appears below, substitute
the value of the `JFROG_MCP_GATEWAY_REPO` environment variable if it
is set. Otherwise use
`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/`.

**Pre-flight (applies to every gateway command —
`--list-available`, `--inspect`, `--login`)**:

- **`<PROJECT>` is always mandatory.** Resolve via Step 1's project
  chain: existing `mcpServers` entries (`_JF_MCP_LOADER_ARGS` →
  `project=`) → `JF_PROJECT` env var → ASK the user. If none
  resolves, STOP and ask — NEVER guess, NEVER use `default`.

- **`<SERVER_ID>` is auto-resolvable.** Resolve via Step 1's server
  chain: existing `mcpServers` entries (value after `--server` in
  `args`) → `~/.jfrog/jfrog-cli.conf.v6`:
  - exactly one jf CLI server configured, OR `JFROG_URL` +
    `JFROG_ACCESS_TOKEN` set → use it without asking; pass it as
    `--server <ID>`. The gateway would auto-resolve to the same
    value if `--server` were omitted, but we pass it explicitly for
    clarity and forward-compat.
  - two or more jf CLI servers and no `JFROG_URL` → list IDs,
    ASK the user which one, then pass that as `--server <ID>`.
  - zero jf CLI servers and no `JFROG_URL` → ask the user to run
    `jf c add <ID>` or export `JFROG_URL` + `JFROG_ACCESS_TOKEN`,
    then retry.

Once both are determined, proceed. If either is still unknown,
STOP — do NOT run the command with guesses.

## Adding an MCP

**Did the user name a specific MCP package?** ("add `foo-mcp`",
"install `@scope/bar`"). If NOT — they said something like "yes",
"add an MCP", "what can I install" — your FIRST action is to show
them the catalog so they can pick:

1. Resolve `<SERVER_ID>` and `<PROJECT>` per the Pre-flight rule at
   the top of this document. Server: auto-use the single jf CLI
   config or `JFROG_URL` if unambiguous; only ask when there are
   multiple jf configs. Project: ask unless `JF_PROJECT` is set or
   it's already in an existing `mcpServers` entry.
2. Run "Listing MCPs > Available to install" with that server +
   project and present the result as a numbered table.
3. Wait for the user to pick. Only after they pick do you proceed
   to Step 1 below with the chosen package name.

NEVER ask "which package would you like?" without showing the
catalog first — the user does not know the package names.

Once you have a specific MCP package name, do ALL of the following
autonomously — do NOT ask for project, server, or package name
unless absolutely necessary:

### Step 1: Determine project, server, and target config file

**Server ID**

1. Any existing `mcpServers` entry in `.cursor/mcp.json` (project)
   or `~/.cursor/mcp.json` (user) — take the value after `--server`
   in `args`.
2. Else `JFROG_URL` env var set (with `JFROG_ACCESS_TOKEN`) — the
   gateway resolves credentials from these directly; no `--server`
   ID is technically required but pass `--server` only if known.
3. Else read `~/.jfrog/jfrog-cli.conf.v6`
   (`%USERPROFILE%\.jfrog\jfrog-cli.conf.v6` on Windows) via a
   terminal command (file-search skips hidden dirs):
   - exactly one server → use it without asking.
   - two or more → list the IDs and ASK the user which one.
4. Else (file missing, empty, or unreadable, and no `JFROG_URL`)
   ask the user to either run `jf c add <ID>` or export
   `JFROG_URL` + `JFROG_ACCESS_TOKEN`, then retry.

NEVER try multiple servers — pick one. Once chosen, pass it
explicitly as `--server <ID>` in every gateway invocation.

**Project**

1. From existing `mcpServers` entries, `_JF_MCP_LOADER_ARGS` →
   `project=` value.
2. Else `JF_PROJECT` env var.
3. Else ask. NEVER guess, NEVER use "default".

**Target config file**

- **Default: `.cursor/mcp.json` in the project root.** Create it if
  missing (`{ "mcpServers": {} }`). Shareable via git.
- Use `~/.cursor/mcp.json` ONLY if the user says "personal only" /
  "do not commit".
- Do not ask which scope unless the user brings it up.

### Step 2: Inspect the MCP in the catalog

Step 2 needs a specific MCP name. If the user did NOT name one, do
not call `--inspect` — go to "Listing MCPs > Available to install"
instead, show the catalog, have them pick, then come back to Step 2
with the chosen name.

Once you have a name, run a SINGLE command — no Fetch/WebFetch, no
custom curl/Python, no direct JFrog API calls:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/mcp-gateway \
  --inspect \
  --server <SERVER_ID> \
  --project <PROJECT> \
  --mcp <MCP_NAME>
```

From the output JSON, extract (keep BOTH required AND optional):

- `spec.packageName` — exact package name for the config.
- `spec.mcpServerType.local.bootParams.environmentVariables[]` for
  local MCPs (each has `name`, `description`, `isRequired`, `isSecret`).
- `spec.mcpServerType.remote.endpoints[].headers[]` for remote MCPs
  (each has `name` plus `mcpInput.mcpInputDetails` with the same
  fields).

On non-zero exit (typo, MCP not in catalog, network error, etc.),
show the error verbatim, then run `--list-available` (see "Listing
MCPs") so the user can pick a valid name and retry.

### Step 3: Plan inputs

Every `env` value is either a literal or a `${env:VAR_NAME}`
reference resolved from the shell that launched Cursor — there is
no interactive secret prompt.

Split Step 2 inputs by `isRequired`:

1. **Required** — always include in Step 4.
2. **Optional** — if even ONE exists, STOP and ask. List required
   inputs first (informational), then each optional one by name +
   description and ask which to configure. Do NOT decide for the
   user.
3. No inputs → skip this step.

For each input in Step 4:

- **Secrets** (`isSecret=true`): use `${env:VAR_NAME}` in the config;
  tell the user to export it via `read -rs VAR_NAME && export
  VAR_NAME && echo exported` (and add to `~/.zshrc` for persistence).
  Picked up on next launch (Step 5). NEVER take secrets in chat,
  echo them back, or write raw values into config.
- **Non-secrets**: literal in `env` or `${env:VAR_NAME}` — ask if
  unclear.

### Step 4: Write the config entry

Add the entry under `mcpServers` in the target config (default
`.cursor/mcp.json` — see Step 1). **Both `--yes` and `--registry
<URL>` MUST come BEFORE `@jfrog/mcp-gateway`** or `npx` falls back
to the default registry (404) and may block on a no-TTY prompt. Use
`"type": "stdio"` — never `"http"`, `"sse"`, or a top-level `"url"`
(those bypass the gateway).

```json
{
  "mcpServers": {
    "<spec.packageName>": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "--yes",
        "--registry",
        "<REGISTRY_URL>",
        "@jfrog/mcp-gateway",
        "--server",
        "<SERVER_ID>"
      ],
      "env": {
        "_JF_MCP_LOADER_ARGS": "project=<PROJECT>&mcp=<spec.packageName>",
        "<ENV_VAR_OR_HEADER_NAME>": "${env:<ENV_VAR_OR_HEADER_NAME>}"
      }
    }
  }
}
```

Notes:

- If a required `${env:VAR}` is unset, the gateway fails at startup
  — confirm the user exported it before they restart.
- For `Bearer`-prefixed headers, either include the prefix in the
  env var or hard-code it: `"Bearer ${env:TOKEN}"`.

### Step 5: Enable and verify the entry (mandatory)

Adding the entry to `mcp.json` is not enough — Cursor stores
enable/approval state separately and does not auto-enable new
servers. Run this from the workspace root for **every** server you
just wrote, using the same string as the JSON key:

```bash
cursor agent mcp enable <mcp-display-name>
```

Resolution order for the `cursor` binary — try each in order, use
the first that responds to `--version`:

1. `cursor` (already on `PATH`)
2. `~/.local/bin/cursor`
3. `/usr/local/bin/cursor`
4. `/Applications/Cursor.app/Contents/Resources/app/bin/cursor` (macOS)
5. `%LOCALAPPDATA%\Programs\cursor\resources\app\bin\cursor.cmd` (Windows)
6. `/opt/cursor/resources/app/bin/cursor` (Linux)

Expected per server: `✓ Enabled and approved MCP server: <name>`.
ONLY if every binary path fails OR the user has forbidden terminal
commands: tell them to open **Settings → Tools & MCP** and toggle
each server on.

Then tell the user to export every `${env:VAR}` from the new entry
in the launching shell, and restart Cursor (or `Developer: Reload
Window`) so the new config + env are picked up.

**Verify (mandatory):** `ready` in `cursor agent mcp list` is NOT
proof of success — Cursor shows it as soon as the gateway proxy
starts, even with 0 upstream tools loaded. The only proof is **tool
descriptors actually present** in
`~/.cursor/projects/<this-workspace>/mcps/<key>/tools/*.json` (the
key matches the JSON key, optionally prefixed `user-`). If `tools/`
is empty (or the directory is missing) after a `Developer: Reload
Window`, treat as Failed and follow Troubleshooting "`ready` but 0
tools".

### Step 6: Authenticate OAuth MCPs (auto, after Step 5)

Run ONLY for OAuth-style remote MCPs — i.e. `--inspect` showed a
`remote` section with `type: "http"` AND Step 4 wrote no static auth
header into `env`. Skip for local MCPs and for remote MCPs whose
auth comes from a static token in `env`.

`--login` opens the browser, runs OAuth, caches tokens in
`~/.jfrog/jfrogmcp.conf.json`. Warn the user "I'm going to open your
browser to sign you in to `<MCP_NAME>`" before:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/mcp-gateway \
  --login \
  --server <SERVER_ID> \
  --project <PROJECT> \
  --mcp <spec.packageName>
```

Outcomes:

- **Exit 0** — OAuth completed; tokens cached; server ready.
- **`expected 401, got 200`** — MCP is anonymous (no auth needed);
  ignore.
- **Any other error** — paste it to the user verbatim and stop.

## Removing an MCP

1. Delete the entry from `mcpServers` in the file it was installed
   in (`.cursor/mcp.json` or `~/.cursor/mcp.json`).
2. If OAuth was used (Step 6), also remove its entry from
   `~/.jfrog/jfrogmcp.conf.json`.
3. Tell the user to reload Cursor (`Developer: Reload Window`) so
   the removed entry stops loading (`mcp.json` is read at session
   start only).

## Listing MCPs

**Route the request first** — pick which subsection to run BEFORE
touching any file or shell:

| User said… | Run |
| --- | --- |
| "available", "what can I install", "what's in the catalog", "list MCPs" without other context | **Available to install** below — go straight to `--list-available`; do NOT inspect local files first |
| "installed", "configured", "connected", "running", "what MCPs do I have" | **Currently installed** below |
| ambiguous / both | run **both** subsections in order: Currently installed first, then Available to install, and present them as separate tables |

NEVER invent MCP integrations from outside the catalog. The only
authoritative source for what's available is `--list-available`
against the configured server + project. If that command returns
nothing or errors, say so — do not pad the answer with names from
elsewhere.

### Currently installed

1. Run `cursor agent mcp list` for connection status (one row per
   server).
2. For JFrog metadata, read `mcpServers` directly from
   `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (user) —
   use the file-read tool or a single `jq` invocation, NOT chained
   `python3 -c "..."` pipes. For each entry whose `command` is `npx`
   and whose `args` include `@jfrog/mcp-gateway`, show: display name
   (the JSON key), package (`mcp=` in `_JF_MCP_LOADER_ARGS`), server
   ID (value after `--server`), scope (project / user).
3. If a configured entry does not appear in `cursor agent mcp list`,
   it was never enabled — re-run Step 5
   (`cursor agent mcp enable <name>`).

### Available to install

1. Determine **server** and **project** per the Pre-flight rule at
   the top of this document. `--list-available` does NOT require
   any existing `mcpServers` entry or pre-installed gateway —
   `npx --yes` fetches the gateway on demand, so this works on a
   fresh machine too.
2. Run EXACTLY this command — `--server` and `--project` are
   passed as CLI flags, **no env vars needed**:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/mcp-gateway \
  --list-available \
  --server <SERVER_ID> \
  --project <PROJECT>
```

Output is a JSON array; each element has `name`, `packageName`,
`description`, `type`, `packageVersion`, optional `env[]`.

3. Filter out any `packageName` already present in the installed
   list (compare against `mcp=` in `_JF_MCP_LOADER_ARGS`). Mark the
   rest as available to install.

## Key Rules

- **`npx` arg order:** `--yes`, `--registry <URL>`,
  `@jfrog/mcp-gateway`, then gateway flags. Both `--yes` and
  `--registry` MUST precede the package name or `npx` falls back to
  the default registry (404) and may block on a no-TTY prompt.
- **Always `"type": "stdio"`** pointing at `npx @jfrog/mcp-gateway`,
  even for remote-only catalog MCPs (the gateway proxies them).
  `"http"`, `"sse"`, or a top-level `"url"` bypass the gateway.
- `_JF_MCP_LOADER_ARGS` is **only** for the entry Cursor launches
  at session start (Step 4's `mcpServers.*.env`); MUST contain
  `project=<NAME>&mcp=<PACKAGE_NAME>`.
  NEVER pass `_JF_MCP_LOADER_ARGS` to `--list-available`,
  `--inspect`, or `--login` — those take `--server` / `--project`
  as CLI flags only.
- Package name MUST come from the catalog (`--inspect` /
  `--list-available`). NEVER guess. NEVER install MCPs outside the
  gateway. NEVER use Fetch/WebFetch for catalog calls.
- NEVER write a raw secret into `mcp.json` — always use
  `${env:VAR_NAME}`. NEVER show tokens / API keys.

## Troubleshooting

- **`ready` but 0 tools (empty `mcps/<key>/tools/` after a
  `Developer: Reload Window`)** — gateway proxy started, upstream
  MCP did not. The top-level `ready` label is misleading here.
  NEVER report success. Open Cursor's MCP / Output panel for the
  gateway stderr; diagnose by MCP type:
  - **OAuth (remote)** — re-run Step 6 (`--login`); refresh token
    likely expired.
  - **Static-token (remote)** — confirm every `${env:VAR}` in `env`
    is exported in the shell that launched Cursor and the token is
    still valid.
  - **Local (stdio)** — check that the bundled binary actually
    launched (gateway stderr will show the spawn error).
- **`mcp.json` server missing from `cursor agent mcp list` /
  Tools & MCP** — never enabled. Re-run Step 5
  (`cursor agent mcp enable <name>`); if the entry is brand-new,
  also `Developer: Reload Window` so Cursor picks up the file.
- **Gateway: `multiple/no JFrog server configured`** (the gateway
  cannot pick a JFrog server) — pass `--server <ID>` (after
  `jf c add <SERVER_ID>`) OR export both `JFROG_URL` and
  `JFROG_ACCESS_TOKEN` in the launching shell, then relaunch Cursor.
- **OAuth MCP failing** — refresh token expired; re-run Step 6.
- **401/403 with `${env:VAR}`** — env var unset/wrong; re-export in
  the launching shell and relaunch Cursor.
- **`cursor: command not found`** — the Cursor shell command is not
  on `PATH`. Use the absolute binary for `enable` (see Step 5
  resolution order) and tell the user to install the shell command
  via `Cmd+Shift+P` → `Shell Command: Install 'cursor' command in
  PATH`, or symlink it themselves:
  `ln -s /Applications/Cursor.app/Contents/Resources/app/bin/cursor
  ~/.local/bin/cursor`.
