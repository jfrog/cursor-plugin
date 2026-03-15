---
name: JFrog CLI
description: Use when working with the JFrog CLI (jf command) -- uploading/downloading artifacts, running security scans, managing builds, creating release bundles, or configuring the JFrog Platform from the command line. Triggers on mentions of jf command, jfrog cli, jf rt, jf audit, jf scan, jf docker, file spec, or jf config.
---

# JFrog CLI Skill

## Installation

```bash
# macOS
brew install jfrog-cli

# Linux (curl) — runs remote script; for production prefer package manager or verify script integrity
curl -fL https://install-cli.jfrog.io | sh

# Docker
docker run releases-docker.jfrog.io/jfrog/jfrog-cli jf --version
```

Requires JFrog CLI v2+ (all commands use `jf` prefix).

## Authentication

Follow [login-flow.md](login-flow.md) to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The flow supports multiple environments and persists credentials via `jf config` (encrypted at rest):

1. **Ensure `jf` is installed** -- checks for the CLI and installs it if missing.
2. **Check saved credentials** -- runs `jf config show` to list configured servers. If multiple are saved, asks the user which environment to use.
3. **Agent-driven web login** -- if no credentials exist, asks the user for their JFrog URL, drives the REST-based login flow (user clicks a link, authenticates in browser), and saves the resulting token via `jf config add`.

After login, credentials are saved with a server ID derived from the hostname (e.g. `mycompany` from `mycompany.jfrog.io`) so the user can switch between environments with `jf config use <server-id>`.

## Configuration

```bash
# List configurations
jf config show

# Set default server (if multiple configured)
jf config use my-server

# Add server configuration (non-interactive, using env vars)
jf config add my-server \
  --url=https://$JFROG_URL \
  --access-token=$JFROG_ACCESS_TOKEN \
  --interactive=false

# Export/import config (for CI). Never commit the export file; add it to .gitignore.
jf config export my-server > jf-config.export
jf config import jf-config.export
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `JFROG_URL` | JFrog instance hostname (no `https://`). Used across all JFrog skills |
| `JFROG_ACCESS_TOKEN` | Access token. Used across all JFrog skills and for direct REST API calls |
| `JF_URL` | JFrog Platform URL (CLI-native alternative to `JFROG_URL`) |
| `JF_ACCESS_TOKEN` | Access token (CLI-native alternative to `JFROG_ACCESS_TOKEN`) |
| `JF_USER` / `JF_PASSWORD` | Basic auth credentials |
| `JFROG_CLI_BUILD_NAME` | Default build name |
| `JFROG_CLI_BUILD_NUMBER` | Default build number |
| `JFROG_CLI_BUILD_PROJECT` | Default project key |

## File Specs

JSON format for specifying upload/download/search patterns:

```json
{
  "files": [
    {
      "pattern": "libs-release-local/com/example/(*)/(*).jar",
      "target": "downloads/{1}/{2}.jar",
      "flat": false,
      "recursive": true,
      "regexp": false
    }
  ]
}
```

Use with: `jf rt upload --spec=filespec.json`, `jf rt download --spec=filespec.json`

## Command Groups Overview

| Group | Prefix | Description | Reference |
|-------|--------|-------------|-----------|
| Artifactory | `jf rt` | Artifact operations, repos, builds | [artifactory-commands.md](artifactory-commands.md) |
| Security | `jf audit`, `jf scan` | Vulnerability scanning, SBOM | [security-commands.md](security-commands.md) |
| Platform | `jf ds`, `jf worker`, `jf evd` | Distribution, workers, evidence | [platform-commands.md](platform-commands.md) |

## Most Common Commands

```bash
# Upload artifacts
jf rt upload "build/*.jar" libs-release-local/com/example/app/1.0/

# Download artifacts
jf rt download "libs-release-local/com/example/app/1.0/*.jar" ./local/

# Search artifacts
jf rt search "libs-release-local/com/example/**/*.jar"

# Build integration
jf rt build-add-git my-build 1
jf mvn install --build-name=my-build --build-number=1
jf rt build-publish my-build 1

# Security scanning
jf audit                    # Scan project dependencies
jf scan ./myapp.jar         # Scan a binary
jf docker scan myapp:1.0    # Scan Docker image

# Release bundles
jf release-bundle-create my-bundle 1.0 --builds="my-build/1" --signing-key=mykey
jf release-bundle-promote my-bundle 1.0 --environment=PROD
jf release-bundle-distribute my-bundle 1.0 --site="edge-*"

# Evidence
jf evd create --build-name=my-build --build-number=1 \
  --predicate=./sign.json --predicate-type=https://jfrog.com/evidence/signature/v1 \
  --key="$PRIVATE_KEY"
```

## Parallelization

When building and pushing multiple Docker images, run the builds concurrently using parallel subagents or background processes. Docker builds are independent of each other and are typically the most time-consuming step in onboarding workflows. Each `docker build` + `jf docker push` pair can run in its own subagent. Publish build info (`jf rt build-publish`) only after all image pushes for that build are complete.

## Reference Files

- [artifactory-commands.md](artifactory-commands.md) -- All `jf rt` and package manager commands
- [security-commands.md](security-commands.md) -- All scanning and audit commands
- [platform-commands.md](platform-commands.md) -- Distribution, workers, evidence, config commands

## Official Documentation

- [JFrog CLI Documentation](https://jfrog.com/help/r/jfrog-cli)
- [CLI for Artifactory](https://jfrog.com/help/r/jfrog-cli/cli-for-jfrog-artifactory)
- [CLI for Security](https://jfrog.com/help/r/jfrog-cli/cli-for-jfrog-security)
