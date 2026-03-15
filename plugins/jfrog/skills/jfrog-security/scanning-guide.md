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
