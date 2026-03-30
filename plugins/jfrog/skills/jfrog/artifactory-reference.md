# Artifactory Reference

## Core Concepts

### Repository Types

| Type | Purpose | Example |
|------|---------|---------|
| **Local** | Store your own artifacts (1st-party binaries, builds) | `libs-release-local` |
| **Remote** | Cache/proxy external registries (npm, Maven Central, Docker Hub) | `npm-remote` |
| **Virtual** | Single URL that routes to multiple local & remote repos with priority order | `npm` |
| **Federated** | Bi-directional mirror across JFrog Platform Deployments (JPDs) | `shared-docker-federated` |

### Build Info

Structured metadata collected by JFrog CLI during CI. Contains: build name/number, artifacts produced, dependencies consumed, environment variables, VCS info. Published with `jf rt build-publish`. Enables: Xray scanning of builds, promotion, release bundle creation.

### Package Types

Artifactory supports 40+ package types. See [package-types-reference.md](package-types-reference.md) for repo config per type.

## Key API Operations

### Repository Management

```bash
# List all repos
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/repositories"

# Create a local repo
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"my-docker-local","rclass":"local","packageType":"docker"}' \
  "$JFROG_URL/artifactory/api/repositories/my-docker-local"

# Create a remote repo (proxy Docker Hub)
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"docker-remote","rclass":"remote","packageType":"docker","url":"https://registry-1.docker.io/"}' \
  "$JFROG_URL/artifactory/api/repositories/docker-remote"

# Create a virtual repo
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"docker","rclass":"virtual","packageType":"docker","repositories":["my-docker-local","docker-remote"],"defaultDeploymentRepo":"my-docker-local"}' \
  "$JFROG_URL/artifactory/api/repositories/docker"
```

### Artifact Operations

```bash
# Deploy (upload) an artifact
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -T ./myapp-1.0.jar \
  "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Download an artifact
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -O "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Get file info
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"

# Set properties on an artifact
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/storage/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar?properties=build.name=myapp;build.number=42"

# Delete an artifact
curl -X DELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/libs-release-local/com/example/myapp/1.0/myapp-1.0.jar"
```

### Search

```bash
# Quick search by name
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/artifact?name=myapp&repos=libs-release-local"

# GAVC search (Maven coordinates)
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/gavc?g=com.example&a=myapp&v=1.0"

# Property search
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/search/prop?build.name=myapp&repos=libs-release-local"
```

For complex queries use **AQL** -- see the AQL Reference section below.

### Build Info

```bash
# Get build info
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/artifactory/api/build/myapp/42"

# Delete build
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"buildName":"myapp","buildNumbers":["42"],"deleteAll":false}' \
  "$JFROG_URL/artifactory/api/build/delete"

# Promote build (move artifacts between repos)
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"released","targetRepo":"libs-release-local","copy":false}' \
  "$JFROG_URL/artifactory/api/build/promote/myapp/42"
```

### System

```bash
# System health check
curl "$JFROG_URL/artifactory/api/system/ping"

# Get version
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/system/version"

# Storage summary
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/artifactory/api/storageinfo"
```

## Parallelization

When creating multiple repositories (e.g., per-environment or per-team), run the creation calls in parallel using concurrent subagents or background shell jobs. Repository creation calls are independent and do not depend on each other. The same applies to batch artifact uploads and property-setting operations.

## Replication

- **Push replication**: pushes artifacts from local repo to another Artifactory instance
- **Pull replication**: pulls artifacts from a remote Artifactory into a local repo
- **Event-based replication**: triggers on artifact deploy/delete (real-time sync)
- **Cron-based replication**: scheduled sync

```bash
# Create push replication (use token or credentials for the target server)
curl -X PUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<TARGET_JFROG_URL>/artifactory/libs-release-local","username":"$TARGET_USER","password":"$TARGET_TOKEN","enabled":true,"cronExp":"0 0 * * * ?","enableEventReplication":true}' \
  "$JFROG_URL/artifactory/api/replications/libs-release-local"
```

## Federation

Federated repositories are mirrored across multiple JPDs with full bi-directional sync. All members are equal peers.

```bash
# Convert local repo to federated
curl -X POST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/artifactory/api/federation/migrate/libs-release-local"
```

---

# Artifactory REST API Reference

Base URL: `https://$JFROG_URL/artifactory/api`

Authentication: `Authorization: Bearer $JFROG_ACCESS_TOKEN`

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/ping` | Health check (no auth needed) |
| GET | `/system/version` | Artifactory version info |
| GET | `/system/configuration` | Full system YAML configuration |
| PATCH | `/system/configuration` | Update system configuration (YAML body) |
| GET | `/storageinfo` | Storage summary (binaries count, size, repos) |
| POST | `/system/storage/optimize` | Run storage garbage collection |

## Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/repositories` | List all repositories (filter: `?type=local\|remote\|virtual\|federated&packageType=docker`) |
| GET | `/repositories/{repoKey}` | Get repo configuration |
| PUT | `/repositories/{repoKey}` | Create repository (JSON body with `key`, `rclass`, `packageType`) |
| POST | `/repositories/{repoKey}` | Update repository configuration |
| DELETE | `/repositories/{repoKey}` | Delete repository |
| POST | `/repositories/calculateYumMetadata` | Calculate YUM metadata |

### Create Repository Body (key fields)

```json
{
  "key": "my-repo",
  "rclass": "local|remote|virtual|federated",
  "packageType": "generic|docker|maven|npm|pypi|go|helm|...",
  "description": "My repository",
  "url": "https://registry-1.docker.io/",         // remote only
  "repositories": ["local-1", "remote-1"],          // virtual only
  "defaultDeploymentRepo": "local-1",               // virtual only
  "members": [{"url":"https://other.jfrog.io/artifactory/my-repo","enabled":true}]  // federated only
}
```

## Artifacts -- Deploy & Download

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/{repoKey}/{path}` | Deploy artifact (file upload) |
| GET | `/{repoKey}/{path}` | Download artifact |
| HEAD | `/{repoKey}/{path}` | Check artifact exists |
| DELETE | `/{repoKey}/{path}` | Delete artifact |
| POST | `/copy/{srcRepoKey}/{srcPath}?to=/{dstRepoKey}/{dstPath}` | Copy artifact |
| POST | `/move/{srcRepoKey}/{srcPath}?to=/{dstRepoKey}/{dstPath}` | Move artifact |

### Deploy with Properties

```bash
PUT /{repoKey}/{path};prop1=value1;prop2=value2
```

### Deploy with Checksum

```bash
PUT /{repoKey}/{path}
X-Checksum-Sha1: <sha1>
X-Checksum-Sha256: <sha256>
X-Checksum-Deploy: true
```

## Artifacts -- File Info & Properties

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/storage/{repoKey}/{path}` | File/folder info (size, checksums, created/modified dates) |
| GET | `/storage/{repoKey}/{path}?properties` | Get item properties |
| PUT | `/storage/{repoKey}/{path}?properties=key1=val1;key2=val2` | Set item properties |
| PATCH | `/metadata/{repoKey}/{path}` | Update item properties (merge) |
| DELETE | `/storage/{repoKey}/{path}?properties=key1,key2` | Delete item properties |
| GET | `/storage/{repoKey}/{path}?list&deep=1` | List folder contents recursively |
| GET | `/storage/{repoKey}/{path}?stats` | Get download statistics |
| POST | `/checksum/sha256` | Calculate SHA-256 for deployed artifact |

## Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/search/artifact?name={name}&repos={repos}` | Quick search by filename |
| GET | `/search/gavc?g={group}&a={artifact}&v={version}&c={classifier}` | Maven GAVC search |
| GET | `/search/prop?key1=val1&repos={repos}` | Property search |
| GET | `/search/checksum?sha1={sha1}` | Checksum search (sha1, sha256, md5) |
| GET | `/search/dates?from={timestamp}&to={timestamp}&repos={repos}` | Date range search (created/modified) |
| GET | `/search/usage?notUsedSince={timestamp}&repos={repos}` | Find artifacts not downloaded since date |
| GET | `/search/creation?from={timestamp}&to={timestamp}&repos={repos}` | Find artifacts created in date range |
| POST | `/search/aql` | AQL query (see AQL Reference section below) |

## Builds

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/build` | List all builds |
| GET | `/build/{buildName}` | List build runs |
| GET | `/build/{buildName}/{buildNumber}` | Get build info |
| PUT | `/build` | Upload build info (JSON body) |
| POST | `/build/promote/{buildName}/{buildNumber}` | Promote build |
| POST | `/build/delete` | Delete builds |
| GET | `/build/{buildName}/{buildNumber}?diff={otherNumber}` | Diff two builds |
| POST | `/build/rename/{buildName}?to={newName}` | Rename build |

### Promote Build Body

```json
{
  "status": "released",
  "comment": "Promoted to release",
  "ciUser": "ci-bot",
  "targetRepo": "libs-release-local",
  "sourceRepo": "libs-snapshot-local",
  "copy": false,
  "artifacts": true,
  "dependencies": false,
  "failFast": true
}
```

## Replication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/replications/{repoKey}` | Get replication config |
| PUT | `/replications/{repoKey}` | Create/replace replication |
| POST | `/replications/{repoKey}` | Update replication |
| DELETE | `/replications/{repoKey}` | Delete replication |
| POST | `/replication/execute/{repoKey}` | Trigger replication now |

## Federation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/federation/migrate/{repoKey}` | Convert local repo to federated |
| POST | `/federation/fullSync/{repoKey}` | Force full sync of federated repo |
| GET | `/federation/status/{repoKey}` | Get federation sync status |
| POST | `/federation/configSync` | Sync all federated repo configs |

## Support Bundles

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/system/support/bundle` | Create support bundle |
| GET | `/system/support/bundle/{bundleId}` | Get support bundle status |
| GET | `/system/support/bundle/{bundleId}/archive` | Download support bundle |

## Docker-Specific

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/docker/{repoKey}/v2/_catalog` | List Docker repositories |
| GET | `/docker/{repoKey}/v2/{image}/tags/list` | List image tags |
| POST | `/docker/{repoKey}/v2/promote` | Promote Docker image between repos |
| DELETE | `/docker/{repoKey}/v2/{image}/manifests/{tag}` | Delete Docker tag |

## Tokens (Legacy -- prefer Access API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/security/token` | Create token |
| POST | `/security/token/revoke` | Revoke token |
| GET | `/security/apiKey` | Get API key |

---

# Artifactory Query Language (AQL) Reference

AQL is Artifactory's flexible search language for querying artifacts, builds, and properties.

## Usage

```bash
POST /artifactory/api/search/aql
Content-Type: text/plain

items.find({"repo":"libs-release-local","name":{"$match":"*.jar"}})
```

## Syntax

```
<domain>.find(<criteria>)
  .include(<fields>)
  .sort(<sort>)
  .offset(<n>)
  .limit(<n>)
```

## Domains

| Domain | Description |
|--------|-------------|
| `items` | Artifacts (files and folders) |
| `builds` | Build records |
| `entries` | Archive entries (files inside zip/jar) |
| `properties` | Item properties |
| `statistics` | Download stats |
| `modules` | Build modules |
| `releases` | Release bundles |

## Criteria Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equals (default) | `{"name":"app.jar"}` |
| `$ne` | Not equals | `{"name":{"$ne":"test.jar"}}` |
| `$gt` | Greater than | `{"size":{"$gt":1000000}}` |
| `$gte` | Greater than or equal | `{"created":{"$gte":"2024-01-01"}}` |
| `$lt` | Less than | `{"size":{"$lt":5000}}` |
| `$lte` | Less than or equal | |
| `$match` | Wildcard match (`*` and `?`) | `{"name":{"$match":"*.jar"}}` |
| `$nmatch` | Wildcard not match | `{"name":{"$nmatch":"test*"}}` |

## Logical Operators

```
// AND (default when multiple criteria)
items.find({"repo":"my-repo","name":{"$match":"*.jar"}})

// OR
items.find({"$or":[{"repo":"repo-a"},{"repo":"repo-b"}]})

// AND explicit
items.find({"$and":[{"size":{"$gt":1000}},{"size":{"$lt":100000}}]})
```

## Fields

### Item Fields

| Field | Type | Description |
|-------|------|-------------|
| `repo` | string | Repository key |
| `path` | string | Path within repo |
| `name` | string | Filename |
| `type` | string | `file` or `folder` |
| `size` | long | File size in bytes |
| `created` | date | Creation timestamp |
| `created_by` | string | User who created |
| `modified` | date | Last modification |
| `modified_by` | string | User who modified |
| `updated` | date | Last DB update |
| `depth` | int | Path depth |
| `original_md5` | string | Original MD5 checksum |
| `actual_md5` | string | Actual MD5 checksum |
| `original_sha1` | string | Original SHA-1 |
| `actual_sha1` | string | Actual SHA-1 |
| `sha256` | string | SHA-256 checksum |

### Cross-Domain Fields

Access related domains using dot notation:

```
// Find items with specific property
items.find({"@build.name":"my-build"})

// Find items from a build
items.find({"artifact.module.build.name":"my-build","artifact.module.build.number":"42"})

// Find items with download stats
items.find({"stat.downloads":{"$gt":100}})
```

## Include

Specify which fields to return:

```
items.find({"repo":"my-repo"})
  .include("name","repo","path","size","sha256")
```

Include related domain data:

```
items.find({"repo":"my-repo"})
  .include("name","property.*","stat.*")
```

## Sort & Pagination

```
items.find({"repo":"my-repo"})
  .sort({"$desc":["size"]})
  .offset(0)
  .limit(100)
```

## Common Examples

### Find large artifacts

```
items.find({
  "repo":"libs-release-local",
  "size":{"$gt":104857600}
}).include("name","path","size")
  .sort({"$desc":["size"]})
  .limit(20)
```

### Find artifacts not downloaded in 90 days

```
items.find({
  "repo":"libs-release-local",
  "stat.downloaded":{"$lt":"2024-01-01"}
}).include("name","path","size","stat.downloaded")
```

### Find artifacts by build

```
items.find({
  "artifact.module.build.name":"my-app",
  "artifact.module.build.number":"42"
}).include("name","repo","path","sha256")
```

### Find Docker images by property

```
items.find({
  "repo":"docker-local",
  "type":"file",
  "name":"manifest.json",
  "@docker.repoName":{"$match":"my-app*"}
}).include("name","path","@docker.repoName","@docker.manifest")
```

### Find artifacts created this week

```
items.find({
  "created":{"$gte":"2024-06-01"},
  "type":"file"
}).include("name","repo","path","created","size")
  .sort({"$desc":["created"]})
  .limit(50)
```

### Find artifacts with specific properties

```
items.find({
  "repo":"libs-release-local",
  "@release.status":"approved",
  "@qa.passed":"true"
}).include("name","path","@release.status","@qa.passed")
```

## Performance Tips

- Always specify `repo` in criteria to avoid full-table scans
- Use `limit` to cap results
- Use `include` to return only needed fields
- Index-backed fields: `repo`, `path`, `name`, `type`, `created`, `modified`, checksums
- Property queries (`@key`) are efficient when combined with repo filter
