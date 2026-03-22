# JFrog CLI -- Platform Commands

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
