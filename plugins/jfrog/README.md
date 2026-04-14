# jfrog

JFrog Platform integration for Cursor — artifact management, security scanning, and supply-chain best practices.

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted).
2. An admin must **enable the JFrog MCP Server** on the platform (Cloud/SaaS only):
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g., `mycompany.jfrog.io`).
4. **JFrog CLI** (`jf`) is used by several skills for authentication and REST API operations. Install via `brew install jfrog-cli` (macOS), `curl -fL https://install-cli.jfrog.io | sh` (Linux), `choco install jfrog-cli` (Windows), or the [official install page](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli).

Authentication is handled automatically — **OAuth** for MCP-based workflows, **browser-based login** (`jf config`) for CLI/REST-based skills. No manual API keys or tokens required.

## Included

| Component | Path | Description |
|---|---|---|
| **MCP** | `mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Skill** | `skills/jfrog/` | Unified AI skill — see [Skills](#skills) below |
| **Rule** | `rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |

### Skills

Single unified skill (`skills/jfrog/SKILL.md`) with 22 supporting reference and pattern files covering Artifactory, Security/Xray, Access, Distribution, Curation, AppTrust, Runtime, Mission Control, Workers, CLI, and architectural patterns.

| Triggers when you mention... |
|------------------------------|
| any JFrog product, artifactory, xray, security, access token, curation, distribution, release bundle, apptrust, runtime, mission control, worker, jf command, pattern, best practice |

## MCP Capabilities

The JFrog MCP Server provides:

- **Resource Management** — create and manage projects and repositories
- **Artifact Search** — AQL queries to find artifacts across your organization
- **Catalog & Curation** — package info, vulnerability status, curation compliance
- **Security Monitoring** — real-time DevSecOps reports and CVE tracking
