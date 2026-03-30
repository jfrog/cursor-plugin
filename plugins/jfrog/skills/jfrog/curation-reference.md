# Curation Reference

## Core Concepts

**Curation** is a package firewall that intercepts downloads from remote repositories. Before a package reaches Artifactory, Curation checks it against a pre-indexed catalog of known risks -- without downloading the package first. Non-compliant packages are blocked and never stored.

### How It Works

```
Developer request → Artifactory Remote Repo → Curation Check → Allow/Block → Cache or Reject
```

1. Developer requests a package (e.g., `npm install lodash@4.17.20`)
2. Artifactory routes the request through its remote repository
3. Curation evaluates the package against active policies using its pre-indexed catalog
4. If compliant: package is downloaded, cached, and served
5. If non-compliant: request is blocked, package never enters Artifactory

### Policy Types

| Policy Type | What it blocks |
|-------------|---------------|
| **Malicious Package** | Packages flagged as malicious by JFrog threat research |
| **Critical Vulnerability** | Packages with CVEs above a severity threshold (CVSS) |
| **Viral License** | Packages with GPL, AGPL, or other copyleft licenses |
| **Outdated Package** | Packages past end-of-life or with much newer versions available |
| **Unofficial Docker Image** | Docker images that are not official or verified |

### Waivers

Exceptions for specific packages/versions that bypass curation policies. Used when a blocked package is deemed acceptable after manual security review. Waivers can be scoped to specific repos and have expiration dates.

### Audit Log

Every curation decision is logged with: timestamp, package details, policy that triggered, action taken (allowed/blocked), and requesting user.

## Key API Operations

### Policies

```bash
# Create a curation policy
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "block-malicious-and-critical",
    "enabled": true,
    "conditions": [
      {"type": "malicious_package"},
      {"type": "cvss_score", "min_severity": 9.0}
    ],
    "repositories": ["npm-remote", "pypi-remote"],
    "action": "block"
  }' \
  "$JFROG_URL/curation/api/v1/policies"

# List policies
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/curation/api/v1/policies"

# Update policy
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  "$JFROG_URL/curation/api/v1/policies/{policy_id}"
```

### Audit Log

```bash
# Get curation audit events
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/curation/api/v1/audit?repo=npm-remote&action=blocked&from=2024-01-01&limit=50"
```

### Waivers

```bash
# Create a waiver for a specific package
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "package_name": "lodash",
    "package_version": "4.17.20",
    "package_type": "npm",
    "reason": "Reviewed by security team - vulnerability not exploitable",
    "expiry_date": "2025-06-30"
  }' \
  "$JFROG_URL/curation/api/v1/waivers"

# List waivers
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/curation/api/v1/waivers"
```

### CLI

```bash
# Audit current project against curation policies
jf curation-audit
```

## Air-Gapped Curation

### Partially Air-Gapped

For environments with egress-only connectivity:

```
Air-gapped JPD → DMZ JPD (remote repo) → Curation Service → Public Registry
```

The air-gapped JPD has a remote repo pointing to the DMZ JPD. The DMZ JPD's remote repos go through Curation before fetching from public registries.

### Fully Air-Gapped

For environments with zero network connectivity:

1. Request ticket for needed packages
2. DMZ system fetches packages through Curation
3. Approved packages are physically exported (media/secure transfer)
4. Imported into air-gapped JPD's local repo

## Reference Files

- [api-reference.md](api-reference.md) -- Complete Curation REST API endpoint catalog

# Curation REST API Reference

Base URL: `https://$JFROG_URL/curation/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

## Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/policies` | Create curation policy |
| GET | `/v1/policies` | List policies |
| GET | `/v1/policies/{policyId}` | Get policy |
| PUT | `/v1/policies/{policyId}` | Update policy |
| DELETE | `/v1/policies/{policyId}` | Delete policy |

### Create Policy Body

```json
{
  "name": "block-high-risk",
  "description": "Block malicious and critically vulnerable packages",
  "enabled": true,
  "conditions": [
    {
      "type": "malicious_package"
    },
    {
      "type": "cvss_score",
      "min_severity": 9.0
    },
    {
      "type": "license",
      "banned_licenses": ["GPL-3.0", "AGPL-3.0"]
    }
  ],
  "repositories": ["npm-remote", "pypi-remote", "maven-remote"],
  "package_types": ["npm", "pypi", "maven"],
  "action": "block"
}
```

### Condition Types

| Type | Parameters | Description |
|------|-----------|-------------|
| `malicious_package` | (none) | Block known malicious packages |
| `cvss_score` | `min_severity` (float) | Block by CVSS score threshold |
| `license` | `banned_licenses` (string[]) | Block by license type |
| `package_age` | `max_age_days` (int) | Block packages older than N days |
| `newer_version_available` | `major_versions_behind` (int) | Block if too many major versions behind |
| `unofficial_docker_image` | (none) | Block non-official Docker images |

## Curated Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/curated_repos` | List curated repos |
| PUT | `/v1/curated_repos/{repoKey}` | Enable/configure curation on a repo |
| GET | `/v1/curated_repos/{repoKey}` | Get curation config for repo |

### Enable Curation on a Repo

```json
{
  "repo_key": "npm-remote",
  "enabled": true
}
```

## Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/audit` | Get curation audit events |

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Filter by repository |
| `package_type` | string | Filter by package type (npm, pypi, etc.) |
| `action` | string | `blocked` or `allowed` |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |
| `package_name` | string | Filter by package name |
| `limit` | int | Max results (default 25) |
| `offset` | int | Pagination offset |

### Sample Response

```json
{
  "events": [
    {
      "id": "evt-123",
      "timestamp": "2024-06-15T10:30:00Z",
      "repo_key": "npm-remote",
      "package_name": "malicious-pkg",
      "package_version": "1.0.0",
      "package_type": "npm",
      "action": "blocked",
      "policy_name": "block-high-risk",
      "condition_type": "malicious_package",
      "requesting_user": "developer1"
    }
  ],
  "total_count": 1
}
```

## Waivers

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/waivers` | Create waiver |
| GET | `/v1/waivers` | List waivers |
| GET | `/v1/waivers/{waiverId}` | Get waiver |
| DELETE | `/v1/waivers/{waiverId}` | Delete waiver |

### Create Waiver Body

```json
{
  "package_name": "lodash",
  "package_version": "4.17.20",
  "package_type": "npm",
  "reason": "Security team confirmed: vulnerability not exploitable in our usage",
  "expiry_date": "2025-12-31",
  "scope": {
    "repositories": ["npm-remote"]
  }
}
```

## Package Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/packages/{type}/{name}/{version}/status` | Get curation status of a specific package |

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/system/ping` | Health check |
| GET | `/v1/system/status` | Curation service status |
