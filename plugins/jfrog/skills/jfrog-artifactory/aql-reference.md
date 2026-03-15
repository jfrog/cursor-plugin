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
