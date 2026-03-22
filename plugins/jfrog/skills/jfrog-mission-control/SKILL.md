---
name: JFrog Mission Control
description: Use when working with JFrog Mission Control -- managing JFrog Platform Deployments (JPDs), checking deployment health, auditing licenses, or listing proxies. Triggers on mentions of mission control, JPD, platform deployment, license, proxy, or deployment health.
---

# JFrog Mission Control Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/mc/api/v1/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **JPD** | JFrog Platform Deployment — an instance of the JFrog Platform (Artifactory + Xray + services) |
| **License** | Enterprise license attached to a JPD, with type and expiration |
| **Proxy** | Network proxy configured for outbound connections |

## List All JPD Instances

Returns all JFrog Platform Deployment instances associated with the current platform.

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Returns an array of JPD objects, each with `id`, `name`, `url`, `status`, `location`, `licenses`, `services`, and `tags`.

## Get JPD by ID

Returns details for a specific JPD instance.

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds/${JPD_ID}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Response includes full JPD details: status, location, license info, and service health.

## Attach License to JPD

```bash
curl -s -X POST "$JFROG_URL/mc/api/v1/jpds/${JPD_ID}/attach_license" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"license_key": "your-license-key-here"}'
```

## List Proxies

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/proxies" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

## Common Workflows

### Monitor Platform Health Across Deployments

1. List all JPDs to get an overview of all deployments
2. Check each JPD's `status.code` for `HEALTHY`, `DEGRADED`, or `UNHEALTHY`
3. Inspect individual JPD services for detailed health information

### Audit Licenses

1. List all JPDs
2. Review the `licenses` array on each JPD for expiration dates (`valid_through`) and `expired` status
3. Attach new licenses to JPDs as needed

## Official Documentation

- [Mission Control REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/mission-control)
- [Mission Control Overview](https://jfrog.com/help/r/jfrog-platform-administration-documentation/mission-control)
