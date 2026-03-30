# CLI Reference

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

| Group | Prefix | Description |
|-------|--------|-------------|
| Artifactory | `jf rt` | Artifact operations, repos, builds |
| Security | `jf audit`, `jf scan` | Vulnerability scanning, SBOM |
| Platform | `jf ds`, `jf worker`, `jf evd` | Distribution, workers, evidence |

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

---

# Artifactory Commands

## Upload & Download

```bash
# Upload files
jf rt upload "build/*.jar" libs-release-local/com/example/app/1.0/ \
  --flat=false --recursive --threads=5

# Upload with file spec
jf rt upload --spec=upload-spec.json

# Upload with properties
jf rt upload "*.jar" libs-release-local/ --props="build.name=myapp;build.number=42"

# Download files
jf rt download "libs-release-local/com/example/**/*.jar" ./local/ \
  --flat=false --threads=5

# Download with file spec
jf rt download --spec=download-spec.json

# Download latest by property
jf rt download "libs-release-local/com/example/app/*" --props="release=latest" --sort-by=created --sort-order=desc --limit=1
```

## Search & Delete

```bash
# Search artifacts
jf rt search "libs-release-local/com/example/**/*.jar"

# Search with properties
jf rt search "libs-release-local/**" --props="build.name=myapp"

# Delete artifacts
jf rt delete "libs-release-local/com/example/app/1.0-SNAPSHOT/"

# Delete with confirmation prompt
jf rt delete "libs-release-local/old/**" --quiet=false
```

## Properties

```bash
# Set properties
jf rt set-props "libs-release-local/app.jar" "release.status=approved;qa.signed=true"

# Delete properties
jf rt delete-props "libs-release-local/app.jar" "release.status"
```

## Copy & Move

```bash
# Copy between repos
jf rt copy "libs-snapshot-local/app/(*)" "libs-release-local/app/{1}" --flat=false

# Move between repos
jf rt move "libs-snapshot-local/app/(*)" "libs-release-local/app/{1}"
```

## Repository Management

```bash
# Create repository (from template)
jf rt repo-create template.json

# Delete repository
jf rt repo-delete my-repo

# Generate repo template interactively
jf rt repo-template template.json
```

## Build Integration

```bash
# Collect environment variables
jf rt build-collect-env my-build 42

# Add Git info to build
jf rt build-add-git my-build 42

# Add dependencies manually
jf rt build-add-dependencies my-build 42 "libs-release-local/deps/**"

# Publish build info
jf rt build-publish my-build 42

# Promote build
jf rt build-promote my-build 42 libs-release-local --status=released

# Scan build (Xray)
jf rt build-scan my-build 42

# Discard old builds
jf rt build-discard my-build --max-builds=10

# Build Docker and collect info
jf rt build-docker-create docker-local --image-file=build-metadata \
  --build-name=my-build --build-number=42
```

## Package Manager Commands

### Maven

```bash
jf mvnc                          # Configure Maven for Artifactory
jf mvn clean install             # Run Maven with Artifactory integration
jf mvn deploy -Drevision=1.0     # Deploy Maven artifacts
```

### Gradle

```bash
jf gradlec                       # Configure Gradle
jf gradle clean build            # Run Gradle build
jf gradle artifactoryPublish     # Publish to Artifactory
```

### npm

```bash
jf npmc                          # Configure npm
jf npm install                   # Install with Artifactory
jf npm publish                   # Publish package
jf npm ci                        # Clean install
```

### Python (pip/pipenv)

```bash
jf pipc                          # Configure pip
jf pip install -r requirements.txt
jf pipenv install
```

### Go

```bash
jf goc                           # Configure Go
jf go build                      # Build with Artifactory
jf go-publish v1.0.0             # Publish Go module
```

### Docker

```bash
# Pull image through Artifactory
jf docker pull myregistry.jfrog.io/docker-virtual/nginx:latest

# Build and push
jf docker push myregistry.jfrog.io/docker-local/myapp:1.0

# Tag for Artifactory
jf docker tag myapp:latest myregistry.jfrog.io/docker-local/myapp:1.0
```

### NuGet / .NET

```bash
jf nugetc                        # Configure NuGet
jf nuget restore                 # Restore packages
jf dotnet restore                # .NET restore
```

### Terraform

```bash
jf terraform-config              # Configure Terraform registry
jf terraform publish --namespace=myorg --provider=aws --tag=v1.0
```

## Replication

```bash
# Transfer files between Artifactory instances
jf rt transfer-files source-server target-server \
  --include-repos="libs-release-local;docker-local"
```

## Curl Wrapper

```bash
# Direct API calls through jf (handles auth automatically)
jf rt curl -XGET /api/system/ping
jf rt curl -XPOST /api/search/aql -d 'items.find({"repo":"my-repo"})'
```

---

# Security Commands

## Project Audit

Scans project dependencies for vulnerabilities, license compliance, and operational risks.

```bash
# Basic audit (scans current project)
jf audit

# Audit with watches (applies your Xray policies)
jf audit --watches=prod-watch

# Audit specific project type
jf audit --mvn      # Maven project
jf audit --npm      # npm project
jf audit --pip      # Python project
jf audit --go       # Go project
jf audit --gradle   # Gradle project
jf audit --nuget    # .NET project

# Audit with minimum severity filter
jf audit --min-severity=High

# Audit with fail on specific severity (for CI gates)
jf audit --fail=true
```

### Advanced Security (JAS) Flags

```bash
# Enable all JAS features
jf audit --watches=prod-watch

# SAST scanning
jf audit --sast

# Secrets detection
jf audit --secrets

# Infrastructure as Code scanning
jf audit --iac

# Combine multiple
jf audit --sast --secrets --iac
```

## Binary Scanning

Scan individual files or Docker images without a project context.

```bash
# Scan a JAR/WAR file
jf scan ./myapp-1.0.jar

# Scan with minimum severity
jf scan ./myapp.jar --min-severity=High

# Scan a directory of artifacts
jf scan ./build/output/

# Scan with watches (apply policies)
jf scan ./myapp.jar --watches=prod-watch
```

## Docker Scanning

```bash
# Scan a Docker image
jf docker scan myapp:latest

# Scan with severity filter
jf docker scan myapp:1.0 --min-severity=Critical

# Scan with watches
jf docker scan myapp:1.0 --watches=docker-watch
```

## Build Scanning

```bash
# Scan a published build
jf rt build-scan my-build 42

# Scan build with fail option (for CI)
jf rt build-scan my-build 42 --fail=true
```

## Curation Audit

Check if your project's dependencies comply with Curation policies.

```bash
# Audit against curation policies
jf curation-audit

# Curation audit for specific package manager
jf curation-audit --npm
jf curation-audit --pip
jf curation-audit --mvn
```

## SBOM Export

```bash
# Generate SBOM for a build
jf sbom --build-name=my-build --build-number=42 --format=cyclonedx

# SBOM for Docker image
jf sbom --image=myapp:1.0 --format=spdx
```

## Output Formats

```bash
# JSON output (for CI/CD integration)
jf audit --format=json

# Table output (default, human-readable)
jf audit --format=table

# Simple text output
jf audit --format=simple-json
```

## Xray REST API (`jf xr curl`)

Invoke Xray REST endpoints using the active server from `jf config`. Pass **only the API path** (e.g. `/api/v1/system/ping`): no `https://` URL, and no `/xray/api` prefix (the CLI already routes to Xray). Wrong shapes include a full URL (the CLI rejects them) or paths like `/xray/api/v1/...` (often 404).

```bash
# Health check
jf xr curl -s -X GET "/api/v1/system/ping"

# Example POST (component security summary)
jf xr curl -s -X POST "/api/v1/summary/component" \
  -H "Content-Type: application/json" \
  -d '{"component_details": [{"component_id": "npm://lodash:4.17.20"}]}'
```

Endpoint paths are cataloged in [security-reference.md](security-reference.md) (table paths such as `/v1/...` map to `/api/v1/...` for `jf xr curl`).

## CI/CD Integration Pattern

```bash
# Typical CI pipeline security gate
jf audit --fail=true --min-severity=High
if [ $? -ne 0 ]; then
  echo "Security violations found. Build blocked."
  exit 1
fi
```

---

# Platform Commands

## Configuration

```bash
# Add server config
jf config add my-server --url=https://myco.jfrog.io --access-token=$JFROG_ACCESS_TOKEN --interactive=false

# Use a specific server
jf config use my-server

# Show all configs
jf config show

# Remove config
jf config remove my-server

# Export config (for sharing/CI)
jf config export my-server

# Import config
jf config import <exported-token>
```

## Release Bundles

```bash
# Create release bundle from build
jf release-bundle-create my-bundle 1.0 \
  --builds="my-build/42" \
  --signing-key=my-gpg-key \
  --sync=true

# Create from file spec
jf release-bundle-create my-bundle 1.0 \
  --spec=bundle-spec.json \
  --signing-key=my-gpg-key

# Promote release bundle to environment
jf release-bundle-promote my-bundle 1.0 \
  --environment=STAGING

jf release-bundle-promote my-bundle 1.0 \
  --environment=PROD

# Distribute release bundle to edge nodes
jf release-bundle-distribute my-bundle 1.0 \
  --site="edge-*" \
  --sync=true

# Delete release bundle
jf release-bundle-delete my-bundle 1.0

# Get release bundle status
jf release-bundle-status my-bundle 1.0
```

### Bundle Spec File (bundle-spec.json)

```json
{
  "files": [
    {"build": "my-build/42"},
    {"pattern": "libs-release-local/com/example/app/1.0/*"}
  ]
}
```

## Evidence

```bash
# Create a signing key pair
jf evd key-pair create --key-name my-evidence-key

# Attach evidence to a package
echo '{"actor":"ci-bot","date":"2024-01-15T10:00:00Z","result":"pass"}' > predicate.json

jf evd create \
  --package-name my-app \
  --package-version 1.0 \
  --package-repo-name docker-local \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/signature/v1

# Attach evidence to a generic artifact
jf evd create \
  --subject-repo-path generic-local/readme/1.0/README.md \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/signature/v1

# Attach evidence to a build
jf evd create \
  --build-name my-build --build-number 42 \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/build-signature/v1

# Attach evidence to a release bundle
jf evd create \
  --release-bundle my-bundle --release-bundle-version 1.0 \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/rbv2-signature/v1
```

### Common Predicate Types

| Type URI | Use Case |
|----------|----------|
| `https://jfrog.com/evidence/signature/v1` | General signing attestation |
| `https://jfrog.com/evidence/build-signature/v1` | Build integrity attestation |
| `https://jfrog.com/evidence/rbv2-signature/v1` | Release bundle attestation |
| `https://jfrog.com/evidence/test-result/v1` | Test execution attestation |

## Workers

```bash
# Initialize a new worker
jf worker init my-worker --event BEFORE_DOWNLOAD

# Test worker
jf worker test my-worker

# Deploy worker
jf worker deploy my-worker

# List workers
jf worker list

# Undeploy worker
jf worker undeploy my-worker
```

## Transfer (Migration)

```bash
# Transfer files between Artifactory instances
jf rt transfer-files source-server target-server \
  --include-repos="libs-release-local;docker-local" \
  --threads=8

# Transfer with file filter
jf rt transfer-files source target \
  --include-repos="*-local" \
  --exclude-repos="temp-*"
```

## Access Token Management

```bash
# Create access token
jf rt access-token-create --groups=readers --expiry=3600

# Revoke access token
jf rt access-token-revoke <token-id>
```

## Mission Control (Multi-JPD)

```bash
# Add JPD
jf mc add my-jpd --url=https://jpd1.jfrog.io --access-token=$JFROG_ACCESS_TOKEN

# List JPDs
jf mc list

# License management
jf mc license deploy --license-key=$KEY
```

## General Flags

| Flag | Description |
|------|-------------|
| `--server-id` | Use specific server config |
| `--project` | Scope to project key |
| `--quiet` | Suppress prompts |
| `--dry-run` | Preview without executing |
| `--threads` | Number of concurrent operations |
| `--retries` | Number of retry attempts |
| `--detailed-summary` | Print detailed operation summary |
