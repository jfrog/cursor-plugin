# Discovering skills

List-all and versions go through the **Agent Guard** and are always limited to
skills allowed by the project's governance policy. This has no exceptions.

## List skills (page through the catalog)

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skills --project "<PROJECT>" --allowed-only [--name <PATTERN>] [--server "<SID>"] [--page-size <N>] [--cursor <C>] --format json
```

| Flag | Required | Purpose |
|------|----------|---------|
| `--project <PROJECT>` | **Yes** | AI Catalog project to list. |
| `--allowed-only` | **Yes** | Limit results to skills allowed by project policy. Never omit it. |
| `--name <PATTERN>` | No | Find skills by name: server-side, case-insensitive substring, scoped to the project. |
| `--server <SID>` | No | jf CLI config entry to authenticate with (defaults to the resolved single server). |
| `--page-size <N>` | No | Results per page. Pass `50` to stay bounded. The Agent Guard defaults to 500 if omitted. |
| `--cursor <C>` | No | Continuation cursor from a previous page's JSON, to fetch the next page. |
| `--format json` | **Yes** | Raw page JSON used to render the result. |

Request a bounded page with `--page-size 50 --format json`, present those skills,
then read `exhausted` and `cursor` from the response. If `exhausted` is `false`
there are more. Tell the user and offer to fetch the next page with
`--cursor <cursor>`. Do not silently page through the whole catalog.

**Presenting results (use this exact format).** Render the skills as this table,
sorted by name, and nothing else (no commands, URLs, flags, or cursors):

| Skill | Last updated |
|-------|-------------|
| `<name>` | `<lastUpdated>` |

For a `--name` search with no matches, reply with one line instead:

> No skills match "`<query>`".

To offer a follow-up (a skill's versions or repos), ask in plain language
("want the versions for one of these?") and run the command yourself.

## Requests for blocked or missing results

Never omit `--allowed-only`, even when the user asks to see everything, blocked
skills, disallowed skills, or the contents of a repo absent from the results.
Never run another command to infer or expose what filtering removed.

Only when the user asks about blocked or missing results, reply:

> The listing is always governance-filtered. For access to a missing or blocked
> skill or repository, contact your project's governance policy owner.

Otherwise, present the results simply as the list. Do not mention filtering, the
flag, or its mechanism.

## List a repo's skills

To see what is published in one specific skills repository (for example, to check
a repo before or after publishing to it), list it directly with the CLI. This is
repo-scoped (Artifactory registry contents), unlike `--list-skills`, which is
project-scoped:

```bash
jf skills list --repo "<repo>" --server-id "<SID>" --format json
```

Never run a bare `jf skills list` (it errors): always pass `--repo <key>` here, or
`--harness <h>` for installed skills (see `managing-installed-skills.md`).
Use this repo-scoped command only for a repo already returned by an allowed
catalog response or explicitly resolved/provisioned during publishing. Never use
it to inspect a missing repo or work around the governed catalog listing.

**Presenting results (use this exact format).** Render the skills as this table,
sorted by name, and nothing else (no commands, URLs, or flags):

Skills in `<repo>`:

| Skill | Version | Description |
|-------|---------|-------------|
| `<name>` | `<version>` | `<description>` |

Include the **Description** column only when the listing provides one (drop it if
every skill's description is empty). If the repo holds no skills, reply with one
line instead:

> No skills published in `<repo>`.

## A skill's versions and hosting repos

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skill-versions --project "<PROJECT>" --skill "<slug>" --allowed-only [--server "<SID>"] --format json
# JSON: versions[].version, versions[].locations[].repoKey
```

Treat this one response as complete. Do not page or repeat the call.

**Presenting versions (use this exact format).** Newest version first:

Versions of `<slug>`:

| Version | Hosted in |
|---------|-----------|
| `<version>` | `<repoKey>`[, `<repoKey>`…] |

Every returned location is already allowed by project policy. Do not annotate
repositories with "(allowed)" or similar labels.
