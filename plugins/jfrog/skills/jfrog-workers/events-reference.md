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
