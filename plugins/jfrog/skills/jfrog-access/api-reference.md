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
