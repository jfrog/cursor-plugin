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
| POST | `/search/aql` | AQL query (see [aql-reference.md](aql-reference.md)) |

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
