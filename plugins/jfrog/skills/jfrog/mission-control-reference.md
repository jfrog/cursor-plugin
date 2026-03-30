# Mission Control Reference

## Core Concepts

| Concept | Description |
|---------|-------------|
| **JPD** | JFrog Platform Deployment — an instance of the JFrog Platform (Artifactory + Xray + services) |
| **License** | Enterprise license attached to a JPD, with type and expiration |
| **Proxy** | Network proxy configured for outbound connections |

## List All JPD Instances

Returns all JFrog Platform Deployment instances associated with the current platform.

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Returns an array of JPD objects, each with `id`, `name`, `url`, `status`, `location`, `licenses`, `services`, and `tags`.

## Get JPD by ID

Returns details for a specific JPD instance.

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/jpds/${JPD_ID}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

Response includes full JPD details: status, location, license info, and service health.

## Attach License to JPD

```bash
curl -s -X POST "$JFROG_URL/mc/api/v1/jpds/${JPD_ID}/attach_license" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"license_key": "your-license-key-here"}'
```

## List Proxies

```bash
curl -s -X GET "$JFROG_URL/mc/api/v1/proxies" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" | jq .
```

## Common Workflows

### Monitor Platform Health Across Deployments

1. List all JPDs to get an overview of all deployments
2. Check each JPD's `status.code` for `HEALTHY`, `DEGRADED`, or `UNHEALTHY`
3. Inspect individual JPD services for detailed health information

### Audit Licenses

1. List all JPDs
2. Review the `licenses` array on each JPD for expiration dates (`valid_through`) and `expired` status
3. Attach new licenses to JPDs as needed

# Mission Control API Reference

Base path: `/mc/api/v1/`

## JPD Instances

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/jpds` | List all JPD instances |
| GET | `/jpds/{id}` | Get specific JPD |
| POST | `/jpds/{id}/attach_license` | Attach license to JPD |

### JPD Response Object

```json
{
  "id": "string",
  "name": "string",
  "url": "https://site-a.jfrog.io",
  "status": {
    "code": "HEALTHY | DEGRADED | UNHEALTHY",
    "message": "string"
  },
  "location": {
    "city_name": "string",
    "country_code": "string",
    "latitude": 0.0,
    "longitude": 0.0
  },
  "licenses": [
    {
      "type": "Enterprise Plus",
      "valid_through": "2026-12-31T00:00:00Z",
      "expired": false
    }
  ],
  "services": [
    {
      "name": "artifactory",
      "status": "HEALTHY",
      "version": "7.125.0"
    }
  ],
  "tags": ["production", "us-east"]
}
```

### Attach License Request Body

```json
{
  "license_key": "string (required)"
}
```

## Proxies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/proxies` | List all configured proxies |

### Proxy Response Object

```json
{
  "key": "string",
  "host": "proxy.example.com",
  "port": 8080,
  "username": "string",
  "platform_default": true,
  "services": ["artifactory", "xray"]
}
```
