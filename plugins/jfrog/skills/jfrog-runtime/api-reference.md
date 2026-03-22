# Runtime API Reference

Base path: `/runtime/api/v1/`

## Clusters

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/clusters` | List clusters (paginated) |
| GET | `/clusters/{id}/` | Get cluster details (note trailing slash) |

### List Clusters Request Body

```json
{
  "limit": 50
}
```

### Cluster Response Object

```json
{
  "id": "string",
  "name": "string",
  "provider": "aws | gcp | azure | ...",
  "regions": ["us-east-1"],
  "controller_status": "running | stopped",
  "controller_version": "string",
  "nodes_count": 10,
  "running_nodes_count": 8,
  "failed_nodes_count": 1,
  "disabled_nodes_count": 1
}
```

### Node Object (in cluster detail response)

```json
{
  "id": "string",
  "name": "string",
  "hostname": "string",
  "architecture": "amd64 | arm64",
  "internal_ip": "10.0.0.1",
  "internal_dns": "string",
  "region": "us-east-1",
  "status": "running | failed | disabled",
  "sensor_installed": true,
  "sensor_version": "string"
}
```

## Running Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/live/images` | List running container images |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `num_of_rows` | integer | 100 | Max images to return |
| `statistics` | boolean | true | Include aggregate stats |
| `timePeriod` | string | `now` | Time window |
| `filters` | string | `""` | Filter expression |
| `page_num` | integer | 1 | Page number |

### Image Response Object

```json
{
  "name": "my-app",
  "registry": "docker.io",
  "repositoryPath": "myorg/my-app",
  "status": "string",
  "clustersCount": 3,
  "workloadsCount": 5,
  "cloudProviders": ["aws"],
  "riskiestTagVulns": {
    "Critical": 0,
    "High": 2,
    "Medium": 5,
    "Low": 12,
    "Unknown": 0
  }
}
```

### Statistics Response

```json
{
  "statistics": [
    {"key": "total_images", "value": 150},
    {"key": "critical_images", "value": 3}
  ],
  "totalCount": 150
}
```
