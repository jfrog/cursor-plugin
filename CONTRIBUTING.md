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

4. Bump the version in **both** manifests — `.version` in [`plugins/jfrog/.cursor-plugin/plugin.json`](plugins/jfrog/.cursor-plugin/plugin.json) and `.metadata.version` in [`.cursor-plugin/marketplace.json`](.cursor-plugin/marketplace.json), kept identical.
5. **Commit** with a clear, descriptive message.
6. Open a **pull request** against `main` with a summary of what changed and why.

Step 4 applies to every pull request, including documentation-only and CI-only ones. Each merge to `main` cuts a release from the manifest version, so a merge that doesn't bump it fails the Release workflow with "already released". That is deliberate: the alternative is silently skipping releases or re-tagging a version that already shipped. See [Releasing](#releasing) for the details.

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
2. Merge to `main`. Every push to `main` compares the manifest version against the latest release tag: if the version is newer, a release proceeds; if it matches the latest tag, the workflow fails with a clear "already released" error; if it is older, it fails with a revert warning.

The bump is reviewed in the PR that makes it, and it is required of every PR — docs-only and CI-only changes included. Merging without bumping the manifests fails the release rather than silently skipping or re-tagging a shipped version.

The workflow reads the version from `plugin.json`, confirms `marketplace.json` agrees, runs the same marketplace-template and skill-governance checks as the `validate-template` and `validate-skill-governance` PR workflows, packages the tracked files at `HEAD` (minus `.github/`) into `release.zip`, and creates the `vX.Y.Z` tag as part of publishing the GitHub Release.

Three things to know before changing it:

- Validation runs inside the release job. `validate-template.yml`, `validate-skill-governance.yml`, and `validate-version.yml` all run on pull requests only, so none of them sees the merge commit the release is cut from. Re-running their checks in the release job is what actually gates the release on them. Keep it that way even if one gains a `push` trigger: a separate workflow is still independent of this one, and can be red while a release goes out.
- The tag is created by the release, not before it. `gh release create --target` does both in one API call, so a failed run can't leave a tag behind with no release attached to it.
- Asset upload happens after the release and tag are published, so a failure there would leave a `vX.Y.Z` that every later run rejects as already released. A cleanup step deletes that incomplete release and its tag, gated on the version check having passed so it can never delete an earlier, healthy release.

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
