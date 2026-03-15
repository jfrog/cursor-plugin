---
name: JFrog Distribution
description: Use when working with JFrog Distribution and Release Lifecycle Management -- creating release bundles, promoting through environments, distributing to edge nodes, or managing evidence. Triggers on mentions of distribution, release bundle, promote, environment, edge node, release lifecycle, or evidence.
---

# JFrog Distribution Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URLs:
- Release Lifecycle: `https://$JFROG_URL/lifecycle/api/...`
- Distribution: `https://$JFROG_URL/distribution/api/...`
- Evidence: `https://$JFROG_URL/evidence/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

> **Pre-flight:** Before operations, verify the Lifecycle service is available: `GET $JFROG_URL/lifecycle/api/v2/promotion/records?limit=1` (expect HTTP 200). If unavailable, inform the user that Release Lifecycle Management is not deployed on this instance and stop.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Release Bundle v2** | Immutable, GPG-signed, versioned collection of artifacts representing a release candidate |
| **Environment** | SDLC stage (DEV, STAGING, PROD) for organizing the promotion pipeline |
| **Promotion** | Moving a Release Bundle from one environment to the next (with optional security gate checks) |
| **Distribution** | Delivering Release Bundle content to remote Edge nodes |
| **Edge Node** | Remote Artifactory instance that receives distributed content |
| **Evidence** | Signed attestation (DSSE format) attached to artifacts, builds, or release bundles for auditing |

## Release Lifecycle Workflow

```
Build artifacts → Create Release Bundle → Promote DEV → STAGING → PROD → Distribute to Edge
```

### Create Release Bundle

```bash
# From build info
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "release_bundle_name": "my-app-release",
    "release_bundle_version": "1.0.0",
    "skip_docker_manifest_resolution": false,
    "source_type": "builds",
    "source": {
      "builds": [{"build_name": "my-app", "build_number": "42"}]
    }
  }' \
  "$JFROG_URL/lifecycle/api/v2/release_bundle"

# From file specs (artifacts)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "release_bundle_name": "my-release",
    "release_bundle_version": "2.0.0",
    "source_type": "file_specs",
    "source": {
      "file_specs": [
        {"pattern": "libs-release-local/com/example/app/2.0/*"}
      ]
    }
  }' \
  "$JFROG_URL/lifecycle/api/v2/release_bundle"
```

### Promote Release Bundle

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "STAGING",
    "included_repository_keys": ["libs-release-local"],
    "overwrite_existing_artifacts": false
  }' \
  "$JFROG_URL/lifecycle/api/v2/release_bundle/records/my-app-release/1.0.0/promote"
```

### Distribute Release Bundle

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "auto_create_missing_repositories": true,
    "distribution_rules": [
      {"site_name": "edge-us-east"},
      {"site_name": "edge-eu-west"}
    ]
  }' \
  "$JFROG_URL/distribution/api/v1/distribution/my-app-release/1.0.0"
```

### Get Release Bundle Status

```bash
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/lifecycle/api/v2/release_bundle/records/my-app-release/1.0.0"
```

## Evidence Service

Evidence provides signed attestation metadata for artifacts, builds, and release bundles. Uses the DSSE (Dead Simple Signing Envelope) standard.

### CLI Approach (Recommended)

```bash
# Attach evidence to a package
echo '{"actor":"ci-bot","date":"2024-01-15T10:00:00Z"}' > predicate.json
jf evd create \
  --package-name my-app --package-version 1.0 --package-repo-name docker-local \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/signature/v1

# Attach evidence to an artifact
jf evd create \
  --subject-repo-path generic-local/readme/1.0/README.md \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/signature/v1

# Attach evidence to a build
jf evd create \
  --build-name my-app --build-number 42 \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/build-signature/v1

# Attach evidence to a release bundle
jf evd create \
  --release-bundle my-app-release --release-bundle-version 1.0.0 \
  --key "$PRIVATE_KEY" \
  --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/rbv2-signature/v1
```

### REST API Approach

Two-step workflow (alternative to CLI when integrating third-party tools):

1. **Prepare Evidence**: `POST /evidence/api/v1/evidence/prepare` -- creates DSSE payload
2. **Deploy Evidence**: deploys the signed envelope to Artifactory

Since 7.129.1. Requires Enterprise+ license. Docs: https://jfrog.com/help/r/jfrog-artifactory-documentation/create-evidence-using-rest-apis

## Reference Files

- [api-reference.md](api-reference.md) -- Complete REST API endpoint catalog

## Related Patterns

- `release-lifecycle-management-without-security-gates` [SIMPLE]
- `release-lifecycle-with-security-gates` [INTERMEDIATE]
- `release-lifecycle-management-with-build-integration-security-gates-and-distribution` [ADVANCED]
- `release-lifecycle-with-evidence` [ADVANCED]

> After completing an action, check the **Release Lifecycle Actions** and **Distribution Actions** sections of `skills/jfrog-patterns/flow-suggestions.md` for flow context and offer the next step.

## Documentation

- [Release Lifecycle Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/release-lifecycle-management)
- [Distribution REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/distribution-rest-apis)
- [Evidence Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/evidence-management)
- [Evidence REST API](https://jfrog.com/help/r/jfrog-rest-apis/prepare-evidence)
- [Evidence Examples](https://github.com/jfrog/Evidence-Examples)
