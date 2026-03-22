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
