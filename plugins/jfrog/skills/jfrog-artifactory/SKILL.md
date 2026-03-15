---
name: JFrog Artifactory
description: Use when working with JFrog Artifactory -- managing repositories, deploying/downloading artifacts, querying with AQL, configuring builds, replication, or federation. Triggers on mentions of artifactory, repository, artifact, deploy, docker registry, build info, AQL, replication, or federation.
---

# JFrog Artifactory Skill

## Authentication

All Artifactory REST API calls require authentication via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/artifactory/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

## Core Concepts

### Repository Types

| Type | Purpose | Example |
|------|---------|---------|
| **Local** | Store your own artifacts (1st-party binaries, builds) | `libs-release-local` |
| **Remote** | Cache/proxy external registries (npm, Maven Central, Docker Hub) | `npm-remote` |
| **Virtual** | Single URL that routes to multiple local & remote repos with priority order | `npm` |
| **Federated** | Bi-directional mirror across JFrog Platform Deployments (JPDs) | `shared-docker-federated` |

### Build Info

Structured metadata collected by JFrog CLI during CI. Contains: build name/number, artifacts produced, dependencies consumed, environment variables, VCS info. Published with `jf rt build-publish`. Enables: Xray scanning of builds, promotion, release bundle creation.

### Package Types

Artifactory supports 40+ package types. See [package-types-reference.md](package-types-reference.md) for repo config per type.

## Key API Operations

### Repository Management

```bash
# List all repos
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/repositories"

# Create a local repo
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"my-docker-local","rclass":"local","packageType":"docker"}' \
  "$JFROG_URL/artifactory/api/repositories/my-docker-local"

# Create a remote repo (proxy Docker Hub)
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"docker-remote","rclass":"remote","packageType":"docker","url":"https://registry-1.docker.io/"}' \
  "$JFROG_URL/artifactory/api/repositories/docker-remote"

# Create a virtual repo
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"docker","rclass":"virtual","packageType":"docker","repositories":["my-docker-local","docker-remote"],"defaultDeploymentRepo":"my-docker-local"}' \
  "$JFROG_URL/artifactory/api/repositories/docker"
```

### Artifact Operations

```bash
# Deploy (upload) an artifact
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -T ./myapp-1.0.jar \
  "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Download an artifact
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -O "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Get file info
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Set properties on an artifact
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar?properties=build.name=myapp;build.number=42"

# Delete an artifact
curl -X DELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"
```

### Search

```bash
# Quick search by name
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/artifact?name=myapp&repos=libs-release-local"

# GAVC search (Maven coordinates)
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/gavc?g=com.example&a=myapp&v=1.0"

# Property search
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/prop?build.name=myapp&repos=libs-release-local"
```

For complex queries use **AQL** -- see [aql-reference.md](aql-reference.md).

### Build Info

```bash
# Get build info
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/build/myapp/42"

# Delete build
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"buildName":"myapp","buildNumbers":["42"],"deleteAll":false}' \
  "$JFROG_URL/artifactory/api/build/delete"

# Promote build (move artifacts between repos)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"released","targetRepo":"libs-release-local","copy":false}' \
  "$JFROG_URL/artifactory/api/build/promote/myapp/42"
```

### System

```bash
# System health check
curl "$JFROG_URL/artifactory/api/system/ping"

# Get version
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/system/version"

# Storage summary
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/storageinfo"
```

## Repository Creation Workflow

Repository creation is **additive and irreversible** -- repos cannot be deleted via the API without admin intervention.

1. **List existing repos** to avoid name conflicts
2. **Gather requirements**: repo name, package type, repo type (local/remote/virtual/federated), Xray indexing
3. **For virtual repos**: validate that the `defaultDeploymentRepo` is already in the `repositories` list. This constraint is NOT enforced by the API schema -- always validate before creation.
4. **Present the full configuration** to the user
5. **Wait for explicit confirmation** before creating

## Parallelization

When creating multiple repositories (e.g., per-environment or per-team), run the creation calls in parallel using concurrent subagents or background shell jobs. Repository creation calls are independent and do not depend on each other. The same applies to batch artifact uploads and property-setting operations.

## Replication

- **Push replication**: pushes artifacts from local repo to another Artifactory instance
- **Pull replication**: pulls artifacts from a remote Artifactory into a local repo
- **Event-based replication**: triggers on artifact deploy/delete (real-time sync)
- **Cron-based replication**: scheduled sync

```bash
# Create push replication (use token or credentials for the target server)
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<TARGET_JFROG_URL>/artifactory/libs-release-local","username":"$TARGET_USER","password":"$TARGET_TOKEN","enabled":true,"cronExp":"0 0 * * * ?","enableEventReplication":true}' \
  "$JFROG_URL/artifactory/api/replications/libs-release-local"
```

## Federation

Federated repositories are mirrored across multiple JPDs with full bi-directional sync. All members are equal peers.

```bash
# Convert local repo to federated
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/artifactory/api/federation/migrate/libs-release-local"
```

## Reference Files

- [rest-api-reference.md](rest-api-reference.md) -- Complete REST API endpoint catalog
- [aql-reference.md](aql-reference.md) -- Artifactory Query Language syntax and examples
- [package-types-reference.md](package-types-reference.md) -- Repository configuration per package type

## Related Patterns

- `repositories-basic-repository-setup` -- Single-endpoint repo setup
- `repositories-dependency-resolution-from-multiple-upstream-sources` -- Virtual repo with prioritized remotes
- `repositories-setup-for-cross-team-collaboration` -- Multi-team shared virtual repos
- `builds-ci-integration` -- CI pipeline with Build Info

> After completing an action, check the **Artifactory Actions** section of `skills/jfrog-patterns/flow-suggestions.md` for flow context and offer the next step.

## Documentation

- [Artifactory REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/artifactory-rest-apis)
- [Repository Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/repository-management)
- [Federated Repositories](https://jfrog.com/help/r/jfrog-artifactory-documentation/federated-repositories)
- [Build Integration](https://jfrog.com/help/r/jfrog-integrations-documentation/build-integration)
