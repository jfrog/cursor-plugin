# Contributing to JFrog Cursor Plugin

Thank you for your interest in contributing! This project is maintained by JFrog and licensed under the [Apache License 2.0](LICENSE).

## Contributor License Agreement (CLA)

All contributors must sign the [JFrog CLA](https://jfrog.com/cla/) before contributions can be merged. A CLA check runs automatically on every pull request — follow the prompts to sign if you haven't already.

## How to Contribute

1. **Fork** the repository and create a feature branch from `main`.
2. Make your changes, ensuring they follow the existing code style and project conventions.
3. **Test** your changes locally by running the validation script:

```bash
node scripts/validate-template.mjs
```

4. **Commit** with a clear, descriptive message.
5. Open a **pull request** against `main` with a summary of what changed and why.

## Updating the vendored skills

The `skills/` tree is vendored from [`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) at the version pinned in [`.github/scripts/sync-skills-vendor.json`](.github/scripts/sync-skills-vendor.json). To pull a newer upstream release into this repo:

1. Bump `pin` in `.github/scripts/sync-skills-vendor.json` to the new tag (e.g. `v0.12.0`).
2. Run the sync script from the repo root:

   ```bash
   node .github/scripts/sync-skills.mjs
   ```

   It downloads the pinned tarball from `codeload.github.com`, extracts it, and replaces the directories listed in `paths` (today: `skills/`) under `plugins/jfrog/`.
3. Bump `version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) so users actually receive the update — Cursor skips installs whose resolved version hasn't changed.
4. Commit the pin bump, the regenerated `plugins/jfrog/skills/` tree, and the version bump together, and open a PR.

See [`VENDOR.md`](VENDOR.md) for the full picture.

## Releasing

To cut a release:

1. In your PR, bump `.version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) and sync `.metadata.version` in [`.cursor-plugin/marketplace.json`](.cursor-plugin/marketplace.json) to match. `plugin.json` is canonical; the `validate-version` PR check enforces that the two agree.
2. Merge to `main`. If that version is not tagged yet, the Release workflow publishes it. The
   version comes from the manifest, so the bump stays reviewable in the PR that makes it. There
   is no bot push to `main`.

A `[major]`, `[minor]`, or `[patch]` marker in the commit **subject** (first line) is optional.
This repo squash-merges with the PR title as the subject, so requiring the marker used to skip
the release whenever a title was rewritten — while the job stayed green. The workflow now
publishes whenever `plugin.json` is ahead of the latest tag. A marker (or a manual
`workflow_dispatch`) against a version that is already tagged still fails, rather than
re-tagging a shipped release. A marker further down in the body is ignored on purpose: GitHub
pre-fills the squash body from the branch commits or the PR description, either of which may
quote a marker while only documenting it.

The workflow reads the version from `plugin.json`, confirms `marketplace.json` agrees, skips
when that version is already tagged (or fails if a marker / dispatch asked to re-release it),
runs the same marketplace-template check as the `validate-template` PR workflow, packages the
tracked files at `HEAD` (minus `.github/`) into `release.zip`, and creates the `vX.Y.Z` tag as
part of publishing the GitHub Release.

Two things to know before changing it:

- Validation runs inside the release job. Both `validate-template.yml` and `validate-version.yml` only run on pull requests, so neither one sees the merge commit the release is cut from. Re-running their checks in the release job is what actually gates the release on them. Keep it that way even if either workflow gains a `push` trigger: a separate workflow is still independent of this one, and can be red while a release goes out.
- The tag is created by the release, not before it. `gh release create --target` does both in one API call, so a failed run can't leave a tag behind with no release attached to it.

## Reporting Issues

Open a [GitHub issue](https://github.com/jfrog/cursor-plugin/issues) with:

- A clear title and description of the problem.
- Steps to reproduce (if applicable).
- Expected vs. actual behavior.

## Code Guidelines

- Keep changes focused — one logical change per PR.
- Follow existing patterns and naming conventions in the codebase.
- Do not commit secrets, credentials, or API keys.
- Add copyright headers to new source files:

```
// Copyright (c) JFrog Ltd. 2025
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
```

## Code of Conduct

Be respectful and constructive. We are committed to providing a welcoming and inclusive experience for everyone.

## Questions?

Reach out to the JFrog DevRel team at devrel@jfrog.com.
