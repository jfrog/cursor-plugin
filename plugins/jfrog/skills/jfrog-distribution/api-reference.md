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
