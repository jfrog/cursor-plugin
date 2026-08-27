#!/usr/bin/env bash
# Verify that *.jfrog.io is reachable from inside Cursor's Agents Window sandbox.
#
# Run this script from inside the Agents Window after adding .cursor/sandbox.json.
# It probes the same hosts the ticket reporter tested via CONNECT through the
# injected sandbox proxy (HTTP_PROXY/HTTPS_PROXY).
#
# Exit 0 = all hosts behaved as expected (sandbox.json is working, no regressions)
# Exit 1 = one or more hosts failed
# Exit 2 = not actually running inside the sandbox, so the result would be meaningless

set -euo pipefail

# Hosts that should be covered by the *.jfrog.io allow entry.
# Only stable JFrog infrastructure hostnames are listed here; ephemeral trial
# instances (e.g. trialjfrogmlv22.jfrog.io) would produce false failures once
# deprovisioned.
JFROG_HOSTS=(
  "releases.jfrog.io"
  "download.jfrog.io"
  "entplus.jfrog.io"
)

# Hosts the ticket confirmed as already allowed by Cursor's defaults — must stay
# reachable after adding sandbox.json, otherwise the workspace policy regressed them.
CONTROL_HOSTS=(
  "registry.npmjs.org"
  "pypi.org"
  "nodejs.org"
)

command -v curl >/dev/null 2>&1 || { echo "curl is required but not found"; exit 1; }

fail=0

# The sandbox proxy blocks a CONNECT tunnel by closing the connection, which
# makes curl exit with code 56 (recv failure) and %{http_code} returns "000".
# A legitimate server-side 403 (e.g. auth required) means the CONNECT tunnel
# succeeded and the host IS reachable — treat it as allowed, not blocked.
probe() {
  local host="$1" want="$2" code
  # Do not `|| echo "000"`: on CONNECT-close curl already writes http_code 000
  # and exits 56, so that would concatenate to 000000 and look reachable.
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    "https://${host}/" 2>/dev/null) || true

  local blocked=0
  [[ -z "$code" || "$code" == "000" ]] && blocked=1

  if [[ "$want" == "allow" ]]; then
    if (( blocked )); then
      echo "FAIL  ${host}  (blocked — expected reachable; code=${code})"
      ((fail++)) || true
    else
      echo "OK    ${host}  (HTTP ${code})"
    fi
  else
    if (( blocked )); then
      echo "OK    ${host}  (still blocked, as expected; code=${code})"
    else
      echo "FAIL  ${host}  (reachable — expected blocked; code=${code})"
      ((fail++)) || true
    fi
  fi
}

echo "Sandbox env:"
echo "  CURSOR_SANDBOX=${CURSOR_SANDBOX:-<not set>}"
echo "  HTTP_PROXY=${HTTP_PROXY:-<not set>}"
echo "  HTTPS_PROXY=${HTTPS_PROXY:-<not set>}"
echo ""

if [[ "${CURSOR_SANDBOX:-}" != "seatbelt" ]]; then
  echo "WARNING: CURSOR_SANDBOX is not \"seatbelt\" — this shell is not inside Cursor's"
  echo "Agents Window sandbox, so hosts will look reachable regardless of sandbox.json."
  echo "Run this from inside the Agents Window to actually verify the fix."
  exit 2
fi

echo "-- *.jfrog.io hosts (should now be allowed) --"
for host in "${JFROG_HOSTS[@]}"; do
  probe "$host" "allow"
done

echo ""
echo "-- control hosts (should remain allowed by Cursor's defaults) --"
for host in "${CONTROL_HOSTS[@]}"; do
  probe "$host" "allow"
done

echo ""
if [[ $fail -eq 0 ]]; then
  echo "All hosts behaved as expected — sandbox.json is working, no regressions."
  exit 0
else
  echo "${fail} host(s) failed. If a jfrog.io host is still blocked, check for an"
  echo "org-level (team-admin) Cursor network policy — it replaces the workspace/user"
  echo "allow-list union rather than merging with it, per Cursor's sandbox docs."
  exit 1
fi
