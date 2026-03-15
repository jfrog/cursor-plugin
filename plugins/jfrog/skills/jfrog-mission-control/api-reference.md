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
