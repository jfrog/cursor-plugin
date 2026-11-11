# Plugin telemetry

The **JFrog plugin** reports a small lifecycle event at the start of each session in Claude Code, Cursor, VS Code (GitHub Copilot) and Codex, so JFrog can count installs per harness and version. This page describes what is sent and how developers and administrators turn it off.

Plugin telemetry is separate from JFrog CLI usage reporting: each product has its own switch.

---

## What is sent

- **When:** at session start, from a hidden background process. The session never waits for it, and nothing is printed or added to the agent's context. At most one event per session: `install` the first time, `update` after the plugin or hooks version changes, otherwise `active` at most once a day. A failed send is retried at a later session. The process waits a random 0–60 s before it sends, so that many machines starting together (for example after an MDM rollout) don't all send in the same minute.
- **When the JFrog Platform is busy:** after a 429 (rate limited) or a 5xx, that harness sends nothing for an hour, then two, doubling up to 24 hours, and for at least as long as the `Retry-After` header asks (up to 24 hours). A success resets it, so the next 429 or 5xx waits an hour again.
- **What:** the event type, a random install ID (one per OS user, shared by every harness), the harness, the plugin and hooks versions (on `update`, also the previous ones), the OS family, how the JPD URL was found, and a reason code. When the event goes to the JFrog endpoint below instead of your JFrog Platform, it also carries your JFrog Platform's host name (without the port), if there is one.
- **Not sent:** prompts, code, file paths, usernames, emails or tokens in the event. (The authenticated send below lets the JFrog CLI add its own credential, to your JFrog Platform only.)
- **Authenticated:** when the URL found is `https` and the JFrog CLI (2.100.0 or later) has a server for it (same scheme, host and port), the event is first sent through the JFrog CLI (`jf api`) with that server's credentials (never to the JFrog endpoint below), and your JFrog Platform stores a hashed user ID with it, the same one it stores for MCP usage. The plugin never reads those credentials. If the JFrog CLI is missing or gives no answer within 3 s, or your JFrog Platform answers with anything other than a success, 400, 408, 413, 422 or 429 (for example 401 for an expired credential, or 404 when it doesn't have the authenticated route yet), the event is sent again without them. Without such a server, the event is sent without credentials (anonymous). A JFrog CLI server saved with a path in its URL (for example `https://acme.jfrog.io/artifactory/`) isn't used for this; save it as `https://acme.jfrog.io/`.
- **Where:** your JFrog Platform, at the first URL found (see [Point events at your JFrog Platform](#point-events-at-your-jfrog-platform)). When none is found, the one found isn't an `http(s)` URL, or your JFrog Platform can't be reached or turns the event away, a JFrog endpoint in the EU (`https://pluginmetrics.jfrog.io`). If your JFrog Platform rejects the event itself (400, 413, 422 or 429), nothing is sent to that endpoint for the session.
- **Local files:** `~/.jfrog/telemetry/` holds the install ID (`install-id-v1.json`), one receipt per harness and, while a harness waits after a 429 or 5xx, its `backoff-<harness>-v1.json`. Nothing is written there when telemetry is off.

---

## Point events at your JFrog Platform

The plugin sends to the first of these that is set:

| Source | Who | Notes |
| ------ | --- | ----- |
| `telemetry.jpdUrl` in `~/.jfrog/agents-conf.json` | Administrator (MDM, golden image) | Read only; the plugin never writes it |
| `JFROG_URL` | Developer, or Claude Code managed settings `env` | |
| `JF_URL` | Developer | |
| JFrog CLI configuration | `jf config add`, `jf login` | `jfrog-cli.conf.v6` in `$JFROG_CLI_HOME_DIR`, else `~/.jfrog`: the default server, else the only one. Read directly, without running `jf`; only the server URLs and IDs are used, never the tokens. With several servers and none marked default, none is used |

For a whole organization, deploy the URL in `agents-conf.json`:

```json
{
  "telemetry": {
    "jpdUrl": "https://acme.jfrog.io"
  }
}
```

- A value that is set but isn't an `http://` or `https://` URL (for example `acme.jfrog.io`) is not skipped in favor of the next source: the event goes to the JFrog endpoint with `reason = other` and that value's source. Fix the value.
- `jpdUrl` is read only inside a `telemetry` object. A `telemetry` key that isn't an object (for example `"telemetry": "https://acme.jfrog.io"`) holds no URL, so the next source is used.
- The file advice under [`agents-conf.json` (administrators)](#agents-confjson-administrators) applies here too.

---

## Turn telemetry off

Telemetry is **off** when **any one** of these is set. Any "off" wins: nothing turns it back on.

| Switch                                             | Who                                                    | Value   |
| -------------------------------------------------- | ------------------------------------------------------ | ------- |
| `JF_AGENT_TELEMETRY_DISABLE`                       | Developer                                              | `1`     |
| `DO_NOT_TRACK`                                     | Developer (a general preference other tools honor too) | `1`     |
| `telemetry.enabled` in `~/.jfrog/agents-conf.json` | Administrator (MDM, golden image) or developer         | `false` |

With telemetry off, no plugin telemetry event is sent and no background process starts. This covers plugin telemetry events only; the daily Agent Package Resolution heartbeat (`jf rt ping`) is separate.

`JFROG_CLI_REPORT_USAGE=false` turns off JFrog CLI usage reporting only. It does **not** turn off plugin telemetry; set one of the switches above as well.

### Environment variable (developers)

Only the value `1` counts. Restart the coding assistant after setting it.

macOS / Linux (Zsh or Bash), in the shell profile or IDE launch environment:

```bash
export JF_AGENT_TELEMETRY_DISABLE=1
```

Windows (PowerShell, user scope); restart the IDE completely so it inherits the value:

```powershell
[Environment]::SetEnvironmentVariable("JF_AGENT_TELEMETRY_DISABLE", "1", "User")
```

> **Note:** an IDE started from the Dock, Start menu or a launcher may not see variables from a shell profile. For a whole organization, use the file below.

### `agents-conf.json` (administrators)

Add the `telemetry` key to `~/.jfrog/agents-conf.json`:

```json
{
  "telemetry": {
    "enabled": false
  }
}
```

- `false` turns telemetry off, as does the string `"false"` in any letter case. Any other value, or no `telemetry` key, leaves it on. `"telemetry": false` on its own does not turn it off; set `telemetry.enabled`.
- Session start never rewrites a file that sets `telemetry`, so a deployed file keeps its setting. (It only migrates an untouched template the plugin wrote itself.) The Package Resolution setup commands may rewrite the file, but they keep the `telemetry` key. It is the same file that holds the [Agent Package Resolution settings](package-resolution-admin-guide.md#configuration-file-jfrogagents-confjson); add the `telemetry` key next to them.
- Don't deploy a file that holds only the `telemetry` key on a machine that has none yet: with no `packageResolution` block, Agent Package Resolution stays off. Start from the [default file](package-resolution-admin-guide.md#configuration-file-jfrogagents-confjson) and add the key.
- A file that exists but can't be read or parsed turns telemetry off. The hook log `~/.jfrog/logs/agent-hooks.log` warns when that happens.

### Claude Code managed settings

On Claude Code you can also push the developer switch through the `env` block of your [managed settings](https://code.claude.com/docs/en/managed-settings):

```json
{
  "env": {
    "JF_AGENT_TELEMETRY_DISABLE": "1"
  }
}
```

---

## Related documentation

- [Configure Agent Package Resolution](package-resolution-admin-guide.md) — the rest of `agents-conf.json`
