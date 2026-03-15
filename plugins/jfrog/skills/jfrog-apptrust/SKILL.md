---
name: JFrog AppTrust
description: Use when working with JFrog AppTrust -- managing applications, creating and promoting application versions, releasing to production, rolling back, or binding packages. Triggers on mentions of apptrust, application entity, application version, trusted release, application risk, promote version, release version, rollback, or package binding.
---

# JFrog AppTrust Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/apptrust/api/v1/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

> **Pre-flight:** Before operations, verify AppTrust is available: `jf apptrust ping --server-id="$JFROG_SERVER_ID"` (expect `OK`). `JFROG_SERVER_ID` is extracted in Step 2 of [login-flow.md](../jfrog-cli/login-flow.md). If unavailable, inform the user that AppTrust is not enabled on this instance and stop.

> **Prerequisites:** Artifactory 7.125.0+, Xray 3.130.5+, Enterprise Plus license with AppTrust entitlement.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Application** | Logical entity representing a software product, with metadata like maturity, criticality, and ownership |
| **Application Version** | A specific release of an application, composed from artifacts, builds, or other versions |
| **Lifecycle Stage** | SDLC phase (DEV, QA, STAGING, PROD) that a version moves through |
| **Promotion** | Advancing a version from one stage to the next (copy, move, keep, or dry_run) |
| **Release** | Final promotion to the PROD stage |
| **Trusted Release** | Status earned when a version passes all policy gates across all stages |
| **Package Binding** | Linking a package version to an application for supply-chain traceability |

## Application Operations

### List Applications

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications?project_key=$PROJECT_KEY" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Query parameters:

| Parameter | Description |
|-----------|-------------|
| `project_key` | Filter by project |
| `name` | Filter by application name |
| `maturity` | `unspecified`, `experimental`, `production`, `end_of_life` |
| `criticality` | `unspecified`, `low`, `medium`, `high`, `critical` |
| `owner` | Filter by owner (repeatable) |
| `label` | Filter by label as `key:value` (repeatable) |
| `order_by` | `name` or `created` (default: `created`) |
| `order_asc` | `true` or `false` (default: `false`) |
| `limit` | Max results (default: 100) |
| `offset` | Pagination offset (default: 0) |

### Create Application

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "application_key": "my-web-app",
    "application_name": "My Web Application",
    "project_key": "myproj",
    "description": "Customer-facing web application",
    "maturity_level": "production",
    "criticality": "high",
    "labels": {"environment": "production", "team": "platform"},
    "user_owners": ["admin", "devops-lead"],
    "group_owners": ["platform-admins"]
  }' | jq .
```

Required fields: `application_key`, `application_name`, `project_key`.

### Get Application

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

### Update Application

Uses `PATCH` — only send fields you want to change. Send empty arrays/objects to clear list fields.

```bash
curl -s -X PATCH "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maturity_level": "end_of_life", "criticality": "low"}' | jq .
```

### Delete Application

```bash
curl -s -X DELETE "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"
```

## Application Version Operations

### List Versions

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions?limit=25&offset=0" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

### Create Version

At least one source (artifacts, builds, or existing versions) is required.

**From builds:**

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "2.0.0",
    "sources": {
      "builds": [
        {"name": "my-app-build", "number": "42", "include_dependencies": true, "repository_key": "artifactory-build-info"}
      ]
    }
  }' | jq .
```

**From artifacts:**

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.0",
    "tag": "stable",
    "sources": {
      "artifacts": [
        {"path": "libs-release/com/example/app/1.0.0/app-1.0.0.jar", "sha256": "abc123..."}
      ]
    }
  }' | jq .
```

**From existing application versions:**

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.0.0",
    "sources": {
      "versions": [
        {"application_key": "base-service", "version": "2.5.0"}
      ]
    }
  }' | jq .
```

### Update Version

```bash
curl -s -X PATCH "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tag": "latest-stable", "properties": {"build.url": ["https://ci.example.com/42"]}}' | jq .
```

To remove properties, include `"delete_properties": ["key-to-remove"]`.

### Delete Version

```bash
curl -s -X DELETE "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"
```

## Version Lifecycle Operations

### Promote Version

Promote a version to a target lifecycle stage (e.g. QA, staging).

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/promote" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_stage": "QA",
    "promotion_type": "copy",
    "included_repository_keys": ["libs-release-local"],
    "excluded_repository_keys": []
  }' | jq .
```

`promotion_type` values: `move`, `copy` (default), `keep`, `dry_run`.

### Release Version

Release a version to the PROD stage (final promotion).

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/release" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"promotion_type": "copy"}' | jq .
```

### Rollback Version

Roll back a version from a lifecycle stage.

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/rollback" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from_stage": "QA"}' | jq .
```

### Get Version Status

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/status" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Returns `release_status` (`pre_release`, `released`, `trusted_release`) and `current_stage`.

### List Version Promotions

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/versions/${VERSION}/promotions?limit=25" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

## Package Binding Operations

Bind package versions to applications for supply-chain traceability. A package version can only be bound to one application.

### Bind Package

```bash
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/packages" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"package_type": "maven", "package_name": "com.example:my-library", "package_version": "1.0.0"}' | jq .
```

### List Bound Packages

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/packages" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

### List Bound Package Versions

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/packages/${PKG_TYPE}/${PKG_NAME}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

### Unbind Package Version

```bash
curl -s -X DELETE "$JFROG_URL/apptrust/api/v1/applications/${APP_KEY}/packages/${PKG_TYPE}/${PKG_NAME}/${PKG_VERSION}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"
```

## Parallelization

When binding multiple packages to an application, the bind calls are independent and can run in parallel. When creating multiple applications (e.g., across different projects), those calls are also independent. Version creation depends on the application existing first, so sequence accordingly.

## Common Workflows

### Register and Release an Application

```bash
# 1. Create app
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"application_key":"payments-svc","application_name":"Payments Service","project_key":"payments","criticality":"critical"}' | jq .

# 2. Create version from build
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/payments-svc/versions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version":"1.0.0","sources":{"builds":[{"name":"payments-svc","number":"100"}]}}' | jq .

# 3. Promote through stages
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/payments-svc/versions/1.0.0/promote" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target_stage":"QA","promotion_type":"copy"}' | jq .

# 4. Release to production
curl -s -X POST "$JFROG_URL/apptrust/api/v1/applications/payments-svc/versions/1.0.0/release" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"promotion_type":"copy"}' | jq .

# 5. Verify status
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/payments-svc/versions/1.0.0/status" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

### Audit Application Status

```bash
curl -s -X GET "$JFROG_URL/apptrust/api/v1/applications/payments-svc/versions/1.0.0/promotions" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

For detailed field schemas, see [api-reference.md](api-reference.md).

## Official Documentation

- [AppTrust REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/apptrust-rest-apis)
- [AppTrust Overview](https://jfrog.com/help/r/jfrog-security-documentation/jfrog-apptrust)
