# Step 4 — picking a project interactively

**This is not optional background reading — it's part of Step 4's
required behavior.** Read this in full before asking for the AI
Governance project. Use the exact `AskUserQuestion`
payload shapes below; do not paraphrase or invent your own wording.

**Everything below — `candidatesWithNames`,
`similarProjects`, and which bullet you land on — is reasoning for you
to follow silently, never to narrate.** The user never sees why a
particular branch was taken, only the resulting prompt (the
`AskUserQuestion` payload or the plain-text fallback line).

`jfrog-detect-project.mjs "<ai-governance-server-id>"` exits:

- **2 (`ask`)** → ask with the picker below.
- **3 (error)** → `jf` missing or credentials unavailable/rejected.
  Show the raw detector error — this is a genuine stop (no re-pick can
  fix bad credentials).

Whenever the detector needs the user to choose — no input was passed,
the typed input didn't match anything (404), or it matched more than
one project (ambiguous) — it emits `candidatesWithNames` (the full
enumerated list, `{key, displayName}`, sorted by key) alongside the
red/ask result, as long as enumeration succeeded. Use it to drive an
`AskUserQuestion` picker instead of asking the user to type a key or
name from memory. A confirmed 404 additionally carries
`similarProjects` — up to 2 "did you mean...?" near-misses of the
typed input (see `scripts/lib/projects.mjs`) — which take priority
over the generic first-two when present:

- **404 with `similarProjects` present** → the typed input was close
  to one or two real projects (e.g. typed `widgets20`, JPD has
  `widgets2`/`widgets`). Call `AskUserQuestion`, naming what was typed and
  offering the suggestions plus "Other":

  ```json
  {
    "questions": [
      {
        "question": "There's no project \"<user-input>\" on <ai-governance-host> — did you mean one of these?",
        "header": "Project",
        "multiSelect": false,
        "options": [
          {"label": "<similarProjects[0].displayName>", "description": "Project key: <similarProjects[0].key>"},
          {"label": "<similarProjects[1].displayName>", "description": "Project key: <similarProjects[1].key>"},
          {"label": "No AI Catalog", "description": "I don't use AI Catalog."}
        ]
      }
    ]
  }
  ```

  If `similarProjects` has only 1 entry, use it as option 1 and fill
  option 2 from the first entry of `candidatesWithNames` that isn't
  already used (`AskUserQuestion` requires 2 options minimum). If no
  such second entry exists (the JPD has exactly this one project), skip
  `AskUserQuestion` entirely and use the plain-text fallback below
  instead. On picking a suggestion → that project's **key** is
  `<ai-governance-project>`. On **Other** → the user types a
  different name-or-key; their typed value is `<ai-governance-project>`.

- **Otherwise, if `candidatesWithNames` has 2 or more entries** — no
  input was passed, the input was ambiguous, or it was a 404 with no
  close-enough `similarProjects` — call `AskUserQuestion` with the
  **first two** entries of `candidatesWithNames` (in the order the
  detector returned them — never reordered, never chosen by matching
  the user's name, git identity, hostname, or any other signal) as the
  two options, and rely on the tool's built-in "Other" for typing a
  different project:

  ```json
  {
    "questions": [
      {
        "question": "Which AI Governance project on <ai-governance-host> do you want to use?",
        "header": "Project",
        "multiSelect": false,
        "options": [
          {"label": "<candidatesWithNames[0].displayName>", "description": "Project key: <candidatesWithNames[0].key>"},
          {"label": "<candidatesWithNames[1].displayName>", "description": "Project key: <candidatesWithNames[1].key>"},
          {"label": "No AI Catalog", "description": "I don't use AI Catalog."}
        ]
      }
    ]
  }
  ```

  On picking option 1 or 2 → that project's **key** is
  `<ai-governance-project>`. On **No AI Catalog** (here or in the
  picker above) → `<ai-governance-project>` is empty. On **Other** →
  the user types a name-or-key; their typed value is
  `<ai-governance-project>`.

- **If `candidatesWithNames` has fewer than 2 entries** (enumeration
  unavailable, or the JPD genuinely has 0–1 projects) → fall back to a
  single plain-text line, no `AskUserQuestion`:

  > *Which AI Governance project on `<ai-governance-host>` do you want
  > to use? If you don't use AI Catalog, say so.*

  Nothing before, nothing after. If the user says they don't use AI
  Catalog, `<ai-governance-project>` is empty. Do NOT append any hint about the
  accepted input format (no *"(name or key)"*, no *"you can type a key
  or name"*, no *"either the display name or key works"*).

- **If `AskUserQuestion` is not available as a tool at all** (some
  harnesses don't expose it — check `$JFROG_INIT_HARNESS`, or before Step 5
  whether you are Kiro or Junie: `kiro` /
  `kiro-cli` / `junie` never have it, so skip the tool call and go straight
  to the fallback instead of calling it and surfacing its error), use the
  plain-text fallback line above —
  nothing else — regardless of
  how many entries `candidatesWithNames` has. Never explain that the
  tool is unavailable, never mention the candidate count or that a
  picker would otherwise have been used; the user only ever sees the
  one line.
- **Never surface the full candidate list or a count** to the user in
  any case — the picker's options (plus "Other") or the plain-text
  fallback are the entire user-facing surface.

**Do NOT** `export JF_PROJECT=…`. Step 4 saves the project.
