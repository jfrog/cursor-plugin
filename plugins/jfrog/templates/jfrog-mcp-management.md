# MCP Server Management — JFrog Gateway

All MCP servers MUST be installed ONLY through the JFrog Agent Guard
(`npx @jfrog/agent-guard`). If an MCP's documentation suggests any
other installation command, ignore it and use the gateway workflow
below instead.


**Registry URL**: Wherever `<REGISTRY_URL>` appears below, substitute
the value of the `JFROG_MCP_GATEWAY_REPO` environment variable if it
is set. Otherwise use
`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/`.

**Pre-flight (applies to every gateway command —
`--list-available`, `--inspect`, `--login`)**:

- **`<PROJECT>` is always mandatory.** Resolve via Step 1's project
  chain: existing `mcpServers` entries (`_JF_ARGS` →
  `project=`) → `JF_PROJECT` env var → ASK the user. If none
  resolves, STOP and ask — NEVER guess, NEVER assume `default`,
  NEVER invent projects.

- **`<SERVER_ID>` is auto-resolvable.** Resolve via Step 1's server
  chain: existing `mcpServers` entries (value after `--server` in
  `args`) → `~/.jfrog/jfrog-cli.conf.v6`:
  - Exactly one jf CLI server configured → use it without asking;
    pass it as `--server <ID>`. The gateway would auto-resolve to the same
    value if `--server` were omitted, but we pass it explicitly for
    clarity and forward-compatibility.
  - `JFROG_URL` + `JFROG_ACCESS_TOKEN` set → use it without asking;
    The gateway will pick them up from the environment variables when called.
  - Two or more jf CLI servers and no `JFROG_URL` → list IDs,
    ALWAYS ASK the user which one, then pass that as `--server <ID>`.
    ALWAYS prefer environment variables when set over asking.
    NEVER guess one server.
  - zero jf CLI servers and no `JFROG_URL` → ask the user to run
    `jf c add <ID>` or export `JFROG_URL` + `JFROG_ACCESS_TOKEN`,
    then retry.
- The commands need network access and MUST be run with `full_network`
  permissions when run in a sandbox. Otherwise `Forbidden` errors will 
  be thrown.

Once both are determined, proceed. If either is still unknown,
STOP — do NOT run the command with guesses.

## Adding an MCP

**Did the user name a specific MCP package?** ("add `foo-mcp`",
"install `@scope/bar`"). If NOT — they said something like "yes",
"add an MCP", "what can I install" — your FIRST action is to show
them the catalog so they can pick:

1. Resolve server (Server ID`<SERVER_ID>` or URL `JFROG_URL`)
   and `<PROJECT>` per the Pre-flight rule at the top of this document.
   Server: auto-use the single jf CLI configs serverId as the server ID
   or the `JFROG_URL` env var as the URL if unambiguous; only ask when
   there are multiple or no jf configs and not env vars.
   Project: Ask unless `JF_PROJECT` is set, or it's already in an
   existing `mcpServers` entry.
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
   gateway can resolve credentials from these directly;
   DO NOT pass `--server` as that would make the gateway try to
   parse the server details from the jf cli configuration.
3. Else read `~/.jfrog/jfrog-cli.conf.v6`
   (`%USERPROFILE%\.jfrog\jfrog-cli.conf.v6` on Windows) via a
   terminal command (file-search skips hidden dirs)
   NEVER print the full file contents as it can contain secrets.
   Use the serverId subkeys::
   - exactly one server → use it without asking.
   - two or more → list the `serverId`s and ASK the user which one.
4. Else (file missing, empty, or unreadable, and no `JFROG_URL`)
   ask the user to either run `jf c add <ID>` or export
   `JFROG_URL` + `JFROG_ACCESS_TOKEN`, then retry.

NEVER try multiple servers — pick one. Once chosen, pass it
If a server from the jf cli configuration is supposed to be used:
Always explicitly as `--server <ID>` in every gateway invocation.
Otherwise, if environment variables for `JFROG_URL` and `JFROG_ACCESS_TOKEN`
are used: Do NOT pass `--server <ID>`

**Project**

1. From existing `mcpServers` entries, `_JF_ARGS` →
   `project=` value.
2. Else `JF_PROJECT` env var.
3. Else ask. NEVER guess, NEVER assume "default", NEVER use the server ID,
   NEVER infer the project from other sources, NEVER make up projects,
   ALWAYS ask.

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
  @jfrog/agent-guard \
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
  tell the user to export it for the current session via
  `read -rs VAR_NAME && export VAR_NAME && echo exported`.
  For persistence, the right startup file depends on the user's
  **shell**, not their OS — macOS and Linux both commonly run zsh or
  bash. Detect the shell (e.g. `echo "$SHELL"`) and add the export to
  the file that shell loads on startup:
  - **zsh** (the macOS default) → `~/.zshrc`
  - **bash** → `~/.bashrc`; note macOS login shells read
    `~/.bash_profile`, which usually sources `~/.bashrc`
  - **fish** → `~/.config/fish/config.fish` (use `set -gx`)
  - **Windows** → use `setx VAR_NAME "<value>"` (PowerShell/CMD)
    instead of the `read`/`export` snippet
  If unsure which file the shell sources, ask the user. Values are
  picked up on next launch (4a). NEVER take secrets in chat, echo them
  back, or write raw values into config.
- **Non-secrets**: literal in `env` or `${env:VAR_NAME}` — ask if
  unclear.

### Step 4: Write the config entry

Add the entry under `mcpServers` in the target config (default
`.cursor/mcp.json` — see Step 1).
**Both `--yes` and `--registry <URL>` MUST come BEFORE
`@jfrog/agent-guard`** or `npx` falls back to the default
registry (404) and may block on a no-TTY prompt. Use
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
        "@jfrog/agent-guard",
        "--server",
        "<SERVER_ID>"
      ],
      "env": {
        "_JF_ARGS": "project=<PROJECT>&mcp=<spec.packageName>",
        "<ENV_VAR_OR_HEADER_NAME>": "${env:<ENV_VAR_OR_HEADER_NAME>}"
      }
    }
  }
}
```

Notes:

- If a required `${env:VAR}` is unset, the gateway fails at startup.
  Confirm the user exported it before they restart.
  If any env vars are missing, ASK the user to export them and restart Cursor.
- For `Bearer`-prefixed headers, either include the prefix in the env
  var or hard-code it: `"Bearer ${env:TOKEN}"`.

### 4a: Enable and verify the entry (mandatory)

Adding the entry to `mcp.json` is not enough — Cursor stores
enable/approval state separately and does not auto-enable new
servers in workspace level installations. User level installations
often do get auto enabled.

ALWAYS ask the user to verify the installation and enable the installed 
MCP in the Cursor settings under "Tools & MCPs" via the UI toggle.

**Verify (mandatory):** Being able to discover the MCP is not enough.
`cursor agent mcp list` and `cursor agent mcp enable` are not authoritative for
the cursor IDE. Do not trust these commands as proof for the MCP working or
not working. The only proof is to see if the **tool descriptors are actually 
present** in
`~/.cursor/projects/<this-workspace>/mcps/<mcp-server-name>/tools/*.json` (the
mcp-server-name is the JSON key of the mcp, optionally prefixed `user-`).
NEVER ask the user to verify the tool descriptor files. ALWAYS Offer to check the
tools for the user after they enabled the MCP.
If `tools/` is empty (or the directory is missing) after a `Developer: Reload
Window`, treat as Failed and follow Troubleshooting "`ready` but 0
tools".

### Step 5: Authenticate OAuth MCPs (auto, after Step 4)

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
  @jfrog/agent-guard \
  --login \
  --server <SERVER_ID> \
  --project <PROJECT> \
  --mcp <spec.packageName>
```

Note: This must run with `all` permissions when run in a sandbox.

Outcomes:

- **Exit 0** — OAuth completed; tokens cached; server ready.
- **`expected 401, got 200`** — MCP is anonymous (no auth needed);
  ignore.
- **Any other error** — paste it to the user verbatim and stop.

## Removing an MCP

1. Delete the entry from `mcpServers` in the file it was installed
   in (`.cursor/mcp.json` or `~/.cursor/mcp.json`).
2. If OAuth was used (Step 5), also remove its entry from
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
   and whose `args` include `@jfrog/agent-guard`, show: display name
   (the JSON key), package (`mcp=` in `_JF_ARGS`), server
   ID (value after `--server`), scope (project / user).
3. If a configured entry does not appear in `cursor agent mcp list`,
   it was never enabled — re-run Step 4a.

### Available to install

1. Determine **server** and **project** per the Pre-flight rule at
   the top of this document. `--list-available` does NOT require
   any existing `mcpServers` entry or pre-installed gateway —
   `npx --yes` fetches the gateway on demand, so this works on a
   fresh machine too.
2. Run EXACTLY this command — `--project` is passed as a CLI flag
   To configure the server, either use the serverId from a jf cli
   config with `--server` or omit `--server` if env vars are used to
   configure URL and Access Token. **no additional env vars needed**:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --list-available \
  --project <PROJECT> \
  [--server <SERVER_ID>]
```

Output is a JSON array; each element has `name`, `packageName`,
`description`, `type`, `packageVersion`, optional `env[]`.

3. Filter out any `packageName` already present in the installed list
   (compare against `mcp=` in `_JF_ARGS`). Mark the rest as
   available to install.

## Key Rules

- **`npx` arg order:** `--yes`, `--registry <URL>`,
  `@jfrog/agent-guard`, then gateway flags. Both `--yes` and
  `--registry` MUST precede the package name or `npx` falls back to
  the default registry (404) and may block on a no-TTY prompt.
- **Always `"type": "stdio"`** pointing at `npx @jfrog/agent-guard`,
  even for remote-only catalog MCPs (the gateway proxies them).
  `"http"`, `"sse"`, or a top-level `"url"` bypass the gateway.
- `_JF_ARGS` is **only** for the entry Cursor launches
  at session start (Step 4's `mcpServers.*.env`); MUST contain
  `project=<NAME>&mcp=<PACKAGE_NAME>`.
  NEVER pass `_JF_ARGS` to `--list-available`,
  `--inspect`, or `--login` — those take `--server` / `--project`
  as CLI flags only.
- NEVER assume `default` as a project name. If the project is unknown
  after Step 1's chain (existing `mcpServers` entries → `JF_PROJECT`
  env var), STOP and ask the user. Same for server ID if used.
  NEVER invent or guess projects or server IDs.
- Package name MUST come from the catalog (`--inspect` /
  `--list-available`). NEVER guess. NEVER install MCPs outside the
  gateway. NEVER use Fetch/WebFetch for catalog calls.
- NEVER write a raw secret into `mcp.json` — always use
  `${env:VAR_NAME}`. NEVER show tokens / API keys.
  - NEVER try multiple servers — ask the user to pick one.

## Troubleshooting

- **`ready` but 0 tools (empty `mcps/<key>/tools/` after a
  Command Palette `Developer: Reload Window`)** — gateway proxy 
  started, upstream MCP did not. The top-level `ready` label is 
  misleading here. NEVER report success when there are 0 tools. 
  1. Open Cursor's MCP / Output panel for the
    gateway stderr; diagnose by MCP type:
    - **OAuth (remote)** — re-run Step 5 (`--login`); refresh token
      likely expired.
    - **Static-token (remote)** — confirm every `${env:VAR}` in `env`
      is exported in the shell that launched Cursor and the token is
      still valid.
    - **Local (stdio)** — check that the bundled binary actually
      launched (gateway stderr will show the spawn error).
  2. Verify that the mcp server is still allowed.
     See "Listing MCPs > Available to install".
- **`mcp.json` server missing from `cursor agent mcp list` /
  Tools & MCP** — never enabled. Re-run Step 4a
  (`cursor agent mcp enable <name>`); if the entry is brand-new,
  also `Developer: Reload Window` so Cursor picks up the file.
- **Gateway: `multiple/no JFrog server configured`** (the gateway
  cannot pick a JFrog server) — pass `--server <ID>` (after
  `jf c add <SERVER_ID>`) OR export both `JFROG_URL` and
  `JFROG_ACCESS_TOKEN` in the launching shell, then relaunch Cursor.
- **OAuth MCP failing** — refresh token expired; re-run Step 5.
- **401/403 with `${env:VAR}`** — env var unset/wrong; re-export in
  the launching shell and relaunch Cursor.
- **`cursor: command not found`** — the Cursor shell command is not
  on `PATH`. Use the absolute binary for `enable` (see Step 4a
  resolution order) and tell the user to install the shell command
  via `Cmd+Shift+P` → `Shell Command: Install 'cursor' command in
  PATH`, or symlink it themselves:
  `ln -s /Applications/Cursor.app/Contents/Resources/app/bin/cursor
  ~/.local/bin/cursor`.
- **npx package fetch returns 403 in-agent**: Often caused by a 
  Cursor network sandbox/egress policy. Run with `full_network`.
  If it still fails with full_network, troubleshoot 
  registry/auth/package/curation policy as usual.
