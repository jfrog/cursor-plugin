---
name: JFrog Curation
description: Use when working with JFrog Curation -- managing package curation policies, auditing blocked packages, configuring curated repositories, or managing waivers. Triggers on mentions of curation, package firewall, blocked package, curated repository, waiver, or supply chain policy.
---

# JFrog Curation Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/curation/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

> **Pre-flight:** Before operations, verify Curation is available: `GET $JFROG_URL/curation/api/v1/system/ping` (expect HTTP 200). If unavailable, inform the user that Curation is not deployed on this instance and stop.

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

### Curation Decision Semantics

Every curation evaluation produces one of three outcomes:

- **approved** -- safe to use; package passes all active policies
- **blocked** -- rejected by policy; advise against use
- **inconclusive** -- not yet evaluated by Curation; do NOT treat as approved. Advise checking later or escalating to the security team.

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

## Related Patterns

- `curation-security` -- Curation policy enforcement setup
- `multi-site-partially-air-gapped-package-curation` -- DMZ-based curation
- `multi-site-fully-air-gapped-package-curation` -- Offline curation workflow
- `builds-ci-integration-with-package-curation-and-security-scans` -- CI with Curation

> After completing an action, check the **Curation Actions** section of `skills/jfrog-patterns/flow-suggestions.md` for flow context and offer the next step.

## Documentation

- [JFrog Curation](https://jfrog.com/help/r/jfrog-security-user-guide/products/curation)
- [Curation Overview](https://jfrog.com/curation)
