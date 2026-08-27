#!/usr/bin/env bash
# Verify that *.jfrog.io is reachable from inside Cursor's Agents Window sandbox.
#
# Run this script from inside the Agents Window after adding .cursor/sandbox.json.
# It probes the same hosts the ticket reporter tested via CONNECT through the
# injected sandbox proxy (HTTP_PROXY/HTTPS_PROXY).
#
# Exit 0 = all JFrog hosts reachable (sandbox.json is working)
# Exit 1 = one or more hosts blocked (sandbox.json not applied or wrong)

set -euo pipefail

HOSTS=(
  "releases.jfrog.io"
  "jfrogmldev.jfrog.io"
)

pass=0
fail=0

probe() {
  local host="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    "https://${host}/" 2>/dev/null || echo "000")

  if [[ "$code" == "000" ]]; then
    echo "FAIL  ${host}  (no response / DNS failure)"
    ((fail++)) || true
  elif [[ "$code" == "403" ]]; then
    echo "FAIL  ${host}  (403 — not on sandbox allowlist)"
    ((fail++)) || true
  else
    echo "OK    ${host}  (HTTP ${code})"
    ((pass++)) || true
  fi
}

echo "Sandbox env:"
echo "  CURSOR_SANDBOX=${CURSOR_SANDBOX:-<not set>}"
echo "  HTTP_PROXY=${HTTP_PROXY:-<not set>}"
echo ""

for host in "${HOSTS[@]}"; do
  probe "$host"
done

echo ""
if [[ $fail -eq 0 ]]; then
  echo "All hosts reachable — sandbox.json is working."
  exit 0
else
  echo "${fail} host(s) blocked. Ensure .cursor/sandbox.json contains:"
  echo '  {"networkPolicy":{"default":"deny","allow":["*.jfrog.io"]}}'
  exit 1
fi
