---
name: JFrog Security (Xray)
description: Use when working with JFrog Security/Xray -- scanning for vulnerabilities, managing policies/watches/violations, generating SBOMs, configuring advanced security (SAST, secrets detection, contextual analysis), or monitoring runtime. Triggers on mentions of xray, vulnerability, CVE, scan, policy, watch, violation, SBOM, SAST, secrets detection, contextual analysis, IaC scanning, or runtime security.
---

# JFrog Security Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URLs:
- Xray: `https://$JFROG_URL/xray/api/...`
- Runtime: `https://$JFROG_URL/runtime/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

> **Pre-flight:** Before operations, verify Xray is available: `GET $JFROG_URL/xray/api/v1/system/ping` (expect HTTP 200). If unavailable, inform the user that Xray is not deployed on this instance and stop.

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

## MCP Mode: Catalog & End-to-End Workflows

When connected to the JFrog MCP Server (Cloud/SaaS only, OAuth auth), additional Catalog tools and orchestrated workflows are available. The MCP Server provides tool schemas automatically; this section teaches *when and how to chain tools together*.

### Catalog vs. Artifactory

| | JFrog Catalog | Artifactory |
|---|---|---|
| **What** | Global OSS intelligence (12M+ packages) | Your org's private binary repos |
| **Answers** | "What's known about this package?" | "What do *we* use?" |
| **Tools** | Catalog tools | Tools with `rt_package` in name |

Artifactory package tools are for dependency analysis only, NOT CI/CD build artifacts.

### Query Routing

| User asks | Route to |
|-----------|----------|
| "Is X safe?" / "Vulnerabilities in X?" | Catalog (public intel) |
| "Do we use X?" / "Versions in our repos?" | Artifactory (internal) |
| "Are we exposed to CVE-X?" | Both: Catalog for vuln data, Artifactory for exposure |
| Ambiguous ("check log4j") | Full security assessment workflow (below) |

### The Supply Chain Flow

```
Public Registry (npm, PyPI, Maven Central...)
    --> JFrog Catalog    (global OSS intelligence: vulns, licenses, malicious flags)
    --> JFrog Curation   (gatekeeper: approved / blocked / inconclusive)
    --> Artifactory       (your org's repos, used by your teams)
    --> JFrog Xray       (continuous scanning of what's already inside)
```

Each layer serves a different purpose. When assessing risk, work top-down through this chain.

### Workflow: Package Security Assessment

**Trigger:** "is X safe?", "check package X", "should we use X?"

Chain sequentially:
1. **Catalog metadata** -- malicious flag? license type? If malicious, STOP and warn.
2. **Vulnerabilities** -- severity breakdown for the target version (default: latest)
3. **Curation status** -- approved/blocked/inconclusive
4. **Internal usage** -- Artifactory query for versions and repos
5. **Synthesize** -- risk summary: malicious status, license, vuln counts, curation decision, internal exposure

### Workflow: Vulnerability Investigation

**Trigger:** "what is CVE-X?", "are we affected by CVE-X?"

1. **CVE lookup** in Catalog -- affected packages, versions, severity
2. **Internal exposure** -- Artifactory query per affected package, cross-ref version ranges
3. **Report** -- vulnerable repos + safe upgrade targets

### Workflow: DevSecOps Report

**Trigger:** "security report", "security posture", "how are we doing on security?"

1. Generate report via DevSecOps tools
2. Highlight critical/high CVEs, applicability status, trends
3. Summarize by severity with actionable next steps

### Workflow: Dependency Audit

**Trigger:** "audit dependencies", "what versions of X do we have?"

1. Query Artifactory for all internal versions
2. Cross-ref with Catalog for vulns/licenses
3. Report: versions, locations, licenses, security issues

### Response Guidelines

- Include severity, affected versions, and upgrade targets for vulnerabilities
- Always include license type in package reports
- Flag copyleft (GPL/AGPL) and unknown/missing licenses as risks
- Chain tools sequentially without asking user to wait
- State clearly when results are empty or inconclusive -- don't speculate
- Use tables for multi-item listings

### Troubleshooting (MCP)

- **Tools unavailable:** Admin must enable MCP Server (Administration > General > Settings > MCP Server > ON). SaaS only.
- **Unauthorized:** Restart MCP client to re-auth. Verify URL and permissions.
- **Empty results:** Verify package name/ecosystem. Check project/repo access.
- **Inconclusive curation:** Not yet evaluated -- advise checking later or escalating.

## Reference Files

- [xray-api-reference.md](xray-api-reference.md) -- Complete Xray REST API endpoint catalog
- [scanning-guide.md](scanning-guide.md) -- Step-by-step scanning workflow guide

## Related Patterns

- `xray-security` -- SDLC-wide SCA scanning with policies
- `jas-security` -- Advanced Security with contextual analysis
- `run-time-security` -- Kubernetes runtime monitoring
- `curation-security` -- Pre-download package validation

> After completing an action, check the **Security Actions** section of `skills/jfrog-patterns/flow-suggestions.md` for flow context and offer the next step.

## Documentation

- [Xray REST APIs](https://jfrog.com/help/r/xray-rest-apis)
- [Xray User Guide](https://jfrog.com/help/r/jfrog-security-user-guide/products/xray)
- [Advanced Security](https://jfrog.com/help/r/jfrog-security-user-guide/products/advanced-security)
- [Runtime Security](https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime)
- [Runtime APIs](https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime/apis)
