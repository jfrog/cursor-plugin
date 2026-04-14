#!/usr/bin/env bash
# Test suite for the beforeMCPExecution hook in plugins/jfrog/hooks/mcp-gate.py
# Verifies that non-entitled users are never affected, and that entitled users
# are blocked only when a non-gateway MCP is present in their config.
#
# Usage: bash scripts/test-mcp-hook.sh

set -uo pipefail

PASS=0
FAIL=0
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

SCRIPT_REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_RELATIVE="plugins/jfrog/hooks/mcp-gate.py"

# Prefer the script's repo root (post-merge). Fall back to CWD (worktree dev).
if [ -f "$SCRIPT_REPO_ROOT/$HOOK_RELATIVE" ]; then
    HOOK_SCRIPT="$SCRIPT_REPO_ROOT/$HOOK_RELATIVE"
elif [ -f "$(pwd)/$HOOK_RELATIVE" ]; then
    HOOK_SCRIPT="$(pwd)/$HOOK_RELATIVE"
else
    echo "ERROR: Hook script not found. Run from the repo root or a worktree that contains $HOOK_RELATIVE"
    exit 1
fi

# ── Fixtures ──────────────────────────────────────────────────────────────────

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Override HOME so the hook reads from our temp dir, not the real user's home
export HOME="$TMP"
mkdir -p "$TMP/.jfrog" "$TMP/.cursor" "$TMP/.vscode"

# Dynamic timestamps so the staleness check works regardless of when tests run
FRESH_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# 48 hours ago — portable across macOS and Linux
if date -v -48H +"%Y-%m-%dT%H:%M:%SZ" &>/dev/null 2>&1; then
    STALE_TS=$(date -v -48H +"%Y-%m-%dT%H:%M:%SZ")  # macOS
else
    STALE_TS=$(date -u -d "48 hours ago" +"%Y-%m-%dT%H:%M:%SZ")  # Linux
fi

ENTITLED_CACHE="{\"entitled\": true,  \"serverUrl\": \"https://example.jfrog.io\", \"serverId\": \"test-server\", \"project\": \"test-project\", \"checkedAt\": \"$FRESH_TS\"}"
NOT_ENTITLED_CACHE="{\"entitled\": false, \"serverUrl\": \"https://example.jfrog.io\", \"serverId\": \"test-server\", \"project\": \"test-project\", \"checkedAt\": \"$FRESH_TS\"}"
STALE_ENTITLED_CACHE="{\"entitled\": true,  \"serverUrl\": \"https://example.jfrog.io\", \"serverId\": \"test-server\", \"project\": \"test-project\", \"checkedAt\": \"$STALE_TS\"}"
NO_CHECKED_AT_CACHE='{"entitled": true, "serverUrl": "https://example.jfrog.io", "serverId": "test-server", "project": "test-project"}'

GATEWAY_MCP='{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "--registry", "https://releases.jfrog.io/artifactory/api/npm/npm/", "@jfrog/mcp-gateway", "--server", "test-server"],
      "env": { "_JF_MCP_LOADER_ARGS": "project=test-project&mcp=chrome-devtools-mcp" }
    }
  }
}'

MIXED_MCP='{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "--registry", "https://releases.jfrog.io/artifactory/api/npm/npm/", "@jfrog/mcp-gateway", "--server", "test-server"],
      "env": { "_JF_MCP_LOADER_ARGS": "project=test-project&mcp=chrome-devtools-mcp" }
    },
    "rogue-mcp": {
      "command": "npx",
      "args": ["--yes", "some-package"]
    }
  }
}'

ROGUE_ONLY_MCP='{
  "mcpServers": {
    "rogue-mcp": {
      "command": "npx",
      "args": ["--yes", "some-package"]
    }
  }
}'

LOCAL_BINARY_MCP='{
  "mcpServers": {
    "chrome-devtools": {
      "command": "/Users/guyes/.jfrog/bin/mcp-gateway",
      "args": ["--server", "test-server"],
      "env": { "_JF_MCP_LOADER_ARGS": "project=test-project&mcp=chrome-devtools-mcp" }
    }
  }
}'

REMOTE_JFROG_MCP='{
  "mcpServers": {
    "jfrog-remote": {
      "url": "https://example.jfrog.io/mcp"
    }
  }
}'

REMOTE_EXTERNAL_MCP='{
  "mcpServers": {
    "external-remote": {
      "url": "https://some-other-server.com/mcp"
    }
  }
}'

MIXED_REMOTE_MCP='{
  "mcpServers": {
    "jfrog-remote": {
      "url": "https://example.jfrog.io/mcp"
    },
    "external-remote": {
      "url": "https://some-other-server.com/mcp"
    }
  }
}'

# ── Helpers ───────────────────────────────────────────────────────────────────

run_hook() {
    python3 "$HOOK_SCRIPT" 2>/dev/null
}

assert() {
    local description="$1"
    local expected="$2"
    local actual="$3"
    if [ "$actual" -eq "$expected" ]; then
        echo -e "${GREEN}PASS${RESET}  $description"
        ((PASS++)) || true
    else
        echo -e "${RED}FAIL${RESET}  $description  (expected exit $expected, got $actual)"
        ((FAIL++)) || true
    fi
}

cleanup_configs() {
    rm -f "$TMP/.cursor/mcp.json" "$TMP/.vscode/mcp.json"
}

# ── Tests: non-entitled users (must never be blocked) ────────────────────────

echo "── Non-entitled users ───────────────────────────────────────────────────"

# No cache file at all (first-time user, entitlement never checked)
rm -f "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
run_hook; assert "No cache file, no mcp.json" 0 $?

# Cache present but entitled: false
echo "$NOT_ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
run_hook; assert "Cache entitled:false, no mcp.json" 0 $?

# Cache present but entitled: false, with a rogue MCP in config
echo "$NOT_ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$ROGUE_ONLY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Cache entitled:false, rogue MCP present" 0 $?

# Not entitled, remote external MCP — must still be allowed
echo "$NOT_ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$REMOTE_EXTERNAL_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Cache entitled:false, remote external MCP" 0 $?

# Corrupt cache (unreadable JSON)
echo "not-valid-json" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$ROGUE_ONLY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Corrupt cache, rogue MCP present" 0 $?

# ── Tests: stale / missing checkedAt (must never be blocked) ─────────────────

echo ""
echo "── Stale / incomplete cache ─────────────────────────────────────────────"

# Entitled but cache is 48 hours old
echo "$STALE_ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$ROGUE_ONLY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Stale entitled cache, rogue MCP present" 0 $?

# Entitled but cache is 48 hours old, gateway-only config
echo "$STALE_ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$GATEWAY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Stale entitled cache, gateway MCP only" 0 $?

# entitled: true but no checkedAt field
echo "$NO_CHECKED_AT_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$ROGUE_ONLY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "entitled:true, no checkedAt, rogue MCP" 0 $?

# ── Tests: entitled users, compliant configs (must allow) ────────────────────

echo ""
echo "── Entitled users — compliant configs ──────────────────────────────────"

# Entitled, no mcp.json at all
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
run_hook; assert "Entitled, no mcp.json" 0 $?

# Entitled, empty mcpServers
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo '{"mcpServers": {}}' > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, empty mcpServers" 0 $?

# Entitled, all MCPs via gateway (npx)
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$GATEWAY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, all MCPs via gateway (npx)" 0 $?

# Entitled, local binary
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$LOCAL_BINARY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, local binary" 0 $?

# Entitled, remote MCP pointing to org JFrog — exempt
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$REMOTE_JFROG_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, remote MCP pointing to org JFrog" 0 $?

# Entitled, gateway in .cursor + gateway in .vscode
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$GATEWAY_MCP" > "$TMP/.cursor/mcp.json"
echo "$GATEWAY_MCP" > "$TMP/.vscode/mcp.json"
run_hook; assert "Entitled, gateway MCPs in both .cursor and .vscode" 0 $?

# ── Tests: entitled users, non-compliant configs (must block) ─────────────────

echo ""
echo "── Entitled users — non-compliant configs ───────────────────────────────"

# Entitled, only a rogue MCP
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$ROGUE_ONLY_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, only rogue MCP" 1 $?

# Entitled, one gateway MCP + one rogue MCP
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$MIXED_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, gateway + rogue MCP" 1 $?

# Entitled, remote MCP pointing to external server — flagged
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$REMOTE_EXTERNAL_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, remote MCP pointing to external server" 1 $?

# Entitled, mix of org remote + external remote — flagged
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$MIXED_REMOTE_MCP" > "$TMP/.cursor/mcp.json"
run_hook; assert "Entitled, org remote + external remote" 1 $?

# ── Tests: VS Code paths ──────────────────────────────────────────────────────

echo ""
echo "── VS Code path enforcement ─────────────────────────────────────────────"

# Entitled, rogue MCP only in .vscode/mcp.json — must block
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$ROGUE_ONLY_MCP" > "$TMP/.vscode/mcp.json"
run_hook; assert "Entitled, rogue MCP in .vscode only" 1 $?

# Entitled, gateway MCP only in .vscode/mcp.json — must allow
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
cleanup_configs
echo "$GATEWAY_MCP" > "$TMP/.vscode/mcp.json"
run_hook; assert "Entitled, gateway MCP in .vscode only" 0 $?

# Entitled, gateway in .cursor, rogue in .vscode — must block
echo "$ENTITLED_CACHE" > "$TMP/.jfrog/mcp-registry-entitlement.json"
echo "$GATEWAY_MCP" > "$TMP/.cursor/mcp.json"
echo "$ROGUE_ONLY_MCP" > "$TMP/.vscode/mcp.json"
run_hook; assert "Entitled, gateway in .cursor + rogue in .vscode" 1 $?

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
