---
name: jfrog-platform
description: >
  JFrog Platform specialist for Artifactory, Xray, and Curation workflows.
  Use when user mentions JFrog, Artifactory, Xray, repositories, vulnerabilities,
  curation, artifact search, AQL, DevSecOps reports, license compliance, or
  supply chain security. Triggers on "is this package safe", "do we use X",
  "are we exposed to CVE-X", "find artifact", "create a project", "check
  curation status", "security report". Do NOT use for CI/CD build info,
  user/permission management, Xray policy config, or artifact promotion.
metadata:
  author: JFrog
  version: 4.0.0
  mcp-server: jfrog
  category: security
  tags: [artifactory, xray, curation, supply-chain-security, devops]
---

# JFrog Platform Skill

Workflow orchestration and domain knowledge for JFrog Platform MCP tools. Teaches *when and how to chain tools together* -- tool schemas are provided by the MCP server itself.

Cloud-hosted MCP Server (JFrog Cloud/SaaS only). URL: `https://<team>.jfrog.io`. Auth via OAuth -- no API keys needed.

## Core Concepts

### Catalog vs. Artifactory

| | JFrog Catalog | Artifactory |
|---|---|---|
| **What** | Global OSS intelligence (12M+ packages) | Your org's private binary repos |
| **Answers** | "What's known about this package?" | "What do *we* use?" |
| **Tools** | Catalog tools | Tools with `rt_package` in name |

**Query routing:**
- "Is X safe?" / "Vulnerabilities in X?" --> Catalog (public intel)
- "Do we use X?" / "Versions in our repos?" --> Artifactory (internal)
- "Are we exposed to CVE-X?" --> Both: Catalog for vuln data, Artifactory for exposure
- Ambiguous ("check log4j") --> full security assessment workflow

Artifactory package tools are for dependency analysis only, NOT CI/CD build artifacts.

### The Supply Chain Flow

```
Public Registry (npm, PyPI, Maven Central...)
    --> JFrog Catalog    (global OSS intelligence: vulns, licenses, malicious flags)
    --> JFrog Curation   (gatekeeper: approved / blocked / inconclusive)
    --> Artifactory       (your org's repos, used by your teams)
    --> JFrog Xray       (continuous scanning of what's already inside)
```

Each layer serves a different purpose. When assessing risk, work top-down through this chain.

### Curation

Gatekeeper between public registries and your Artifactory. Status values:
- **approved** -- safe to use
- **blocked** -- rejected by policy; advise against use
- **inconclusive** -- not yet evaluated; do NOT treat as approved

### Licenses

Always surface license type. Flag copyleft (GPL/AGPL) and unknown/missing licenses as risks.

### Repository Types

**local** -- internal packages | **remote** -- proxied public repos | **virtual** -- aggregation layer | **federated** -- multi-site mirrors

**Virtual repo constraint:** The default deployment repo MUST be in the `repositories` list before setting it as default. Not enforced by tool schema -- always validate.

## Workflows

### 1: Package Security Assessment

**Trigger:** "is X safe?", "check package X", "should we use X?"

Chain sequentially:
1. **Catalog metadata** -- malicious flag? license type? If malicious, STOP and warn.
2. **Vulnerabilities** -- severity breakdown for the target version (default: latest)
3. **Curation status** -- approved/blocked/inconclusive
4. **Internal usage** -- Artifactory query for versions and repos
5. **Synthesize** -- risk summary: malicious status, license, vuln counts, curation decision, internal exposure

### 2: Vulnerability Investigation

**Trigger:** "what is CVE-X?", "are we affected by CVE-X?"

1. **CVE lookup** in Catalog -- affected packages, versions, severity
2. **Internal exposure** -- Artifactory query per affected package, cross-ref version ranges
3. **Report** -- vulnerable repos + safe upgrade targets

### 3: DevSecOps Report

**Trigger:** "security report", "security posture", "how are we doing on security?"

1. Generate report via DevSecOps tools
2. Highlight critical/high CVEs, applicability status, trends
3. Summarize by severity with actionable next steps

### 4: Artifact Search

**Trigger:** "find artifact X", "what versions are deployed?", "search for X"

1. AQL query by name/path/repo/type/date/properties
2. Present results with repo, path, metadata
3. Offer vulnerability/curation follow-up

### 5: Project Setup

**Trigger:** "create a JFrog project", "set up a new project"

Creation is **additive and irreversible** (no delete).
1. List existing projects
2. Gather: name, key, package types, Xray indexing, repo types
3. Verify no key conflicts
4. Present full plan --> **wait for explicit confirmation**
5. Create project, then repos

### 6: Dependency Audit

**Trigger:** "audit dependencies", "what versions of X do we have?"

1. Query Artifactory for all internal versions
2. Cross-ref with Catalog for vulns/licenses
3. Report: versions, locations, licenses, security issues

### 7: Repository Management

**Trigger:** "list repos", "create a repository"

**Listing:** retrieve and present repos.

**Creation** (additive, irreversible):
1. List existing repos --> gather requirements (name, pkg type, repo type, Xray)
2. For virtual: validate default deployment repo is in the repo list
3. Present config --> **explicit confirmation** --> create

## Response Guidelines

- Include severity, affected versions, and upgrade targets for vulnerabilities
- Always include license type in package reports
- Chain tools sequentially without asking user to wait
- State clearly when results are empty or inconclusive -- don't speculate
- Use tables for multi-item listings

## Out of Scope

CI/CD builds, user/permission management, Xray policy/watch config, artifact promotion, access tokens. State boundaries clearly if asked.

## Troubleshooting

- **Tools unavailable:** Admin must enable MCP Server (Administration > General > Settings > MCP Server > ON). SaaS only.
- **Unauthorized:** Restart MCP client to re-auth. Verify URL and permissions.
- **Empty results:** Verify package name/ecosystem. Check project/repo access.
- **Inconclusive curation:** Not yet evaluated -- advise checking later or escalating.