# Access Reference

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Access Token** | JWT-based credential with optional scope, expiry, and subject. Preferred over API keys. |
| **Scoped Token** | Token limited to specific resources (repos, builds) and permissions |
| **User** | Individual identity with credentials |
| **Group** | Collection of users for bulk permission assignment |
| **Permission** | Maps actions (read, write, deploy, manage, etc.) to resources for users/groups |
| **Project** | Multi-tenant isolation unit grouping repos, builds, environments, and members |
| **Environment** | SDLC stage (DEV, STAGE, PROD) used for release lifecycle promotion |

## Key API Operations

### Tokens

```bash
# Create short-lived, least-privilege token (preferred: scope to groups/perms, set expires_in)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "ci-bot",
    "scope": "applied-permissions/groups:readers,deployers",
    "expires_in": 3600,
    "refreshable": false,
    "description": "CI pipeline token"
  }' \
  "$JFROG_URL/access/api/v1/tokens"
# Avoid admin-scoped or non-expiring tokens (expires_in: 0) in production; use only when required and rotate.

# List tokens
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v1/tokens"

# Revoke token
curl -X DELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/tokens/{token_id}"
```

### Users

```bash
# Create user (set password via env or secret; never commit)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"john\",\"email\":\"john@example.com\",\"password\":\"$USER_PASSWORD\",\"admin\":false}" \
  "$JFROG_URL/access/api/v2/users"

# Get user
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v2/users/john"

# List users
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v2/users"

# Delete user
curl -X DELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v2/users/john"
```

### Groups

```bash
# Create group
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"dev-team","description":"Development team","members":["john","jane"]}' \
  "$JFROG_URL/access/api/v2/groups"

# Add member to group
curl -X PATCH -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"add":["newuser"]}' \
  "$JFROG_URL/access/api/v2/groups/dev-team/members"
```

### Permissions

```bash
# Create permission target
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-repos-permission",
    "resources": {
      "repository": {
        "include_patterns": ["**"],
        "actions": ["read", "write", "annotate"],
        "targets": [{"name": "libs-snapshot-local"}]
      }
    },
    "principals": {
      "groups": [{"name": "dev-team", "permissions": ["read", "write", "annotate"]}]
    }
  }' \
  "$JFROG_URL/access/api/v2/permissions"
```

### Projects

```bash
# Create project
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "My Application",
    "description": "Main application project",
    "admin_privileges": {"manage_members": true, "manage_resources": true},
    "project_key": "myapp"
  }' \
  "$JFROG_URL/access/api/v1/projects"

# List projects
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v1/projects"

# Add member to project
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"john","roles":["Developer"]}' \
  "$JFROG_URL/access/api/v1/projects/myapp/users/john"

# Get project environments
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/myapp/environments"
```

## Parallelization

When creating multiple users, groups, or permission targets, run the calls in parallel. These are independent operations that do not depend on each other. For example, creating three team groups with their members can be done concurrently.

## Access Federation

Synchronize users, groups, permissions, and tokens across multiple JPDs.

- Requires a **Circle of Trust** between JPDs
- Entities can be federated uni-directionally or bi-directionally
- Each JPD maintains its own Access service

## Reference Files

- [api-reference.md](api-reference.md) -- Complete Access REST API endpoint catalog

# Access REST API Reference

Base URL: `https://$JFROG_URL/access/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

## Tokens

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/tokens` | Create access token |
| GET | `/v1/tokens` | List tokens |
| GET | `/v1/tokens/{token_id}` | Get token details |
| DELETE | `/v1/tokens/{token_id}` | Revoke token |
| POST | `/v1/tokens/{token_id}/refresh` | Refresh token |

### Create Token Body

```json
{
  "subject": "ci-bot",
  "scope": "applied-permissions/groups:readers,deployers",
  "expires_in": 3600,
  "refreshable": true,
  "description": "CI pipeline token",
  "audience": "*@*",
  "include_reference_token": false
}
```

**Scope examples:**
- `applied-permissions/admin` -- full admin
- `applied-permissions/groups:readers` -- inherit readers group permissions
- `applied-permissions/groups:readers,deployers` -- multiple groups
- `applied-permissions/user` -- current user's permissions

## Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/users` | Create user |
| GET | `/v2/users` | List users |
| GET | `/v2/users/{username}` | Get user |
| PATCH | `/v2/users/{username}` | Update user |
| DELETE | `/v2/users/{username}` | Delete user |

### Create User Body

```json
{
  "username": "john",
  "email": "john@example.com",
  "password": "securePass123!",
  "admin": false,
  "profile_updatable": true,
  "disable_ui_access": false,
  "groups": ["dev-team"]
}
```

## Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/groups` | Create group |
| GET | `/v2/groups` | List groups |
| GET | `/v2/groups/{groupName}` | Get group |
| PATCH | `/v2/groups/{groupName}` | Update group |
| DELETE | `/v2/groups/{groupName}` | Delete group |
| GET | `/v2/groups/{groupName}/members` | List group members |
| PATCH | `/v2/groups/{groupName}/members` | Add/remove members |

## Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/permissions` | Create permission |
| GET | `/v2/permissions` | List permissions |
| GET | `/v2/permissions/{permissionName}` | Get permission |
| PUT | `/v2/permissions/{permissionName}` | Replace permission |
| PATCH | `/v2/permissions/{permissionName}` | Update permission |
| DELETE | `/v2/permissions/{permissionName}` | Delete permission |

### Create Permission Body

```json
{
  "name": "release-deployers",
  "resources": {
    "repository": {
      "include_patterns": ["**"],
      "exclude_patterns": [],
      "actions": ["read", "write", "annotate", "delete"],
      "targets": [
        {"name": "libs-release-local"},
        {"name": "docker-prod-local"}
      ]
    },
    "build": {
      "include_patterns": ["**"],
      "actions": ["read", "write", "manage"],
      "targets": [
        {"name": "artifactory-build-info"}
      ]
    }
  },
  "principals": {
    "users": [
      {"name": "release-bot", "permissions": ["read", "write", "annotate"]}
    ],
    "groups": [
      {"name": "release-team", "permissions": ["read", "write", "annotate", "delete"]}
    ]
  }
}
```

**Available actions:** `read`, `write`, `annotate`, `delete`, `manage`, `managedXrayMeta`, `distribute`

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/projects` | Create project |
| GET | `/v1/projects` | List projects |
| GET | `/v1/projects/{projectKey}` | Get project |
| PUT | `/v1/projects/{projectKey}` | Update project |
| DELETE | `/v1/projects/{projectKey}` | Delete project |
| PUT | `/v1/projects/{projectKey}/users/{username}` | Add/update project member |
| DELETE | `/v1/projects/{projectKey}/users/{username}` | Remove project member |
| PUT | `/v1/projects/{projectKey}/groups/{groupName}` | Add/update project group |
| GET | `/v1/projects/{projectKey}/roles` | List project roles |
| POST | `/v1/projects/{projectKey}/roles` | Create custom role |

### Project Roles

Built-in roles: `Project Admin`, `Developer`, `Release Manager`, `Viewer`, `Contributor`

## Environments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/projects/{project_key}/environments` | List project environments (since 7.53.1) |

**Response:**

```json
[
  {"name": "DEV"},
  {"name": "STAGING"},
  {"name": "PROD"}
]
```

## Lifecycle Stages (via AppTrust)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/stages/` | Create lifecycle stage (since 7.125.4) |
| PUT | `/v2/stages/{stageId}` | Update stage |
| GET | `/v2/stages/` | List lifecycle stages |
| GET | `/v2/stages/{stageId}` | Get stage details |
| DELETE | `/v2/stages/{stageId}` | Delete stage |
| GET | `/v2/lifecycles/{lifecycleId}` | Get lifecycle |
| PUT | `/v2/lifecycles/{lifecycleId}` | Update lifecycle |

## Federation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/federation/circle_of_trust` | Get circle of trust members |
| POST | `/v1/federation/circle_of_trust` | Add JPD to circle of trust |
| POST | `/v1/federation/full_sync` | Trigger full entity sync |

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/system/ping` | Health check |
| GET | `/v1/system/version` | Access version |
