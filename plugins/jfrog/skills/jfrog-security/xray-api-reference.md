# Xray REST API Reference

Base URL: `https://$JFROG_URL/xray/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/system/ping` | Health check |
| GET | `/v1/system/version` | Xray version |
| PUT | `/v1/configuration` | Update Xray configuration |
| GET | `/v1/configuration/dbsync/time` | Get DB sync update time |

## Components

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/component/details` | Get component details (vulnerabilities, licenses) |
| GET | `/v1/component/exportDetails` | Export component details |
| POST | `/v1/dependencyGraph/artifact` | Get artifact dependency graph |
| POST | `/v1/dependencyGraph/build` | Get build dependency graph |

### Component Details Request

```json
{
  "component_details": [
    {"component_id": "npm://lodash:4.17.20"},
    {"component_id": "docker://library/nginx:1.21"},
    {"component_id": "gav://org.apache.log4j:log4j-core:2.14.0"}
  ]
}
```

## Scanning

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/scanArtifact` | Trigger artifact scan |
| POST | `/v2/ci/build` | Scan build from CI |
| GET | `/v1/scan/status/{scan_id}` | Get scan status |
| POST | `/v1/scanBuild` | Scan published build |

## Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/summary/artifact` | Get artifact security summary |
| POST | `/v1/summary/build` | Get build security summary |
| POST | `/v1/summary/component` | Get component security summary |

### Artifact Summary Request

```json
{
  "paths": ["docker-local/my-app/1.0/manifest.json"]
}
```

## Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/policies` | Create policy |
| GET | `/v2/policies` | List all policies |
| GET | `/v2/policies/{policyName}` | Get policy |
| PUT | `/v2/policies/{policyName}` | Update policy |
| DELETE | `/v2/policies/{policyName}` | Delete policy |

### Create Security Policy

```json
{
  "name": "critical-vuln-policy",
  "type": "security",
  "description": "Block critical and high vulnerabilities",
  "rules": [
    {
      "name": "block-critical",
      "priority": 1,
      "criteria": {
        "min_severity": "Critical"
      },
      "actions": {
        "block_download": {"active": true, "unscanned": true},
        "block_release_bundle_distribution": true,
        "fail_build": true,
        "notify_deployer": true,
        "notify_watch_recipients": true,
        "create_ticket_enabled": false
      }
    },
    {
      "name": "warn-high",
      "priority": 2,
      "criteria": {
        "min_severity": "High"
      },
      "actions": {
        "block_download": {"active": false},
        "fail_build": false,
        "notify_watch_recipients": true
      }
    }
  ]
}
```

### Create License Policy

```json
{
  "name": "license-compliance",
  "type": "license",
  "rules": [
    {
      "name": "block-gpl",
      "priority": 1,
      "criteria": {
        "banned_licenses": ["GPL-2.0", "GPL-3.0", "AGPL-3.0"]
      },
      "actions": {
        "block_download": {"active": true},
        "fail_build": true
      }
    }
  ]
}
```

## Watches

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/watches` | Create watch |
| GET | `/v2/watches` | List all watches |
| GET | `/v2/watches/{watchName}` | Get watch |
| PUT | `/v2/watches/{watchName}` | Update watch |
| DELETE | `/v2/watches/{watchName}` | Delete watch |

### Create Watch

```json
{
  "general_data": {
    "name": "production-watch",
    "description": "Monitor production repositories",
    "active": true
  },
  "project_resources": {
    "resources": [
      {"type": "repository", "name": "docker-prod-local"},
      {"type": "repository", "name": "libs-release-local"},
      {"type": "all-builds"}
    ]
  },
  "assigned_policies": [
    {"name": "critical-vuln-policy", "type": "security"},
    {"name": "license-compliance", "type": "license"}
  ]
}
```

## Violations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/violations` | Search violations with filters |
| GET | `/v1/violations/{violation_id}` | Get violation details |

### Search Violations

```json
{
  "filters": {
    "watch_name": "production-watch",
    "min_severity": "High",
    "type": "security",
    "created_from": "2024-01-01T00:00:00Z"
  },
  "pagination": {
    "order_by": "created",
    "direction": "desc",
    "limit": 50,
    "offset": 0
  }
}
```

## Ignore Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/ignore_rules` | Create ignore rule |
| GET | `/v1/ignore_rules` | List ignore rules |
| GET | `/v1/ignore_rules/{id}` | Get ignore rule |
| DELETE | `/v1/ignore_rules/{id}` | Delete ignore rule |

### Create Ignore Rule

```json
{
  "notes": "False positive - not exploitable in our context",
  "vulnerabilities": ["CVE-2024-12345"],
  "components": [{"name": "lodash", "version": "4.17.20"}],
  "expiry_date": "2025-06-30T00:00:00Z"
}
```

## Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/reports/vulnerabilities` | Generate vulnerability report |
| POST | `/v1/reports/licenses` | Generate license report |
| POST | `/v1/reports/violations` | Generate violations report |
| POST | `/v1/reports/operationalRisks` | Generate operational risk report |
| GET | `/v1/reports/{report_id}` | Get report status |
| GET | `/v1/reports/{report_id}/resources` | Get report content |
| DELETE | `/v1/reports/{report_id}` | Delete report |

## SBOM

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/component/exportDetails` | Export SBOM (CycloneDX or SPDX format) |
| GET | `/v1/component/exportDetails/{export_id}` | Get SBOM export status |
