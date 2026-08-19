# Agent Package Resolution — bind unbound package types

The JFrog **Agent Package Resolution** hooks are installed. A package type in
this chat may still lack a `defaultGlobalRepos` binding.

## When to ask

Only when the user/agent is about to do **package-resolution work** for a
concrete APR type from ({{SUPPORTED_TYPES}}) — e.g. `npm install`, `pip install`,
Maven/Gradle deps, `go get`, Docker/Helm/NuGet — **and** that type is not in
`defaultGlobalRepos` **and** not already declined.

Do **not** ask on unrelated chats. Do **not** re-ask a declined or bound type.

## What to do (at most once per conversation per type, after intent)

1. Silently map intent → APR type **T** (npm→`npm`, pip/uv→`pypi`). Skip bound
   or declined types. Do **not** tell the user you are checking bindings,
   decline cache, status, or whether to ask.

2. Your **first** (and only) visible output this turn must be the Yes/No ask —
   no plan, status check, or “I'll check…” line. Pitch (paraphrase OK):

   > Agent Package Resolution can route **T** installs through your Artifactory
   > **virtual** repositories instead of public registries. Want to set that up
   > for **T** now? Details:
   > {{ADMIN_GUIDE_URL}}

   Choices:

   - **Yes** — Consent Enable for **T** (and any other types they choose)
   - **No** — do not ask again for **T** (other types may still be offered later)

   Do **not** open with “I’m ready to help…”, summaries, git status,
   “I'll check…”, binding/decline/status narration, or other preamble. Do **not**
   run `configure.mjs status` before asking.

   Emit **one** Yes/No block — that pitch plus the two bullets. Do **not** add a
   second recap or a structured question / options picker.

   **Stop and wait.** End the turn right after the ask. Do **not** continue the
   original task, run commands, or report findings in the same message.

3. **No** → acknowledge once, then:

```bash
node "{{CONFIGURE_COMMAND}}" dismiss --type <T>
```

   Use the APR type (e.g. `pypi`, `npm`). Bare `dismiss` only if they want to
   silence **all** future APR offers.

4. Neither Yes nor No → continue the task; do **not** dismiss; do **not** re-ask
   **T** in this conversation.

5. **Yes** → run `onboarding-procedure` exactly (prefer starting from **T**).
   Do **not** ask those questions yourself first:

```bash
node "{{CONFIGURE_COMMAND}}" onboarding-procedure
```

## Hard rules

- Once per conversation per type; only for unbound, undeclined install intent.
- Ask is **first and last** in that turn — no narration about checking bindings
  or whether to offer APR. One pitch, not a recap after it.
- Never invent repo keys or run `jf setup` without Consent Enable + verify-repo.
- Use `onboarding-procedure` on Yes; do not expand this rule into a tutorial.
