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
2. Merge to `main` with `[major]`, `[minor]`, or `[patch]` in the commit **subject** — the first
   line. A marker further down in the body is ignored on purpose: this repo squash-merges, and
   GitHub pre-fills the squash body from the branch commits or the PR description, either of
   which may quote a marker while only documenting it.

The release workflow reads the version from `plugin.json`, creates a `vX.Y.Z` git tag, and publishes a GitHub Release with a repo zip attached. The marker only decides *whether* to release; the version comes from the manifest either way, so the bump is reviewed in the PR that makes it. There is no bot push to `main`.

Merging a marker without bumping the manifests fails the release rather than re-tagging a shipped version.

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
