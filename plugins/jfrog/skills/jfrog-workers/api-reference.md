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
