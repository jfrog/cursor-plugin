---
name: JFrog Access
description: Use when working with JFrog Access -- managing tokens, users, groups, permissions, projects, or authentication. Triggers on mentions of access token, permission, user, group, project, RBAC, authentication, or authorization.
---

# JFrog Access Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/access/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

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

## Project Setup Workflow

Project creation is **additive and irreversible** -- projects cannot be deleted via the API.

**Trigger:** "create a JFrog project", "set up a new project"

1. **List existing projects** to understand what already exists
2. **Gather requirements**: project name, key, package types, Xray indexing preferences, repository types needed
3. **Verify no key conflicts** -- project keys must be unique
4. **Present the full plan** to the user (project config + repos to create)
5. **Wait for explicit confirmation** before proceeding
6. **Create the project**, then create its repositories (use the Artifactory skill for repo creation)

## Parallelization

When creating multiple users, groups, or permission targets, run the calls in parallel. These are independent operations that do not depend on each other. For example, creating three team groups with their members can be done concurrently.

## Access Federation

Synchronize users, groups, permissions, and tokens across multiple JPDs.

- Requires a **Circle of Trust** between JPDs
- Entities can be federated uni-directionally or bi-directionally
- Each JPD maintains its own Access service

## Reference Files

- [api-reference.md](api-reference.md) -- Complete Access REST API endpoint catalog

## Related Patterns

- `repositories-setup-for-cross-team-collaboration` -- Permission control for multi-team repos
- `multi-site-*` -- Multi-JPD patterns using Access Federation

> After completing an action, check the **Artifactory Actions** section of `skills/jfrog-patterns/flow-suggestions.md` -- Access tasks (permissions, federation) are part of Repository Setup and Multi-Site flows mapped there.

## Documentation

- [Access Tokens](https://jfrog.com/help/r/jfrog-rest-apis/access-tokens)
- [Permissions](https://jfrog.com/help/r/jfrog-rest-apis/permissions)
- [Projects](https://jfrog.com/help/r/jfrog-platform-administration-documentation/projects)
- [Access Federation](https://jfrog.com/help/r/jfrog-platform-administration-documentation/access-federation)
