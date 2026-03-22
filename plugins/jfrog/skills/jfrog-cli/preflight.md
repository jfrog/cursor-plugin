# Pre-flight Service Discovery

Run this check **once per session** after login (Step 2 of [login-flow.md](login-flow.md)) to discover which JFrog services are available. This avoids wasting time calling APIs for services that are not deployed on the target instance.

## When to Run

- Before any multi-service workflow (onboarding, pattern setup, journey execution)
- After switching environments with `jf config use`
- When the user asks "what can I do?" and the agent needs to filter suggestions

Skip this if the session only uses Artifactory (repos, artifacts, builds) -- Artifactory is always available.

## Pre-flight Script

Run all service pings in a **single parallel batch** (independent calls):

```bash
# Artifactory version and admin check (always available)
curl -s "$JFROG_URL/artifactory/api/system/version" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"

# Xray
curl -s -o /dev/null -w "%{http_code}" "$JFROG_URL/xray/api/v1/system/ping"

# Lifecycle (Release Bundles / RLM)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/lifecycle/api/v2/promotion/records?limit=1"

# AppTrust (requires explicit --server-id)
jf apptrust ping --server-id="$JFROG_SERVER_ID" 2>&1

# Curation
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/curation/api/v1/system/ping"

# User admin status
curl -s "$JFROG_URL/artifactory/api/security/users/$USERNAME" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"

# Existing projects
curl -s "$JFROG_URL/access/api/v1/projects" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN"
```

## Interpreting Results

| Service | Available if | Variable to set |
|---------|-------------|-----------------|
| Artifactory | Ping returns `OK` (always expected) | -- |
| Xray | Ping returns HTTP 200 | `JFROG_HAS_XRAY=true` |
| Lifecycle | Returns HTTP 200 (even with empty results) | `JFROG_HAS_LIFECYCLE=true` |
| AppTrust | `jf apptrust ping --server-id` prints `OK` | `JFROG_HAS_APPTRUST=true` |
| Curation | Ping returns HTTP 200 | `JFROG_HAS_CURATION=true` |
| Admin | User JSON has `"admin": true` | `JFROG_IS_ADMIN=true` |

## What to Do with Results

1. **Report to the user** with a short summary table (service name + OK / NOT AVAILABLE).
2. **Filter downstream suggestions.** When using [flow-suggestions.md](../jfrog-patterns/flow-suggestions.md), only offer paths for available services.
3. **Stop early** if a required service is missing. Example: if the user asks for AppTrust setup but `JFROG_HAS_APPTRUST` is false, inform them immediately instead of attempting API calls.
4. **Note admin status.** Operations that create projects, users, or lifecycle stages require admin privileges. If `JFROG_IS_ADMIN` is false, warn the user before attempting privileged operations.
