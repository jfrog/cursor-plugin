# Consent Enable — Agent Package Resolution

The user agreed to enable Agent Package Resolution. Follow these steps in order.
Do not invent repo keys. Never list the Artifactory catalog, all virtuals, or
wildcard names (`*-virtual`, `*<type>*`). Those responses can be thousands of
rows and will flood this chat.

This procedure is reached via the soft-bridge Yes/No offer, injected the same
way on **Cursor**, **Claude Code**, and **VS Code Copilot**.

## 1. Ask which repository / package types to configure

This procedure is the **only** place the types question is asked — the injected
nudge deliberately does not ask it. If you already asked, do not ask again; reuse
their answer.

Before binding repos or enable, **ask the user which types they want to govern**,
as a plain chat question with the supported types inline:

> Which package types should route through Artifactory? Supported: `npm`,
> `pypi`, `maven`, `gradle`, `go`, `docker`, `helm`, `nuget`. Reply with the
> ones you want (e.g. "maven and pypi").

Ask this as **free text**. Do **not** put the eight types into a structured
multiple-choice / options picker — those pickers cap at four options and the
call will fail validation.

They may choose one, several, or all. Do **not** assume “all types.” Do **not**
enable a type they did not pick. If they are unsure, briefly explain that only
chosen types get Artifactory routing; others stay untouched.

Wait for their answer. Remember the chosen set as `CHOSEN_TYPES`.

## 2. Prerequisites

- Ensure `jf` is installed and on PATH.
- Ensure a JFrog server is configured (`jf config show`). Prefer access token or
  username + password / API key auth.
- If setup is needed, follow the base `jfrog` skill login flow. Do **not** run
  `jf setup` until after enable + auto-setup below.

## 3. Bind one type at a time (base `jfrog` skill)

There is **no** discovery skill and **no** `configure.mjs discover` command.
Use the base **`jfrog` skill** only for **bounded** lookups (MCP / `jf` /
`jf api` as the skill directs). Do **not** invent keys.

If `CHOSEN_TYPES` has more than one type, configure them **one type at a time**.
Do not ask for project/repo for every type in one message. Do not start type
N+1 until type N is bound, skipped, or the user declines that type.

For the current type, ask as **free text** (not a project picker, not “list
projects”):

> For `<type>`, what is the Artifactory **project key** or **repository**
> key/name? Either is enough. If you do not know either, say so.

Resolve that type through **exactly one** path:

- **Repository given** (alone or with a project) → verify only that key.
  Ignore the project for lookup.
- **Project given, no repository** → one filtered call only: that exact
  project + `type=virtual` + this `packageType`. Never fetch the full project
  catalog or an unfiltered platform catalog.
  - **Query failed** (auth/network/skill error) → say what failed, fix the
    cause (usually `jf` auth), and retry the same filtered call. Do not invent
    a key. Do not treat failure as “none found.”
  - **0** matches → say none in that project; ask for another project or an
    exact repository. Do not bind.
  - **1** match → use that key. Do not ask.
  - **2–10** matches → show **name and key** (if the API exposes only `key`,
    use the key as the name too) and ask which to use.
  - **More than 10** → do **not** list, quote, or keep the extra rows. Ask for
    the exact repository name.
- **Neither given** → **exact-key fallback**. Point-lookup only
  `<type>-virtual`, `<type>-default`, then `<type>-release` (for example
  `npm-virtual`, `npm-default`, `npm-release`). Verify each hit. Do not search
  or glob.
  - **0** verified hits → ask again for a project or repository for **this
    type only**. Suggest they contact their Artifactory admin if they have
    neither. Do not bind.
  - **1** verified hit → use that key. Do not ask.
  - **2–3** verified hits → show only those keys (name and key) and ask the
    user to pick one.

**Forbidden** (every type, every turn): unfiltered `list repositories`,
platform-wide virtual listing, `*-virtual`, `*<type>*`, paginating the catalog,
or dumping a large API payload into chat. A user who says “I don’t know”
gets exact-key fallback — never a catalog dump.

Verify every auto-bound, user-confirmed, or pasted key before binding:

```bash
node "{{CONFIGURE_COMMAND}}" verify-repo --type '<chosenType>' --repo '<repoKey>'
```

`verify-repo` fails closed: it confirms the key is a **virtual** repo whose
`packageType` matches. If it fails, ask for a different key — do not bind it.
Verify every key (unique auto-binds included — cheap defense-in-depth).

Then move to the next chosen type. Collect resolved keys into a
`type → repoKey` map. If the map is empty (every type unresolved), stop and
explain; do **not** call enable.

## 4. Enable + auto-setup (no second ask)

After the verified map has at least one binding, enable **and** turn on
zero-touch auto-setup for those types. Auto-setup is part of Consent Enable —
**do not** ask a separate “want auto-setup?” question.

`enable` **replaces** `defaultGlobalRepos` with the JSON object you pass. It
does **not** merge. Re-include every type that should stay bound — this
session’s map **plus** any already-bound keys from `configure.mjs status`
(or the current `defaultGlobalRepos`). Same for `auto-setup`: it **replaces**
`autoSetup`; pass every type that should stay in that list (typically the
same keys).

```bash
node "{{CONFIGURE_COMMAND}}" enable --repos '<json-object of type to repoKey>'
node "{{CONFIGURE_COMMAND}}" auto-setup --types '<json-array of enabled types>'
```

Example:

```bash
node "{{CONFIGURE_COMMAND}}" enable --repos '{"maven":"libs-release-virtual","pypi":"pypi"}'
node "{{CONFIGURE_COMMAND}}" auto-setup --types '["maven","pypi"]'
```

`enable` writes `enabled: true` and **only** those `defaultGlobalRepos`. It
**re-verifies** each key (fail-closed). The nudge's offerable-types list is
computed fresh on the next SessionStart from `defaultGlobalRepos` + the decline
cache — nothing to re-sync, it just shrinks as types get bound. `auto-setup`
opts those types into user-global `jf setup`.

Enable **only** types that bound. Unbound chosen types stay off; say so. If
the bound map is empty, do not call enable.

## 5. Load routing + verify auto-setup

Run print-policy **synchronously**. Its stdout **is** the Package Resolution
table for this chat (Decision order + URL table + setup status). Follow that
table for the rest of this session.

```bash
JFROG_EAGER_SETUP_SYNC=1 node "{{PRINT_POLICY_COMMAND}}"
```

Wait until bound types show as **already set up**. Do **not** install while
the note says `setting up in the background`. If it still does, run
print-policy again and read the new note.

Do **not** install a test package. Do **not** read npmrc / pip.conf as extra
proof.

- Type **already set up** → later installs for that type use the normal
  package-manager command. **No** `--registry`, `--index-url`, `GOPROXY=…`,
  or other rewrite flags.
- Type **pending / failed / conflict** → follow the existing conflict/retry
  path in the printed note. That type is not ready. Never use rewrite flags
  as a fallback.
- Do **not** claim overall success unless every bound type set up.

## 6. New chat

**After** enable, auto-setup, and the sync print-policy check, tell the user
that opening a **new chat** (or reloading the IDE) picks up the updated
hooks cleanly. Routing already works in this session after `print-policy`.
