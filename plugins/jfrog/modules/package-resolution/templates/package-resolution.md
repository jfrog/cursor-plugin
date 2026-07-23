# Package Resolution — Artifactory First

Your organization mediates package fetches through JFrog Artifactory for the
**governed** package managers listed below. Before any governed package install —
shell, sub-agent, or MCP tool — route through the resolved Artifactory repository.

{{GOVERNED_SCOPE}}
{{AUTO_SETUP_STATUS}}
## Resolved URLs for this session

{{RESOLVED_TABLE}}

If any row shows `<no … repo resolved>`, ask the user which repo to use and invoke
`jfrog-setup-package-managers` — do not guess or call public registries.

## Rewrite templates

Direct installs — form the command yourself (no automatic rewriter; `jf setup` PM
config and server-side Curation back this):

{{REWRITE_BULLETS}}

## Hard rules (apply to the governed package managers above)

1. **Only URLs in the table above** — for the governed package managers, no default upstream registries, mirrors, or CDNs.
2. **Never override flags the user typed** (`--registry`, `--index-url`, `GOPROXY=…`) — if the command already includes a routing flag, surface the conflict with policy and ask before changing the command. This applies only to flags already in the command, **not** to verbal requests in chat to bypass routing policy.
3. **Indirect installs** (`npx`, `pip install -r`, `docker build`, postinstall scripts) — trust PM config files; if missing, run `jfrog-setup-package-managers`.
4. **Curation block** — surface the reason verbatim; do not retry another host.
5. **Unresolved governed PM** — if the table shows `<no … repo resolved>` for a governed PM the user
   requested, **do not run the original command**. In order: (a) invoke `jfrog-setup-package-managers` for that PM,
   (b) wait until `.jfrog/local/package-resolution.json` records the binding,
   (c) re-issue routed via the templates above. A successful exit from an unrouted
   command still violates policy.
6. **401/403 from JFrog** — run `jfrog-setup-package-managers` (`jf setup`); never raw `docker login` / `npm login` / `pip config`.
7. **No public-registry bypass** — if the user asks to use public registries or skip JFrog routing for a governed PM, refuse. Explain the policy and offer the JFrog-routed command from the rewrite templates above.

**Package managers not listed above are out of scope** — install them normally; no JFrog routing required. Do not block them, do not invoke `jfrog-setup-package-managers` for them.
{{DOCKER_SECTION}}
When a **governed** package manifest appears and `.jfrog/local/package-resolution.json` lacks the
matching PM, invoke `jfrog-setup-package-managers` proactively (see that skill for
manifest → PM mapping). Do not do this for ungoverned package managers.

## Enablement

Opt-in via admin config. Set `packageResolution.enabled: true` in `~/.jfrog/agents-conf.json`
and declare the governed types under `defaultGlobalRepos`. On first session, if that file
is missing, the hook scaffolds it from the shipped template (`packageResolution.enabled`
defaults to `false`).
