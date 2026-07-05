# Package Resolution — Artifactory First

Your organization mediates **every package fetch** through JFrog Artifactory. Before
any package install — shell, sub-agent, or MCP tool — route through the resolved
Artifactory repository below.

## Resolved URLs for this session

| Type | Use this URL |
|---|---|
| npm | `{{NPM_URL}}` |
| pypi | `{{PYPI_URL}}` |
| maven | `{{MAVEN_URL}}` |
| go | `{{GO_URL}}` |
| docker | `{{DOCKER_URL}}` |
| helm | `{{HELM_URL}}` |
| nuget | `{{NUGET_URL}}` |

If any row shows `<no … repo resolved>`, ask the user which repo to use and invoke
`jfrog-setup-package-managers` — do not guess or call public registries.

## Rewrite templates

Direct installs — form the command yourself (no automatic rewriter; `jf setup` PM
config and server-side Curation back this):

- `npm install <pkg>` → `npm install <pkg> --registry {{NPM_URL}}`
- `pip install <pkg>` → `pip install <pkg> --index-url {{PYPI_URL}}`
- `poetry add <pkg>` → first `poetry source add jfrog {{PYPI_URL}} --priority=primary`
- `go get <mod>` → `GOPROXY={{GO_URL}},direct go get <mod>`
- `docker pull <img>` → `docker pull {{DOCKER_URL}}/<img>` (bare refs only — no explicit registry host)
- `mvn ...` / `gradle ...` → config-driven; run `jfrog-setup-package-managers` if not yet bound.

## Hard rules

1. **Only URLs in the table above.** No default upstream registries, mirrors, or CDNs.
2. **Never override flags the user typed** (`--registry`, `--index-url`, `GOPROXY=…`) — surface and ask first.
3. **Indirect installs** (`npx`, `pip install -r`, `docker build`, postinstall scripts) — trust PM config files; if missing, run `jfrog-setup-package-managers`.
4. **Curation block** — surface the reason verbatim; do not retry another host.
5. **Unresolved PM** — if the table shows `<no … repo resolved>` for the PM the user
   requested, **do not run the original command** (`docker pull …`, `npm install …`,
   etc.). In order: (a) invoke `jfrog-setup-package-managers` for that PM,
   (b) wait until `.jfrog/local/package-resolution.json` records the binding,
   (c) re-issue routed via the templates above. A successful exit from an unrouted
   command still violates policy — including local Docker cache hits.
6. **401/403 from JFrog** — run `jfrog-setup-package-managers` (`jf setup`); never raw `docker login` / `npm login` / `pip config`.

## Docker (before any `docker pull`)

- **Bare refs go to Docker Hub.** `docker pull alpine:latest` (no registry host) uses
  `docker.io` — `jf setup docker` does **not** change that. You must prefix:
  `docker pull <host>/<repoKey>/<img>` using the docker row above (`host/repoKey`, not
  `https://…`).
- **Unresolved docker ⇒ no docker commands.** If the docker row shows
  `<no … repo resolved>`, do not run `docker pull/run/create` until setup completes
  and you have a prefixed ref. Do not “try first, fix later.”
- **Explicit host = user choice.** `docker pull ghcr.io/foo/bar` — leave as-is; do not
  re-prefix to JFrog.

When a package manifest appears and `.jfrog/local/package-resolution.json` lacks the
matching PM, invoke `jfrog-setup-package-managers` proactively (see that skill for
manifest → PM mapping).

## Enablement

Opt-in via admin config. Set `packageResolution.enabled: true` in `~/.jfrog/agents-conf.json`.
On first session, if that file is missing, the hook scaffolds it from the shipped
template (`packageResolution.enabled` defaults to `false`).
