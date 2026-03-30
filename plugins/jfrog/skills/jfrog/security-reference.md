# Security (Xray) Reference

## Core Concepts

### Scanning Architecture

JFrog Security scans across the entire SDLC:

1. **IDE** -- real-time scanning in developer IDEs via JFrog plugin
2. **Pull Request** -- scan PR artifacts before merge (Frogbot)
3. **Build/Binary** -- scan after build publish via Xray watches
4. **Continuous Monitoring** -- ongoing scanning of all indexed repos for new CVEs

### Key Entities

| Entity | Description |
|--------|-------------|
| **Policy** | Set of rules defining what constitutes a violation (security, license, or operational risk) |
| **Watch** | Links policies to resources (repos, builds, release bundles) to trigger scanning |
| **Violation** | A policy breach found during scanning |
| **Component** | A software package identified by Xray (name + version + type) |
| **Ignore Rule** | Exception to suppress specific violations |

### Risk Types

- **Malicious Package** -- known malicious packages identified by JFrog's threat research
- **Software Vulnerability** -- CVEs with severity and CVSS score
- **License Risk** -- non-compliant or viral licenses (GPL, AGPL, etc.)
- **Operational Risk** -- end-of-life, low maintenance activity, high-risk code patterns

## Key API Operations

### Scan an Artifact

```bash
# Get artifact summary (vulnerabilities, licenses)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paths":["libs-release-local/com/example/app/1.0/app-1.0.jar"]}' \
  "$JFROG_URL/xray/api/v1/summary/artifact"
```

### Query Component Vulnerabilities

Use `summary/component` to look up vulnerabilities, licenses, and operational risks for a package by its component ID -- no artifact path required.

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"component_details": [{"component_id": "npm://lodash:4.17.20"}]}' \
  "$JFROG_URL/xray/api/v1/summary/component"
```

Component ID format: `<pkg_type>://<name>:<version>` (e.g. `npm://lodash:4.17.20`, `docker://library/nginx:1.21`, `gav://org.apache.log4j:log4j-core:2.14.0`).

> **Prefer `summary/component` over `component/details`.** The `component/details` endpoint (`/v1/component/details`) may return 404 on some Xray versions. `summary/component` is the reliable alternative and returns the same vulnerability, license, and operational-risk data.

### Scan a Build

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"build_name":"my-app","build_number":"42"}' \
  "$JFROG_URL/xray/api/v1/summary/build"
```

### Policies

```bash
# Create a security policy
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "high-severity-block",
    "type": "security",
    "rules": [{
      "name": "block-critical",
      "criteria": {"min_severity": "Critical"},
      "actions": {"block_download": {"active": true}, "fail_build": true}
    }]
  }' \
  "$JFROG_URL/xray/api/v2/policies"

# List policies
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/xray/api/v2/policies"
```

### Watches

```bash
# Create a watch
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "general_data": {"name": "prod-watch", "active": true},
    "project_resources": {
      "resources": [{"type": "repository", "name": "libs-release-local"}]
    },
    "assigned_policies": [{"name": "high-severity-block", "type": "security"}]
  }' \
  "$JFROG_URL/xray/api/v2/watches"
```

### Violations

```bash
# List violations (with filters)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "watch_name": "prod-watch",
      "min_severity": "High",
      "type": "security"
    },
    "pagination": {"limit": 50, "offset": 0}
  }' \
  "$JFROG_URL/xray/api/v1/violations"
```

### Ignore Rules

```bash
# Create an ignore rule
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "False positive confirmed by security team",
    "vulnerabilities": ["CVE-2024-12345"],
    "expiry_date": "2025-12-31"
  }' \
  "$JFROG_URL/xray/api/v1/ignore_rules"
```

### Reports

```bash
# Generate vulnerability report
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Q4-vulnerability-report",
    "type": "vulnerability",
    "resources": {
      "repositories": [{"name": "libs-release-local"}]
    },
    "filters": {"min_severity": "Medium"}
  }' \
  "$JFROG_URL/xray/api/v1/reports/vulnerabilities"
```

## Advanced Security (JAS)

Requires Advanced Security subscription. Enables:

| Feature | What it does |
|---------|-------------|
| **Contextual Analysis** | Analyzes whether a vulnerability is actually reachable in your code; reduces noise by ~80% |
| **Secrets Detection** | Scans code and binaries for leaked credentials, API keys, tokens |
| **SAST** | Static Application Security Testing for source code vulnerabilities |
| **IaC Scanning** | Checks Terraform, CloudFormation, Kubernetes YAML for misconfigurations |
| **App Config Exposures** | Detects insecure application configurations |

These are enabled at the Xray system level and applied automatically to watched resources.

## Runtime Security

Monitors running containers in Kubernetes for real-time threats.

**Concepts:**
- **Runtime Sensor** -- lightweight agent deployed in K8s clusters that monitors container behavior
- **Runtime Controller** -- admission controller that validates images before deployment
- **Image Integrity** -- verifies images haven't been tampered with
- **Package Lineage** -- traces running binaries back to their source build

### Runtime REST API

Base URL: `https://$JFROG_URL/runtime/api/v1/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/clusters` | List clusters (paginated) |
| GET | `/clusters/{id}` | Get cluster details |
| GET | `/images/tags` | List images tags |
| POST | `/workloads` | List workloads |
| GET | `/registration-token` | Get registration token |
| POST | `/registration-token/revoke` | Revoke and create new token |

Docs: https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime/apis

---

# Xray REST API Reference

Base URL: `https://$JFROG_URL/xray/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

With **`jf xr curl`**, pass paths that continue after that base with a leading slash and an `api` segment — e.g. table endpoint `/v1/system/ping` becomes `"/api/v1/system/ping"` (not a full URL, and not `/xray/api/...`).

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

> **Note:** `/v1/component/details` may return 404 on some Xray versions. Prefer `POST /v1/summary/component` (see [Summary](#summary) section) which returns the same vulnerability, license, and operational-risk data reliably.

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

### Component Summary Request

> Preferred method for querying vulnerabilities by package name. Use this instead of `/v1/component/details`.

```json
{
  "component_details": [
    {"component_id": "npm://lodash:4.17.20"},
    {"component_id": "gav://org.apache.log4j:log4j-core:2.14.0"}
  ]
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

---

# JFrog Security Scanning Workflow Guide

## Step 1: Create a Security Policy

Define what constitutes a security violation.

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-security",
    "type": "security",
    "rules": [{
      "name": "block-critical-high",
      "priority": 1,
      "criteria": {"min_severity": "High"},
      "actions": {
        "block_download": {"active": true, "unscanned": true},
        "fail_build": true,
        "notify_watch_recipients": true
      }
    }]
  }' \
  "$JFROG_URL/xray/api/v2/policies"
```

CLI alternative: Policies are managed via REST API (no dedicated CLI command).

## Step 2: Create a Watch

Link your repos/builds to the policy so scanning is triggered.

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "general_data": {"name": "prod-repos-watch", "active": true},
    "project_resources": {
      "resources": [
        {"type": "repository", "name": "docker-prod-local"},
        {"type": "repository", "name": "libs-release-local"}
      ]
    },
    "assigned_policies": [
      {"name": "production-security", "type": "security"}
    ]
  }' \
  "$JFROG_URL/xray/api/v2/watches"
```

After creation, Xray automatically indexes and scans all artifacts in watched resources.

## Step 3: Trigger Scanning

### Automatic (via Watch)

Once a watch is active, Xray scans:
- New artifacts deployed to watched repos
- Published builds linked to watched builds
- Existing artifacts when new CVEs are disclosed

### On-demand Artifact Scan

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"componentID": "docker://my-app:1.0"}' \
  "$JFROG_URL/xray/api/v1/scanArtifact"
```

### Build Scan (from CI)

```bash
# Using JFrog CLI (recommended)
jf build-scan my-app 42

# Using REST API
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"buildName": "my-app", "buildNumber": "42"}' \
  "$JFROG_URL/xray/api/v1/scanBuild"
```

### CLI Scanning

```bash
# Scan current project dependencies
jf audit

# Scan a Docker image
jf docker scan my-app:1.0

# Scan a binary file
jf scan ./myapp-1.0.jar
```

## Step 4: Review Violations

```bash
# List violations for a watch
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "watch_name": "prod-repos-watch",
      "min_severity": "High",
      "type": "security"
    },
    "pagination": {"limit": 25, "offset": 0}
  }' \
  "$JFROG_URL/xray/api/v1/violations"
```

### Get Artifact Summary

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["docker-prod-local/my-app/1.0/manifest.json"]}' \
  "$JFROG_URL/xray/api/v1/summary/artifact"
```

## Step 5: Manage Ignore Rules

Create exceptions for known false positives or accepted risks.

```bash
# Create ignore rule for a specific CVE
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Confirmed false positive by security team - not reachable",
    "vulnerabilities": ["CVE-2024-12345"],
    "expiry_date": "2025-12-31T00:00:00Z"
  }' \
  "$JFROG_URL/xray/api/v1/ignore_rules"

# List active ignore rules
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/xray/api/v1/ignore_rules"
```

## Step 6: Generate Reports

### Vulnerability Report

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "monthly-vuln-report",
    "type": "vulnerability",
    "resources": {
      "repositories": [{"name": "docker-prod-local"}, {"name": "libs-release-local"}]
    },
    "filters": {"min_severity": "Medium"}
  }' \
  "$JFROG_URL/xray/api/v1/reports/vulnerabilities"
```

### License Compliance Report

```bash
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "license-audit",
    "type": "license",
    "resources": {
      "repositories": [{"name": "libs-release-local"}]
    }
  }' \
  "$JFROG_URL/xray/api/v1/reports/licenses"
```

### Check Report Status and Download

```bash
# Check status
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/xray/api/v1/reports/{report_id}"

# Get report content
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/xray/api/v1/reports/{report_id}/resources"
```

## Step 7: Advanced Security (JAS)

Advanced Security features are enabled at the system level and apply automatically.

### Verify JAS is Enabled

```bash
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/xray/api/v1/system/version"
```

### Features Available with JAS

| Feature | What it adds to scans |
|---------|----------------------|
| **Contextual Analysis** | Adds `applicability` field to CVEs: `applicable`, `not_applicable`, `undetermined` |
| **Secrets Detection** | Adds `secrets` findings for leaked credentials in code and binaries |
| **SAST** | Adds source code vulnerability findings |
| **IaC Scanning** | Adds infrastructure misconfiguration findings |

### CLI with Advanced Security

```bash
# Full audit with all JAS features
jf audit --watches prod-repos-watch

# Scan with SAST
jf audit --sast

# Scan with secrets detection
jf audit --secrets
```

All JAS results appear alongside standard SCA results in violation reports and API responses.
