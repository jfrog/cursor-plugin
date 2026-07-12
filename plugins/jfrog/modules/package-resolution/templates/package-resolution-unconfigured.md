# Package Resolution — JFrog Artifactory routing is NOT READY

Your organization routes every package fetch through JFrog Artifactory, but routing
cannot run yet — `jf` has no configured server. Package managers still point at
**public** registries until setup completes.

{{GOVERNED_SCOPE}}

**Do not run direct package installs for the governed package managers** while routing is not ready. When asked to
install or pull governed packages, tell the user routing is blocked and complete setup first. Package managers not
listed above are out of scope — handle them normally.

## Read this first

Authoritative procedure:

1. **`jfrog-setup-package-managers`** skill — **Step 0** for this state.
2. Base **`jfrog`** skill — `references/jfrog-login-flow.md` for server login.

## What to do instead

{{CAUSE_REMEDIATION}}

{{JFROG_PLATFORM_URL_HINT}}

1. Confirm `jf` is installed (`jf --version`).
2. Configure a JFrog server (login flow or `jf config add` with access token);
   confirm with `jf config show`.
3. Invoke **`jfrog-setup-package-managers`** to bind PMs this workspace needs.

## After setup — load the routing policy

Once `jf` is configured and `jfrog-setup-package-managers` has bound the PMs,
load the current routing policy by running:

```bash
{{REFRESH_COMMAND}}
```

Treat that command's stdout as the authoritative, now-current package-resolution
policy — it **supersedes this "NOT READY" notice** and prints the resolved
Artifactory URLs and hard rules for every configured package type. Then re-issue
the install using those URLs.

If the command prints nothing, routing is off by config
(`packageResolution.enabled` is not `true`) — an admin opt-in (see Enablement
below). Report that to the user and let them decide.

## Enablement

Routing is opt-in. Set `packageResolution.enabled: true` in `~/.jfrog/agents-conf.json`.
On first session, if that file is missing, the hook scaffolds it from the shipped
template (`packageResolution.enabled` defaults to `false`).
