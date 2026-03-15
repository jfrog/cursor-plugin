---
name: JFrog Workers
description: Use when working with JFrog Workers -- creating serverless TypeScript functions, hooking into platform events, or building HTTP-triggered automations. Triggers on mentions of worker, serverless, event hook, TypeScript worker, BEFORE_DOWNLOAD, AFTER_CREATE, or custom platform logic.
---

# JFrog Workers Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/worker/api/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

## Core Concepts

**Workers** are serverless TypeScript functions that run inside the JFrog Platform, triggered by platform events or HTTP requests. They enable custom logic without external infrastructure.

### Trigger Types

| Type | When it runs |
|------|-------------|
| **Event Hook** | Automatically on platform events (e.g., artifact download, repo create) |
| **HTTP Trigger** | On-demand via HTTP request to a unique URL |

### Worker Lifecycle

```
Init (jf worker init) → Develop → Test (jf worker test) → Deploy (jf worker deploy) → Runs in Platform
```

## Development Workflow

### Initialize a New Worker

```bash
# Create worker scaffold
jf worker init my-worker --event BEFORE_DOWNLOAD

# Creates:
# my-worker/
# ├── worker.ts          # Main worker code
# ├── manifest.json      # Worker configuration
# └── tests/
#     └── worker.spec.ts  # Unit tests
```

### manifest.json Structure

```json
{
  "name": "my-worker",
  "description": "Block downloads of deprecated artifacts",
  "sourceCode": "worker.ts",
  "action": "BEFORE_DOWNLOAD",
  "enabled": true,
  "filterCriteria": {
    "artifactFilterCriteria": {
      "repoKeys": ["libs-release-local"]
    }
  }
}
```

### Worker TypeScript Template

```typescript
export default async (context: PlatformContext, data: BeforeDownloadRequest): Promise<BeforeDownloadResponse> => {
  const { repo_key, path } = data.metadata;
  
  // Check for deprecated property
  const props = await context.clients.platformHttp.get(
    `/artifactory/api/storage/${repo_key}/${path}?properties`
  );
  
  if (props.data?.properties?.deprecated?.[0] === 'true') {
    return {
      status: 'DOWNLOAD_STOP',
      message: 'This artifact is deprecated. Use the latest version.'
    };
  }
  
  return { status: 'DOWNLOAD_PROCEED' };
};
```

### Deploy and Manage

```bash
# Test worker locally
jf worker test my-worker

# Deploy to platform
jf worker deploy my-worker

# List deployed workers
jf worker list

# Undeploy
jf worker undeploy my-worker
```

## Key API Operations

```bash
# Create/deploy worker
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @manifest.json \
  "$JFROG_URL/worker/api/v1/workers"

# List workers
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/worker/api/v1/workers"

# Get worker
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/worker/api/v1/workers/my-worker"

# Update worker
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @manifest.json \
  "$JFROG_URL/worker/api/v1/workers/my-worker"

# Delete worker
curl -X DELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/worker/api/v1/workers/my-worker"

# Execute worker (HTTP trigger)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"value"}' \
  "$JFROG_URL/worker/api/v1/execute/my-worker"
```

## Reference Files

- [api-reference.md](api-reference.md) -- Complete Workers REST API endpoint catalog
- [events-reference.md](events-reference.md) -- All supported event types and TypeScript APIs

## Documentation

- [Workers Overview](https://jfrog.com/help/r/jfrog-platform-administration-documentation/workers)
- [TypeScript Code for Workers](https://jfrog.com/help/r/jfrog-platform-administration-documentation/typescript-code-for-workers)
- [Workers REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/create-worker)
- [Supported Worker Events](https://jfrog.com/help/r/jfrog-platform-administration-documentation/supported-worker-events)
