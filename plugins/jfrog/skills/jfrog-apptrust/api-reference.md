# AppTrust API Reference

Base path: `/apptrust/api/v1/`

## Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/applications` | List applications (supports filtering & pagination) |
| POST | `/applications` | Create application |
| GET | `/applications/{key}` | Get application |
| PATCH | `/applications/{key}` | Update application (partial) |
| DELETE | `/applications/{key}` | Delete application |

### Application Request Body

```json
{
  "application_key": "string (required, unique)",
  "application_name": "string (required)",
  "project_key": "string (required)",
  "description": "string",
  "maturity_level": "unspecified | experimental | production | end_of_life",
  "criticality": "unspecified | low | medium | high | critical",
  "labels": {"key": "value"},
  "user_owners": ["username"],
  "group_owners": ["group-name"]
}
```

### List Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_key` | string | Filter by project |
| `name` | string | Filter by name |
| `maturity` | string | Filter by maturity level |
| `criticality` | string | Filter by criticality |
| `owner` | string | Filter by owner (repeatable) |
| `label` | string | Filter by label as `key:value` (repeatable) |
| `order_by` | string | `name` or `created` (default: `created`) |
| `order_asc` | boolean | Sort ascending (default: false) |
| `limit` | integer | Max results (default: 100) |
| `offset` | integer | Pagination offset (default: 0) |

## Application Versions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/applications/{key}/versions` | List versions |
| POST | `/applications/{key}/versions` | Create version |
| PATCH | `/applications/{key}/versions/{version}` | Update version |
| DELETE | `/applications/{key}/versions/{version}` | Delete version |

### Version Request Body

```json
{
  "version": "string (required, semver)",
  "tag": "string",
  "sources": {
    "artifacts": [
      {"path": "repo/path/to/file", "sha256": "checksum"}
    ],
    "builds": [
      {
        "name": "build-name",
        "number": "build-number",
        "build_started": "ISO 8601 (optional)",
        "build_repository": "artifactory-build-info (default)",
        "include_dependencies": false
      }
    ],
    "versions": [
      {"application_key": "other-app", "version": "1.0.0"}
    ]
  }
}
```

At least one source type (artifacts, builds, or versions) is required.

### Version Response

```json
{
  "version": "1.0.0",
  "tag": "stable",
  "release_status": "pre_release | released | trusted_release",
  "current_stage": "QA",
  "created_by": "admin",
  "created": "2025-01-15T10:00:00Z"
}
```

## Lifecycle Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/applications/{key}/versions/{version}/promote` | Promote version to stage |
| POST | `/applications/{key}/versions/{version}/release` | Release version to PROD |
| POST | `/applications/{key}/versions/{version}/rollback` | Rollback from stage |
| GET | `/applications/{key}/versions/{version}/status` | Get version status |
| GET | `/applications/{key}/versions/{version}/promotions` | List promotions |

### Promote Request Body

```json
{
  "target_stage": "string (required, e.g. QA, STAGING)",
  "promotion_type": "copy | move | keep | dry_run (default: copy)",
  "included_repository_keys": ["repo-key"],
  "excluded_repository_keys": ["repo-key"]
}
```

### Release Request Body

```json
{
  "promotion_type": "copy | move | keep | dry_run (default: copy)"
}
```

### Rollback Request Body

```json
{
  "from_stage": "string (required, stage to roll back from)"
}
```

### Status Response

```json
{
  "release_status": "pre_release | released | trusted_release",
  "current_stage": "PROD"
}
```

## Package Bindings

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/applications/{key}/packages` | Bind package to application |
| GET | `/applications/{key}/packages` | List bound packages |
| GET | `/applications/{key}/packages/{type}/{name}` | List bound package versions |
| DELETE | `/applications/{key}/packages/{type}/{name}/{version}` | Unbind package version |

### Bind Package Request Body

```json
{
  "package_type": "maven | npm | docker | pypi | go | ...",
  "package_name": "com.example:my-library",
  "package_version": "1.0.0"
}
```

A package version can only be bound to one application at a time.
