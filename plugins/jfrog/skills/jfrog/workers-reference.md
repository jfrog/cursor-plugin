# Workers Reference

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

# Workers REST API Reference

Base URL: `https://$JFROG_URL/worker/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

## Workers

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/workers` | Create/deploy worker |
| GET | `/v1/workers` | List all workers |
| GET | `/v1/workers/{workerKey}` | Get worker details |
| PUT | `/v1/workers/{workerKey}` | Update worker |
| DELETE | `/v1/workers/{workerKey}` | Delete worker |
| PATCH | `/v1/workers/{workerKey}` | Enable/disable worker |

### Create Worker Body

```json
{
  "key": "my-download-guard",
  "description": "Block deprecated artifact downloads",
  "enabled": true,
  "sourceCode": "export default async (context, data) => { return { status: 'DOWNLOAD_PROCEED' }; }",
  "action": "BEFORE_DOWNLOAD",
  "filterCriteria": {
    "artifactFilterCriteria": {
      "repoKeys": ["libs-release-local", "docker-local"]
    }
  }
}
```

## Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/execute/{workerKey}` | Execute HTTP-triggered worker |
| POST | `/v1/test/{workerKey}` | Test-run worker with mock data |

### Test Worker Body

```json
{
  "testData": {
    "metadata": {
      "repo_key": "libs-release-local",
      "path": "com/example/app/1.0/app-1.0.jar"
    }
  }
}
```

## Worker Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/events` | List all supported event types |
| GET | `/v1/events/{eventName}` | Get event details and schema |

## Worker Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/workers/{workerKey}/logs` | Get worker execution logs |

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/system/ping` | Health check |

# Workers Event Types Reference

## Artifact Events

| Event | Trigger | Can Block? |
|-------|---------|------------|
| `BEFORE_DOWNLOAD` | Before an artifact is downloaded | Yes -- return `DOWNLOAD_STOP` |
| `AFTER_DOWNLOAD` | After an artifact is downloaded | No (informational) |
| `BEFORE_UPLOAD` | Before an artifact is deployed | Yes -- return `UPLOAD_STOP` |
| `AFTER_CREATE` | After an artifact is created/deployed | No |
| `BEFORE_DELETE` | Before an artifact is deleted | Yes -- return `DELETE_STOP` |
| `AFTER_DELETE` | After an artifact is deleted | No |
| `AFTER_MOVE` | After an artifact is moved | No |
| `AFTER_COPY` | After an artifact is copied | No |

## Property Events

| Event | Trigger | Can Block? |
|-------|---------|------------|
| `BEFORE_PROPERTY_CREATE` | Before properties are set on an artifact | Yes |
| `AFTER_PROPERTY_CREATE` | After properties are set | No |
| `BEFORE_PROPERTY_DELETE` | Before properties are removed | Yes |
| `AFTER_PROPERTY_DELETE` | After properties are removed | No |

## Build Events

| Event | Trigger | Can Block? |
|-------|---------|------------|
| `AFTER_BUILD_INFO_SAVE` | After build info is published | No |

## Generic Event

| Event | Trigger | Can Block? |
|-------|---------|------------|
| `GENERIC_EVENT` | HTTP request to worker endpoint | N/A (custom response) |

## TypeScript Context API

### PlatformContext

Available in every worker as the first parameter:

```typescript
interface PlatformContext {
  clients: {
    platformHttp: PlatformHttpClient;  // Make HTTP calls to JFrog APIs
  };
  log: Logger;  // Structured logging
}
```

### PlatformHttpClient

```typescript
interface PlatformHttpClient {
  get(path: string): Promise<HttpResponse>;
  post(path: string, body: any): Promise<HttpResponse>;
  put(path: string, body: any): Promise<HttpResponse>;
  delete(path: string): Promise<HttpResponse>;
  patch(path: string, body: any): Promise<HttpResponse>;
  head(path: string): Promise<HttpResponse>;
}
```

Paths are relative to the JFrog Platform URL. Example: `/artifactory/api/storage/my-repo/file.txt`

### Logger

```typescript
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}
```

## Response Types

### BeforeDownloadResponse

```typescript
interface BeforeDownloadResponse {
  status: 'DOWNLOAD_PROCEED' | 'DOWNLOAD_STOP' | 'DOWNLOAD_WARN';
  message?: string;                // Shown to user when stopped/warned
  modifiedRepoPath?: RepoPath;     // Redirect to different artifact
}
```

### BeforeUploadResponse

```typescript
interface BeforeUploadResponse {
  status: 'UPLOAD_PROCEED' | 'UPLOAD_STOP' | 'UPLOAD_WARN';
  message?: string;
  modifiedRepoPath?: RepoPath;
}
```

### BeforeDeleteResponse

```typescript
interface BeforeDeleteResponse {
  status: 'DELETE_PROCEED' | 'DELETE_STOP' | 'DELETE_WARN';
  message?: string;
}
```

### GenericEventResponse

```typescript
interface GenericEventResponse {
  statusCode: number;
  body: any;
  headers?: Record<string, string>;
}
```

## Common Worker Patterns

### Download Guard

Block downloads of deprecated or quarantined artifacts:

```typescript
export default async (context: PlatformContext, data: BeforeDownloadRequest) => {
  const props = await context.clients.platformHttp.get(
    `/artifactory/api/storage/${data.metadata.repoKey}/${data.metadata.path}?properties`
  );
  if (props.data?.properties?.quarantined?.[0] === 'true') {
    return { status: 'DOWNLOAD_STOP', message: 'Artifact is quarantined' };
  }
  return { status: 'DOWNLOAD_PROCEED' };
};
```

### Upload Validator

Enforce naming conventions on uploaded artifacts:

```typescript
export default async (context: PlatformContext, data: BeforeUploadRequest) => {
  const { name } = data.metadata;
  if (!name.match(/^[a-z0-9\-]+\.(jar|war|zip)$/)) {
    return { status: 'UPLOAD_STOP', message: 'Artifact name must be lowercase with valid extension' };
  }
  return { status: 'UPLOAD_PROCEED' };
};
```

### Webhook Notifier

Send notifications on artifact creation:

```typescript
export default async (context: PlatformContext, data: AfterCreateRequest) => {
  const { repoKey, path, name } = data.metadata;
  context.log.info(`New artifact: ${repoKey}/${path}/${name}`);
  // Could POST to external webhook here via platformHttp
};
```
