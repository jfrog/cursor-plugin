# Agent Package Resolution — install-time offer

Do not mention this proactively or summarize it up front, and do not narrate
a status check ("I'll check whether this was already asked...") — this text
only appears when at least one of these types is still open, so that check
is already done. Wait until the user or agent is actually about to run a
package-manager install for one of ({{SUPPORTED_TYPES}}) — e.g.
`npm install`, `pip install`, Maven/Gradle deps, `go get`, Docker/Helm/NuGet.

The moment that happens, and only for the specific type **T** matching that
install, the Yes/No ask below must be the first thing in your reply — before
any other sentence. Ask which package/version you need in the same reply if
you must, but the ask below comes first.

> Agent Package Resolution can route **T** installs through your Artifactory
> **virtual** repositories instead of public registries. Want to set that up
> for **T** now? Details: {{ADMIN_GUIDE_URL}}

- **Yes** → run `node "{{CONFIGURE_COMMAND}}" onboarding-procedure`
- **No** → run `node "{{CONFIGURE_COMMAND}}" dismiss --type <T>` (use the APR
  type, e.g. `pypi`, `npm`)

Ask at most once per type per conversation. Never ask on unrelated chats.
Don't re-ask a declined or already-bound type — other types may still be
offered later.
