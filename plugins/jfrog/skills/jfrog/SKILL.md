---
name: jfrog-platform
description: Use when working with the JFrog Platform -- Artifactory (repositories, artifacts, builds, AQL, replication, federation), Security/Xray (vulnerabilities, CVEs, policies, watches, SBOM, SAST, secrets detection), Access (tokens, users, groups, permissions, projects, RBAC), Distribution (release bundles, promotion, environments, edge nodes, evidence), Curation (package firewall, blocked packages, waivers), AppTrust (application entities, versions, trusted releases), Runtime (clusters, running images, sensors), Mission Control (JPDs, deployment health, licenses), Workers (serverless TypeScript, event hooks), CLI (jf command, jf rt, jf audit, jf scan), and architectural patterns/best practices. Triggers on mentions of any JFrog product, artifactory, xray, security, access token, curation, distribution, release bundle, apptrust, runtime, mission control, worker, jf command, pattern, or best practice.
metadata:
  author: JFrog
  version: 1.0.0
  mcp-server: jfrog
  category: security
  tags: [artifactory, xray, curation, supply-chain-security, devops]
---

# JFrog Platform Skill

## MCP Server (Cursor)

The JFrog MCP Server provides AI tools for Artifactory, Xray, Curation, and the JFrog Catalog directly inside Cursor. Auth is via **OAuth** — no API keys or tokens needed in Cursor. SaaS only. URL format: `https://<team>.jfrog.io`.

To enable: **Administration > General > Settings > MCP Server → ON** (admin required).

If MCP tools are unavailable: ask the user to enable the MCP Server. If unauthorized: restart Cursor to re-trigger OAuth. Fall back to REST API / CLI for operations not covered by MCP tools.

## JFrog Catalog

Global OSS intelligence database (12M+ packages). Provides vulnerability data, license info, and malicious package flags — independent of what your org stores in Artifactory.

| | JFrog Catalog | Artifactory |
|---|---|---|
| **What** | Global OSS intelligence | Your org's private binary repos |
| **Answers** | "What's known about this package?" | "What do *we* use?" |

**Query routing:**
- "Is X safe?" / "Vulnerabilities in X?" → Catalog (public intel)
- "Do we use X?" / "Versions in our repos?" → Artifactory (internal)
- "Are we exposed to CVE-X?" → Both: Catalog for vuln data, Artifactory for internal exposure
- Ambiguous ("check log4j") → full security assessment (see workflow below)

Artifactory package tools are for **dependency analysis only**, not CI/CD build artifacts.

## Supply Chain Flow

```
Public Registry (npm, PyPI, Maven Central...)
    → JFrog Catalog    (global OSS intelligence: vulns, licenses, malicious flags)
    → JFrog Curation   (gatekeeper: approved / blocked / inconclusive)
    → Artifactory      (your org's repos, used by your teams)
    → JFrog Xray       (continuous scanning of what's already inside)
```

Each layer serves a different purpose. When assessing risk, work top-down through this chain.

## Security Assessment Workflows

### Package Security Assessment

**Trigger:** "is X safe?", "check package X", "should we use X?"

Chain sequentially:
1. **Catalog metadata** — malicious flag? license type? If malicious, **STOP and warn**.
2. **Vulnerabilities** — severity breakdown for the target version (default: latest)
3. **Curation status** — approved / blocked / inconclusive
4. **Internal usage** — Artifactory query for versions and repos in use
5. **Synthesize** — risk summary: malicious status, license, vuln counts, curation decision, internal exposure

### Vulnerability Investigation

**Trigger:** "what is CVE-X?", "are we affected by CVE-X?"

1. **CVE lookup** in Catalog — affected packages, versions, severity
2. **Internal exposure** — Artifactory query per affected package, cross-ref version ranges
3. **Report** — vulnerable repos + safe upgrade targets

### DevSecOps Report

**Trigger:** "security report", "security posture", "how are we doing on security?"

1. Generate report via DevSecOps tools
2. Highlight critical/high CVEs, applicability status, trends
3. Summarize by severity with actionable next steps

## Authentication

All JFrog REST API calls require authentication via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

When authentication is needed, follow the [login-flow.md](login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `JFROG_URL` | JFrog instance hostname (no `https://`). Used in all REST API calls |
| `JFROG_ACCESS_TOKEN` | Access token for Bearer authentication |
| `JF_URL` | CLI-native alternative to `JFROG_URL` |
| `JF_ACCESS_TOKEN` | CLI-native alternative to `JFROG_ACCESS_TOKEN` |

## Pre-flight Service Discovery

Before calling a service other than Artifactory, verify it is available. See [preflight.md](preflight.md) for the full endpoint list.

| Service | Ping Endpoint | Expected |
|---------|--------------|----------|
| Artifactory | `GET $JFROG_URL/artifactory/api/system/ping` | `OK` |
| Xray | `GET $JFROG_URL/xray/api/v1/system/ping` | HTTP 200 |
| Curation | `GET $JFROG_URL/curation/api/v1/system/ping` | HTTP 200 |
| Lifecycle | `GET $JFROG_URL/lifecycle/api/v2/promotion/records?limit=1` | HTTP 200 |
| AppTrust | `jf apptrust ping` | `OK` |

If a service is unavailable, inform the user and stop -- do not attempt further calls to that service.

## Platform Overview

| Service | Base URL | Purpose |
|---------|----------|---------|
| **Artifactory** | `$JFROG_URL/artifactory/api/...` | Repository and artifact management |
| **Xray** | `$JFROG_URL/xray/api/...` | Security scanning, policies, watches |
| **Access** | `$JFROG_URL/access/api/...` | Tokens, users, groups, permissions, projects |
| **Lifecycle** | `$JFROG_URL/lifecycle/api/...` | Release bundles, promotion |
| **Distribution** | `$JFROG_URL/distribution/api/...` | Distribute releases to edge nodes |
| **Evidence** | `$JFROG_URL/evidence/api/...` | Signed attestations (DSSE format) |
| **Curation** | `$JFROG_URL/curation/api/...` | Package firewall |
| **AppTrust** | `$JFROG_URL/apptrust/api/v1/...` | Application lifecycle management |
| **Runtime** | `$JFROG_URL/runtime/api/v1/...` | Kubernetes container monitoring |
| **Mission Control** | `$JFROG_URL/mc/api/v1/...` | Multi-JPD management |
| **Workers** | `$JFROG_URL/worker/api/...` | Serverless TypeScript functions |

## Artifactory

Manages repositories, artifacts, builds, and search. For complete API coverage, see [artifactory-reference.md](artifactory-reference.md).

### Repository Types

| Type | Purpose |
|------|---------|
| **Local** | Store your own artifacts (1st-party binaries, builds) |
| **Remote** | Cache/proxy external registries (npm, Maven Central, Docker Hub) |
| **Virtual** | Single URL routing to multiple local & remote repos with priority order |
| **Federated** | Bi-directional mirror across JPDs |

> **Virtual repo constraint:** `defaultDeploymentRepo` MUST be present in the `repositories` list before it can be set as the default. This is not enforced by the API schema — always validate before creation.

### Quick Reference

```bash
# List repos
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/repositories"

# Create local repo
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"my-docker-local","rclass":"local","packageType":"docker"}' \
  "$JFROG_URL/artifactory/api/repositories/my-docker-local"

# Deploy artifact
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -T ./myapp-1.0.jar \
  "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Download artifact
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -O "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# AQL search (see aql syntax in artifactory-reference.md)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"libs-release-local","name":{"$match":"*.jar"}})' \
  "$JFROG_URL/artifactory/api/search/aql"

# Build info
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/build/myapp/42"
```

For AQL syntax, package-type configs, replication, and federation, see [artifactory-reference.md](artifactory-reference.md) and [artifactory-packages-reference.md](artifactory-packages-reference.md).

## Security (Xray)

Scans artifacts for vulnerabilities, manages policies and watches. For complete API coverage, see [security-reference.md](security-reference.md).

### Key Entities

| Entity | Description |
|--------|-------------|
| **Policy** | Rules defining what constitutes a violation (security, license, or operational risk) |
| **Watch** | Links policies to resources (repos, builds, release bundles) to trigger scanning |
| **Violation** | A policy breach found during scanning |

### Quick Reference

```bash
# Scan artifact for vulnerabilities
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"component_details": [{"component_id": "npm://lodash:4.17.20"}]}' \
  "$JFROG_URL/xray/api/v1/summary/component"

# Create security policy
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "high-severity-block",
    "type": "security",
    "rules": [{"name": "block-critical", "criteria": {"min_severity": "Critical"}, "actions": {"block_download": {"active": true}, "fail_build": true}}]
  }' \
  "$JFROG_URL/xray/api/v2/policies"

# Create watch
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "general_data": {"name": "prod-watch", "active": true},
    "project_resources": {"resources": [{"type": "repository", "name": "libs-release-local"}]},
    "assigned_policies": [{"name": "high-severity-block", "type": "security"}]
  }' \
  "$JFROG_URL/xray/api/v2/watches"
```

Advanced Security (JAS): Contextual Analysis, Secrets Detection, SAST, IaC Scanning. See [security-reference.md](security-reference.md).

## Access

Manages tokens, users, groups, permissions, and projects. For complete API coverage, see [access-reference.md](access-reference.md).

### Quick Reference

```bash
# Create scoped token
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"ci-bot","scope":"applied-permissions/groups:readers,deployers","expires_in":3600}' \
  "$JFROG_URL/access/api/v1/tokens"

# Create user
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"john\",\"email\":\"john@example.com\",\"password\":\"$USER_PASSWORD\",\"admin\":false}" \
  "$JFROG_URL/access/api/v2/users"

# Create permission target
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-repos-permission",
    "resources": {"repository": {"include_patterns": ["**"], "actions": ["read","write","annotate"], "targets": [{"name": "libs-snapshot-local"}]}},
    "principals": {"groups": [{"name": "dev-team", "permissions": ["read","write","annotate"]}]}
  }' \
  "$JFROG_URL/access/api/v2/permissions"

# Create project
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"My Application","project_key":"myapp"}' \
  "$JFROG_URL/access/api/v1/projects"
```

## Distribution & Release Lifecycle

Manages release bundles, promotion through environments, distribution to edge nodes, and evidence. For complete API coverage, see [distribution-reference.md](distribution-reference.md).

### Workflow

```
Build artifacts -> Create Release Bundle -> Promote DEV -> STAGING -> PROD -> Distribute to Edge
```

### Quick Reference

```bash
# Create release bundle from build
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "release_bundle_name": "my-app-release", "release_bundle_version": "1.0.0",
    "source_type": "builds", "source": {"builds": [{"build_name": "my-app", "build_number": "42"}]}
  }' \
  "$JFROG_URL/lifecycle/api/v2/release_bundle"

# Promote to staging
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment": "STAGING", "included_repository_keys": ["libs-release-local"]}' \
  "$JFROG_URL/lifecycle/api/v2/release_bundle/records/my-app-release/1.0.0/promote"

# Distribute to edge nodes
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"distribution_rules": [{"site_name": "edge-us-east"}, {"site_name": "edge-eu-west"}]}' \
  "$JFROG_URL/distribution/api/v1/distribution/my-app-release/1.0.0"

# Attach evidence (CLI recommended)
jf evd create --build-name=my-app --build-number=42 \
  --key "$PRIVATE_KEY" --predicate ./predicate.json \
  --predicate-type https://jfrog.com/evidence/signature/v1
```

## Curation

Package firewall that blocks risky OSS before it enters Artifactory. For complete API coverage, see [curation-reference.md](curation-reference.md).

**Curation status values:**
- **approved** — safe to use
- **blocked** — rejected by policy; advise against use
- **inconclusive** — not yet evaluated; **do NOT treat as approved**

**License guidance:** Always surface the license type in package reports. Flag copyleft (GPL/AGPL) and unknown/missing licenses as risks.

### Quick Reference

```bash
# Create curation policy
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "block-malicious-and-critical", "enabled": true,
    "conditions": [{"type": "malicious_package"}, {"type": "cvss_score", "min_severity": 9.0}],
    "repositories": ["npm-remote", "pypi-remote"], "action": "block"
  }' \
  "$JFROG_URL/curation/api/v1/policies"

# Audit blocked packages
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/curation/api/v1/audit?repo=npm-remote&action=blocked&limit=50"

# CLI: audit current project
jf curation-audit
```

## AppTrust

Manages application entities, versions, lifecycle promotion, and package binding. For complete API coverage, see [apptrust-reference.md](apptrust-reference.md).

### Quick Reference

```bash
# Create application
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"application_key":"my-app","application_name":"My Application","project_key":"myproj","criticality":"high"}' | jq .

# Create version from build
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version":"1.0.0","sources":{"builds":[{"name":"my-app","number":"42"}]}}' | jq .

# Promote version
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/promote" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target_stage":"QA","promotion_type":"copy"}' | jq .

# Release to production
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/release" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"promotion_type":"copy"}' | jq .
```

## Workers

Serverless TypeScript functions triggered by platform events or HTTP requests. For complete API coverage, see [workers-reference.md](workers-reference.md).

### Quick Reference

```bash
# Initialize worker scaffold
jf worker init my-worker --event BEFORE_DOWNLOAD

# Deploy worker
jf worker deploy my-worker

# List workers
jf worker list

# REST API: create worker
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @manifest.json "$JFROG_URL/worker/api/v1/workers"
```

For event types and TypeScript templates, see [workers-reference.md](workers-reference.md).

## Runtime

Monitors running containers in Kubernetes clusters. For complete API coverage, see [runtime-reference.md](runtime-reference.md).

### Quick Reference

```bash
# List clusters
curl -s -X POST "$JFROG_URL/runtime/api/v1/clusters" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}' | jq .

# List running images with vulnerability stats
curl -s -X GET "$JFROG_URL/runtime/api/v1/live/images?num_of_rows=100&statistics=true&timePeriod=now" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

## Mission Control

Manages JFrog Platform Deployments (JPDs), licenses, and proxies. For complete API coverage, see [mission-control-reference.md](mission-control-reference.md).

### Quick Reference

```bash
# List all JPDs
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .

# Get JPD health
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds/${JPD_ID}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

## CLI Quick Reference

The JFrog CLI (`jf`) provides command-line access to all platform services. For complete command coverage, see [cli-reference.md](cli-reference.md).

```bash
# Install
brew install jfrog-cli   # macOS
curl -fL https://install-cli.jfrog.io | sh   # Linux

# Artifact operations
jf rt upload "build/*.jar" libs-release-local/com/example/app/1.0/
jf rt download "libs-release-local/com/example/app/1.0/*.jar" ./local/
jf rt search "libs-release-local/com/example/**/*.jar"

# Build integration
jf rt build-publish my-build 1

# Security scanning
jf audit                          # Scan project dependencies
jf scan ./myapp.jar               # Scan a binary
jf docker scan myapp:1.0          # Scan Docker image

# Release bundles
jf release-bundle-create my-bundle 1.0 --builds="my-build/1" --signing-key=mykey
jf release-bundle-promote my-bundle 1.0 --environment=PROD
```

## Patterns & Best Practices

22 recommended architectural patterns across 6 categories. See [patterns-reference.md](patterns-reference.md) for the full catalog.

| Category | Patterns | Reference |
|----------|----------|-----------|
| CI Integration | 4 patterns (SIMPLE to ADVANCED) | [patterns-ci-integration.md](patterns-ci-integration.md) |
| Repositories | 3 patterns (SIMPLE to ADVANCED) | [patterns-repositories.md](patterns-repositories.md) |
| Supply Chain Security | 4 patterns (INTERMEDIATE to ADVANCED) | [patterns-supply-chain-security.md](patterns-supply-chain-security.md) |
| Release Lifecycle | 4 patterns (SIMPLE to ADVANCED) | [patterns-release-lifecycle.md](patterns-release-lifecycle.md) |
| Multi-Site | 5 patterns (All ADVANCED) | [patterns-multi-site.md](patterns-multi-site.md) |
| AppTrust | 2 patterns (Both SIMPLE) | [patterns-apptrust.md](patterns-apptrust.md) |

Use the 5 user journeys to pick the right patterns: [patterns-journeys.md](patterns-journeys.md).

| If your goal is... | Start with... |
|---------------------|---------------|
| Centralize artifacts and automate CI/CD | CI Integration + Basic Repo Setup |
| Secure the software supply chain | Xray Security + Curation Security |
| Accelerate developer productivity | CI Integration + Curation + Contextual Analysis |
| Handle enterprise-scale multi-site | Multi-Site Active/Active or Active/Standby |
| Govern releases with compliance | Release Lifecycle + Evidence + AppTrust |

## Flow Encouragement (Agent Behavior)

Use [flow-suggestions.md](flow-suggestions.md) in **two situations**:

### A. After completing an action

Check whether the action is part of a larger pattern. If it is, **show progress and offer options** to continue:

1. **Acknowledge first** -- confirm the action succeeded before suggesting anything.
2. **Always show the diagram** -- render the mermaid progress diagram so the user can see where they are in the pattern. Mark completed steps with `:::done` and the suggested next step with `:::next`. Prefer `flowchart LR` for simple sequential flows; use `flowchart TD` for branching architectures.
3. **Offer a selection** -- after the diagram, use the `AskQuestion` tool to present 2-3 options. The first option should be the natural next step. Include at least one alternative and always end with a "Something else" option.
4. **Never block** -- the suggestion goes at the end of your response, after the completed work.
5. **Context-aware** -- if the user already has the next piece in place, skip it and suggest the one after.

### B. When the user is exploring

If the user asks "what can I do?", "how do I get started?", or seems unsure -- use the **Getting Started** section of flow-suggestions.md.

**Rules:** Respect the answer -- if the user declines, do not push the pattern again. Always show a mermaid diagram before offering options.

## Parallelization

Many JFrog operations are independent and can run concurrently:
- **Repository creation**: multiple repos can be created in parallel
- **User/group creation**: independent operations
- **Docker builds**: each `docker build` + `jf docker push` pair can run in parallel
- **Package binding** (AppTrust): bind calls are independent
- **Batch artifact uploads**: independent upload operations

## Security Rules

- **Never print, echo, or display tokens** in terminal output. Extract tokens silently into shell variables.
- **Never surface tokens in chat.** Use "authenticated successfully" -- never the token itself.
- **Quote all shell variables** (`"${VAR}"`, not `$VAR`).
- **Avoid shell interpolation for secrets.** Use quoted heredocs (`<< 'EOF'`).
- **`jf config` is the sole credential store.** Never store tokens in plaintext files.
- **Validate URLs** (ping endpoint) before authenticated API calls.
- **`JFROG_ACCESS_TOKEN` is sensitive** -- never use in echo/logging.

## Response Guidelines

- Include severity, affected versions, and upgrade targets for all vulnerability reports
- Always include license type in package reports; flag copyleft and unknown licenses as risks
- Chain tools sequentially without asking the user to wait between steps
- State clearly when results are empty or inconclusive — do not speculate
- Use tables for multi-item listings

## Troubleshooting (MCP)

- **Tools unavailable:** Admin must enable the MCP Server — Administration > General > Settings > MCP Server > ON. SaaS only.
- **Unauthorized:** Restart Cursor to re-trigger OAuth. Verify the JFrog URL and user permissions.
- **Empty results:** Verify package name and ecosystem. Check project/repo access.
- **Inconclusive curation:** Package not yet evaluated — advise checking later or escalating to a security admin.

## Documentation

- [JFrog Help Center](https://jfrog.com/help/home)
- [JFrog REST APIs](https://jfrog.com/help/r/jfrog-rest-apis)
- [Artifactory REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/artifactory-rest-apis)
- [Xray REST APIs](https://jfrog.com/help/r/xray-rest-apis)
- [Distribution REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/distribution-rest-apis)
- [AppTrust REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/apptrust-rest-apis)
- [JFrog CLI](https://jfrog.com/help/r/jfrog-cli)
- [Repository Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/repository-management)
- [Release Lifecycle Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/release-lifecycle-management)
- [Xray User Guide](https://jfrog.com/help/r/jfrog-security-user-guide/products/xray)
- [Advanced Security](https://jfrog.com/help/r/jfrog-security-user-guide/products/advanced-security)
- [Curation](https://jfrog.com/help/r/jfrog-security-user-guide/products/curation)
- [Runtime Security](https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime)
- [Workers](https://jfrog.com/help/r/jfrog-platform-administration-documentation/workers)
- [Mission Control](https://jfrog.com/help/r/jfrog-platform-administration-documentation/mission-control)
- [Projects](https://jfrog.com/help/r/jfrog-platform-administration-documentation/projects)
- [Access Federation](https://jfrog.com/help/r/jfrog-platform-administration-documentation/access-federation)
- [Evidence Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/evidence-management)
- [Build Integration](https://jfrog.com/help/r/jfrog-integrations-documentation/build-integration)
