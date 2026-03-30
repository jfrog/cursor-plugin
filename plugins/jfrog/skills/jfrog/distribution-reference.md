# Distribution Reference

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

# Distribution & Release Lifecycle REST API Reference

## Release Bundles (Lifecycle API)

Base URL: `https://$JFROG_URL/lifecycle/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/release_bundle` | Create release bundle |
| GET | `/v2/release_bundle/records/{name}/{version}` | Get release bundle details |
| GET | `/v2/release_bundle/records` | List release bundles |
| DELETE | `/v2/release_bundle/records/{name}/{version}` | Delete release bundle version |
| POST | `/v2/release_bundle/records/{name}/{version}/promote` | Promote to environment |
| GET | `/v2/release_bundle/records/{name}/{version}/promotion` | Get promotion status |

### Create Release Bundle (from Build)

```json
{
  "release_bundle_name": "my-release",
  "release_bundle_version": "1.0.0",
  "skip_docker_manifest_resolution": false,
  "source_type": "builds",
  "source": {
    "builds": [
      {"build_name": "my-app", "build_number": "42", "build_repository": "artifactory-build-info"}
    ]
  }
}
```

### Create Release Bundle (from File Specs)

```json
{
  "release_bundle_name": "my-release",
  "release_bundle_version": "2.0.0",
  "source_type": "file_specs",
  "source": {
    "file_specs": [
      {"pattern": "libs-release-local/com/example/app/2.0/*"},
      {"pattern": "docker-prod-local/my-app/2.0/*"}
    ]
  }
}
```

### Create Release Bundle (from existing Release Bundle)

```json
{
  "release_bundle_name": "promoted-release",
  "release_bundle_version": "2.0.0",
  "source_type": "release_bundles",
  "source": {
    "release_bundles": [
      {"release_bundle_name": "my-release", "release_bundle_version": "2.0.0"}
    ]
  }
}
```

### Promote Release Bundle

```json
{
  "environment": "PROD",
  "included_repository_keys": ["libs-release-local", "docker-prod-local"],
  "overwrite_existing_artifacts": false
}
```

## Distribution API

Base URL: `https://$JFROG_URL/distribution/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/distribution/{name}/{version}` | Distribute release bundle |
| GET | `/v1/distribution/{name}/{version}/status` | Get distribution status |
| DELETE | `/v1/distribution/{name}/{version}` | Delete distribution |

### Distribute Release Bundle

```json
{
  "dry_run": false,
  "auto_create_missing_repositories": true,
  "distribution_rules": [
    {
      "site_name": "edge-us-east",
      "city_name": "*",
      "country_codes": ["US"]
    },
    {
      "site_name": "edge-eu-west"
    }
  ]
}
```

## Signing Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/keys/gpg` | List GPG signing keys (Lifecycle API) |
| POST | `/v1/keys/gpg` | Create GPG signing key (Lifecycle API) |
| DELETE | `/v1/keys/gpg/{key_alias}` | Delete signing key (Lifecycle API) |

## Evidence API

Base URL: `https://$JFROG_URL/evidence/api`

Since: 7.129.1. License: Enterprise+.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/evidence/prepare` | Prepare evidence (DSSE format) |
| PUT | `/{deploy_path}` | Deploy evidence (path from prepare response) |

### Prepare Evidence

Query params: `include_pae` (boolean) -- include Pre-Authentication Encoding statement

```json
{
  "subject_repo_path": "docker-local/my-app/1.0/manifest.json",
  "predicate": "{\"actor\":\"ci-bot\",\"result\":\"pass\"}",
  "predicate_type": "https://jfrog.com/evidence/test-result/v1"
}
```

### Evidence CLI Commands

```bash
# Generate key pair
jf evd key-pair create --key-name my-signing-key

# Create evidence (4 subject types)
jf evd create --package-name NAME --package-version VER --package-repo-name REPO ...
jf evd create --subject-repo-path REPO/PATH ...
jf evd create --build-name NAME --build-number NUM ...
jf evd create --release-bundle NAME --release-bundle-version VER ...
```

## Environments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/access/api/v1/projects/{project_key}/environments` | List project environments |
