# Agent Package Resolution: User Guide (Preview)

**Audience:** Users of Cursor, Claude Code, or VS Code Copilot with the JFrog plugin, whether or not you're a professional developer.

You (or your org) installed the JFrog plugin. This is what happens next, step by step, when you ask your agent to do something that needs a package: install a dependency to build an app, pull a Docker image, and so on.

---

## Prerequisite

The JFrog plugin is installed. That's it; nothing else is required of you up front.

On **VS Code Copilot**, also enable both settings (`chat.plugins.enabled` and `chat.useHooks`) so the plugin and SessionStart hook load.

## What will happen, by case

You're mostly passive in all of this: the agent drives, and it tells you when it needs something from you.

### CLI installed and authenticated

- **You:** nothing. Just ask:

> "Add lodash as a dependency"
> "Pull the alpine image and start a container"

- **Agent:** routes your request through your organization's Artifactory right away.

This is the state you'll be in almost all the time.

### Server not configured

- **Agent:** asks you for your JFrog Platform URL, then starts a login against it (`jf config add` / `jf login`).
- **You:** provide the URL and complete the login when prompted.

### CLI not installed

- **Agent:** installs the CLI.
- **You:** may need to approve the install (a normal IDE tool-permission prompt).

### CLI not authenticated

- **Agent:** launches a login (`jf login`, usually a browser session).
- **You:** complete the login when prompted.

---

## Turning it on

The shipped template turns Agent Package Resolution **on** (`enabled: true`) with empty repository bindings. Nothing is routed to Artifactory until your org (or Consent Enable in chat) adds keys under `defaultGlobalRepos`.

To bind package types yourself, edit `~/.jfrog/agents-conf.json` (created automatically the first time you use the plugin) and set repository keys that exist on your JFrog Platform:

```json
{
  "packageResolution": {
    "enabled": true,
    "defaultGlobalRepos": {
      "npm": "npm-virtual",
      "pypi": "pypi-virtual"
    }
  }
}
```

If a repository key isn't accurate for your org, update it to the correct one. If you don't know the correct key, or a key doesn't exist on your JFrog Platform, that package type simply stays unrouted until someone corrects it; nothing breaks. Start a **new agent session** after changing the file so SessionStart reloads policy.

## Turning it off

If routing is causing problems (wrong repository, broken installs, anything else), you can turn Agent Package Resolution off immediately without touching `agents-conf.json`:

```bash
export JF_AGENT_PACKAGE_RESOLUTION_DISABLE=1
```

Restart your IDE for it to take effect. This overrides `agents-conf.json`, so it works even if your org has enabled the feature centrally. Remove the variable (or restart without it set) to turn routing back on. Please also report the issue (see [Feedback](#feedback)) so we can fix it.

To turn it off in the config file itself, set `"enabled": false`. If your file is still the untouched shipped scaffold, also set `"onboardingPrompt": "off"` — otherwise the next session can migrate `enabled` back to `true`. Setting only `"onboardingPrompt": "off"` silences Consent Enable offers; it does **not** disable APR while `enabled` remains `true`.

---

## Good to know (doesn't require you to do anything)

- **First time a project uses a given package type,** the agent may show a quick one-time confirmation ("apply this setup?") before it can route that package type. You just confirm; it's the agent doing setup work, not something you prepare for, and it won't ask again for that project.
- **Your admin may skip that confirmation entirely.** If they've turned on zero-touch setup for a package type, the plugin starts binding it to Artifactory automatically in the background when you start a session. You usually won't see a prompt for that package type. Because binding runs in the background, a very early first request in the same session can occasionally land before setup finishes.

---

## Troubleshooting

| Symptom | What to do |
|---------|-------------|
| Install fails with `401` / `403` even though routing looked ready | Your token is expired or revoked, not a repository problem; this isn't caught until an install actually fails. Log in again for that server |
| Nothing seems to be happening / no mention of Artifactory | Confirm `enabled` is `true` and `defaultGlobalRepos` has the package type; see [Turning it on](#turning-it-on), or check with your admin. Pending mode (no usable `jf` config) only shows a setup advisory |
| Install used the wrong repository | Check whether your project has a `.jfrog/local/package-resolution.json` override, or ask your admin what the org default is for that package type. See [Advanced](#advanced-project-specific-repository-overrides) below |
| You want to temporarily turn this off | See [Turning it off](#turning-it-off) above |
| Something looks broken | Check `~/.jfrog/logs/agent-hooks.log` for details, and let us know (see below); this is exactly the kind of thing we want to hear about during the preview |

---

## Feedback

This is a preview, and your feedback directly shapes what ships next. Please tell us about anything that felt confusing, broken, or surprising, good or bad.

File an issue on GitHub, in whichever plugin repo you use:

- Cursor: [github.com/jfrog/cursor-plugin/issues](https://github.com/jfrog/cursor-plugin/issues)
- Claude Code: [github.com/jfrog/claude-plugin/issues](https://github.com/jfrog/claude-plugin/issues)
- VS Code: [github.com/jfrog/vscode-plugin/issues](https://github.com/jfrog/vscode-plugin/issues)
- Email: plugins-feedback@jfrog.com

---

## Appendix: background and details

### What is Agent Package Resolution, technically

It's a feature in the JFrog plugin that runs at the start of every coding-agent session. When enabled, it checks routing readiness (as above) and, once ready, gives the agent the resolved Artifactory URL for each package type you use, so installs are routed there instead of the public registry, without changing your workflow.

### About this preview (please read)

- **This steers the agent, it does not hard-block installs.** The checks above happen because the agent is instructed to follow them, not because commands are intercepted or rewritten as you type them. If an install doesn't get routed the way you expect, that's useful feedback for us.
- **The real backstop is your package manager configuration plus Artifactory Curation**, which your admin sets up server-side. Once a package manager is bound to a repository for a project (the one-time setup step above), that binding is durable and persists across sessions, independent of this feature.
- This is a **preview**; you may hit rough edges. Please tell us about them.

### Advanced: project-specific repository overrides

If you're working in a repository that needs a different Artifactory repository than your org's default (for example, a team-specific mirror), you or your team can add a file to the project:

**File:** `<project root>/.jfrog/local/package-resolution.json`

```json
{
  "repositories": {
    "npm": "team-npm-virtual",
    "pypi": "team-pypi-virtual"
  }
}
```

This overrides your org's default repository for the listed package types, for anyone working in that project. Most users won't need this; it's here for teams with special routing needs. It only changes which repository is used; it doesn't turn Agent Package Resolution on by itself, that still happens in `agents-conf.json` (see [Turning it on](#turning-it-on)).
