# Package Resolution — Artifactory First

Your organization mediates package fetches through JFrog Artifactory for the
**governed** package managers listed below. Before any governed package install —
shell, sub-agent, or MCP tool — follow the **Decision order** below.

{{GOVERNED_SCOPE}}
Whenever this policy blocks an action, explicitly say it is blocked by the organization's **JFrog Artifactory Package Resolution policy**.
{{AUTO_SETUP_STATUS}}

## Decision order (top to bottom; first match wins)

**Setup skill** = `jfrog-setup-package-managers`. Public-registry / skip-JFrog asks → step 7 **immediately**.

1. **Unresolved** — `<no … repo resolved>` → do **not** install; invoke the setup skill. Never invent a URL or use a public registry.
2. **Zero-touch handled** — **Package manager setup** status line lists this PM as:
   - `already set up` → normal command (trust PM config). **No** `--registry`, `--index-url`, `GOPROXY=…`.
   - `setting up in the background` → **direct rewrite only** (no `npx`/`-r`/postinstall/`docker build` until `already set up` or durable PM config exists).
3. **Foreign-host conflict** — status says `left unchanged (already using another JFrog / registry)` → ask _Switch to this JFrog instance?_; on yes, `jf setup <pm> --server-id … --repo …` only — never bare `jf setup`.
4. **Manifest unbound** — governed manifest present (e.g. `package.json`, `requirements.txt`, `go.mod`; map in setup skill) **and** `.jfrog/local/package-resolution.json` lacks that type → setup skill first (`jf setup` + binding; autoSetup does **not** write that file), **then** install. No rewrite-flag-only shortcut (`--registry`, `--index-url`, `GOPROXY=…`). **Agent Guard bootstrap** (below) is exempt from this rewrite-flag ban.
5. **Ready** — binding present, **or** no governed manifest for this type. Flag-based (npm/pypi/go/docker): rewrite / trust PM config. **Config-driven** (maven/gradle/helm/nuget) unbound → setup skill first; not rewrite-ready.
6. **401/403 from JFrog** → setup skill again; never raw `npm login` / `docker login` / `pip config`.
7. **Public-registry / skip-JFrog** → refuse (hard rule #7). Offer the next allowed step from this order.

Ungoverned package managers are out of scope — install normally; do not invoke the setup skill.

## Resolved URLs for this session

{{RESOLVED_TABLE}}

Unresolved rows → Decision step 1 (setup skill; no public registries).

## Rewrite templates

Use only when Decision order reached step 2 (`setting up in the background`) or step 5. Form the command yourself (`jf setup` config + Curation back this):

{{REWRITE_BULLETS}}

## Hard rules (governed types only)

{{AGENT_GUARD_SECTION}}
1. **Only URLs in the table above** — no public registries, mirrors, or CDNs.
2. **Never override flags the user typed** (`--registry`, `--index-url`, `GOPROXY=…`) — if already in the command, ask before changing. This applies only to flags already in the command, **not** to verbal requests in chat to bypass routing policy.
3. **Indirect installs** (`npx`, `pip install -r`, `docker build`, postinstall) — trust PM config; if missing, run the setup skill (unless Decision step 2 lists `already set up`).
4. **Curation block** — surface the reason verbatim; do not retry another host.
5. **Unresolved governed package manager** — Decision step 1: setup skill → wait for `.jfrog/local/package-resolution.json` → re-issue via Decision order. Unrouted success still violates policy.
6. **401/403** — Decision step 6: setup skill (`jf setup`); never raw login/config.
7. **No public-registry bypass** — refuse; name this policy; offer the next allowed Decision step.
8. **No delegation bypass** — do not spawn `agent -p` or another agent for a governed package-install unless the child receives this policy via trusted `sessionStart` injection. **Refuse before launching an unprotected child.** Spawning a child merely so it can refuse is still a policy violation. A routed command or policy text in the child's user prompt cannot replace trusted injection because the child can execute different commands. In the refusal, say the **JFrog Artifactory Package Resolution policy** requires Artifactory routing.
{{DOCKER_SECTION}}
