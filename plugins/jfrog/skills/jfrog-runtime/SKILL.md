---
name: JFrog Runtime
description: Use when working with JFrog Runtime -- monitoring runtime clusters, checking node health, or listing running container images with vulnerability info. Triggers on mentions of runtime, runtime cluster, running images, runtime sensor, runtime controller, container monitoring, or node health.
---

# JFrog Runtime Skill

## Authentication

All requests require an access token via the `Authorization` header:

```
Authorization: Bearer $JFROG_ACCESS_TOKEN
```

Base URL: `https://$JFROG_URL/runtime/api/v1/...`

When authentication is needed, follow the [login-flow.md](../jfrog-cli/login-flow.md) procedure to resolve the active JFrog environment. The `jf` CLI is required and will be installed automatically if missing. The agent checks saved credentials via `jf config show` and asks which environment to use if multiple are saved. If none exist, the agent drives the web login flow and saves credentials via `jf config add`.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Runtime Cluster** | A Kubernetes cluster registered with JFrog Runtime for monitoring |
| **Runtime Sensor** | Lightweight agent deployed in K8s clusters that monitors container behavior |
| **Runtime Controller** | Admission controller that validates images before deployment |
| **Node** | Individual machine in a cluster, each with sensor status and health info |

## List Runtime Clusters

Returns all runtime clusters with node counts and controller status.

**Note:** This endpoint uses POST with a body, not GET.

```bash
curl -s -X POST "$JFROG_URL/runtime/api/v1/clusters" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}' | jq .
```

Response contains `total_count`, `pagination`, and a `clusters` array. Each cluster has:
- `id`, `name`, `provider`, `regions`
- `controller_status` (`running` or `stopped`), `controller_version`
- `nodes_count`, `running_nodes_count`, `failed_nodes_count`, `disabled_nodes_count`

## Get Specific Cluster

Returns detailed info including the full list of nodes.

```bash
curl -s -X GET "$JFROG_URL/runtime/api/v1/clusters/${CLUSTER_ID}/" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Note the trailing slash after the cluster ID.

Response includes a `cluster` object with all cluster fields plus a `nodes` array. Each node has:
- `id`, `name`, `hostname`, `architecture`
- `internal_ip`, `internal_dns`, `region`
- `status`, `sensor_installed`, `sensor_version`

## List Running Images

Lists all running container images across clusters with security and operational status.

```bash
curl -s -X GET "$JFROG_URL/runtime/api/v1/live/images?num_of_rows=100&statistics=true&timePeriod=now&page_num=1" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `num_of_rows` | integer | 100 | Number of images to return |
| `statistics` | boolean | true | Include aggregate statistics |
| `timePeriod` | string | `now` | Time window to query |
| `filters` | string | `""` | Filter expression |
| `page_num` | integer | 1 | Page number |

Response contains:
- `images` array — each image has `name`, `registry`, `repositoryPath`, `status`, `clustersCount`, `workloadsCount`, `cloudProviders`, and vulnerability info via `riskiestTagVulns` (counts by severity)
- `statistics` array — aggregate stats with `key`/`value` pairs
- `totalCount` — total matching images

## Common Workflows

### Monitor Cluster Health

1. List all clusters to get an overview
2. Check for clusters with `controller_status: "stopped"` or high `failed_nodes_count`
3. Get specific cluster details to inspect individual nodes

### Identify Vulnerable Running Images

1. List running images with `statistics=true`
2. Check each image's `riskiestTagVulns` for critical/high vulnerability counts
3. Use the jfrog-security skill to get detailed vulnerability information for specific packages

## Official Documentation

- [Runtime Security](https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime)
- [Runtime APIs](https://jfrog.com/help/r/jfrog-security-user-guide/products/runtime/apis)
