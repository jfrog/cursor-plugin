#!/usr/bin/env python
"""
beforeMCPExecution enforcement gate for Cursor Enterprise.

Blocks any MCP tool call whose server is not routed through the JFrog MCP
Gateway when the user has MCP Registry entitlement. Non-entitled users are
never blocked.

Exit codes:
  0 — allow the MCP call
  1 — block the MCP call (prints reason to stdout)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

CACHE_PATH = os.path.expanduser("~/.jfrog/mcp-registry-entitlement.json")
CACHE_MAX_AGE_HOURS = 24

MCP_CONFIG_PATHS = [
    os.path.expanduser("~/.cursor/mcp.json"),
    os.path.join(os.getcwd(), ".cursor", "mcp.json"),
    os.path.expanduser("~/.vscode/mcp.json"),
    os.path.join(os.getcwd(), ".vscode", "mcp.json"),
]


def load_cache():
    """Load and return the entitlement cache, or None if missing/corrupt."""
    if not os.path.exists(CACHE_PATH):
        return None
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except Exception:
        return None


def is_cache_fresh(cache):
    """Return True if the cache was written within the last 24 hours."""
    checked_at = cache.get("checkedAt")
    if not checked_at:
        return False
    try:
        ts = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - ts <= timedelta(hours=CACHE_MAX_AGE_HOURS)
    except (ValueError, TypeError):
        return False


def is_remote_mcp_exempt(server, org_server_url):
    """
    Return True if a remote/SSE MCP (url-only, no args) should be exempt.
    Remote MCPs pointing to the org's own JFrog instance are allowed.
    """
    url = server.get("url", "")
    if not org_server_url:
        return False
    # Normalize: strip trailing slash for comparison
    return org_server_url.rstrip("/") in url


def scan_violations(cache):
    """
    Scan all MCP config files and return a list of non-compliant server names.
    """
    org_server_url = cache.get("serverUrl", "")
    violations = []

    for config_path in MCP_CONFIG_PATHS:
        if not os.path.exists(config_path):
            continue
        try:
            with open(config_path) as f:
                config = json.load(f)
        except Exception:
            continue

        for name, server in config.get("mcpServers", {}).items():
            # Remote/SSE MCP: has "url" field, no "args"
            if "url" in server and "args" not in server:
                if not is_remote_mcp_exempt(server, org_server_url):
                    violations.append(name)
                continue

            # Command-based MCP: gateway can be invoked via npx (package name
            # in args) or as a local binary (path in command field).
            command = server.get("command", "")
            args = " ".join(server.get("args", []))
            is_local_binary = "mcp-gateway" in os.path.basename(command)
            is_npx_gateway = "@jfrog/mcp-gateway" in args
            if not is_local_binary and not is_npx_gateway:
                violations.append(name)

    return violations


def main():
    cache = load_cache()

    # No cache — entitlement never checked, allow everything
    if cache is None:
        sys.exit(0)

    # Not entitled — no gateway enforcement
    if not cache.get("entitled", False):
        sys.exit(0)

    # Entitled but cache is stale — treat as not entitled, allow everything
    if not is_cache_fresh(cache):
        sys.exit(0)

    # Entitled and cache is fresh — enforce gateway-only policy
    violations = scan_violations(cache)

    if violations:
        print(
            "Some servers need to be reinstalled through the JFrog MCP Registry "
            "before they can run: "
            + ", ".join(violations)
            + ". Ask me to remove and re-add them."
        )
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
