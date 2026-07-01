# Package Resolution — JFrog Artifactory routing is NOT READY

Your organization routes every package fetch through JFrog Artifactory, but routing
cannot run yet — `jf` has no configured server. Package managers still point at
**public** registries until setup completes.

**Do not run direct package installs** (including `docker pull` / `docker run`) while routing is not ready. When asked to
install or pull images, tell the user routing is blocked and complete setup first.

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

Start a **new session** after setup — concrete Artifactory URLs are injected.
Then re-issue the install.

## Enablement

Routing is opt-in. Set `packageResolution.enabled: true` in `~/.jfrog/agents-conf.json`.
On first session, if that file is missing, the hook scaffolds it from the shipped
template (`packageResolution.enabled` defaults to `false`).
