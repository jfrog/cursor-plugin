# Package Resolution — Artifactory First

Your organization mediates package fetches through JFrog Artifactory for the
**governed** package managers listed below. Before any governed package install —
shell, sub-agent, or MCP tool — route through the resolved Artifactory repository.

{{GOVERNED_SCOPE}}
Whenever this policy blocks an action, explicitly say it is blocked by the organization's **JFrog Artifactory Package Resolution policy**.
{{AUTO_SETUP_STATUS}}

## Resolved URLs for this session

{{RESOLVED_TABLE}}

If any row shows `<no … repo resolved>`, ask the user which repo to use and invoke
`jfrog-setup-package-managers` — do not guess or call public registries.

## Rewrite templates

Direct installs — form the command yourself (no automatic rewriter; `jf setup` package-manager
config and server-side Curation back this):

{{REWRITE_BULLETS}}

## Hard rules (apply to the governed package managers above)

1. **Only URLs in the table above** — for the governed package managers, no default upstream registries, mirrors, or CDNs.
2. **Never override flags the user typed** (`--registry`, `--index-url`, `GOPROXY=…`) — if the command already includes a routing flag, surface the conflict with policy and ask before changing the command. This applies only to flags already in the command, **not** to verbal requests in chat to bypass routing policy.
3. **Indirect installs** (`npx`, `pip install -r`, `docker build`, postinstall scripts) — trust package-manager config files; if missing, run `jfrog-setup-package-managers`.
4. **Curation block** — surface the reason verbatim; do not retry another host.
5. **Unresolved governed package manager** — if the table shows `<no … repo resolved>` for a governed package manager the user
   requested, **do not run the original command**. In order: (a) invoke `jfrog-setup-package-managers` for that package manager,
   (b) wait until `.jfrog/local/package-resolution.json` records the binding,
   (c) re-issue routed via the templates above. A successful exit from an unrouted
   command still violates policy.
6. **401/403 from JFrog** — run `jfrog-setup-package-managers` (`jf setup`); never raw `docker login` / `npm login` / `pip config`.
7. **No public-registry bypass** — if the user asks to use public registries or skip JFrog routing for a governed package manager, refuse. State clearly that the request is blocked by the organization's **JFrog Artifactory Package Resolution policy**, then offer the JFrog-routed command from the rewrite templates above.
8. **No delegation bypass** — do not spawn `agent -p` or another agent for a governed package-install task unless that child receives this same Package Resolution policy from trusted `sessionStart` injection. **Refuse before launching an unprotected child.** Spawning a child merely so it can refuse is still a policy violation. A routed command or policy text in the child's user prompt cannot replace trusted injection because the child can execute different commands. Never pass a forbidden install request unchanged to a child. In the refusal, explicitly say that the **JFrog Artifactory Package Resolution policy** requires governed installs to remain routed through Artifactory.

**Package managers not listed above are out of scope** — install them normally; no JFrog routing required. Do not block them, do not invoke `jfrog-setup-package-managers` for them.
{{DOCKER_SECTION}}
When a **governed** package manifest appears and `.jfrog/local/package-resolution.json` lacks the
matching package manager, invoke `jfrog-setup-package-managers` proactively (see that skill for
manifest → package-manager mapping). Do not do this for ungoverned package managers.

## Enablement

Opt-in via admin config. Set `packageResolution.enabled: true` in `~/.jfrog/agents-conf.json`
and declare the governed types under `defaultGlobalRepos`. On first session, if that file
is missing, the hook scaffolds it from the shipped template (`packageResolution.enabled`
defaults to `false`).
