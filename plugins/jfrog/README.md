# jfrog

JFrog Platform integration for Cursor — artifact management, security scanning, and supply-chain best practices.

## Prerequisites

1. **JFrog Cloud (SaaS) subscription** with admin access.
2. An admin must **enable the JFrog MCP Server** on the platform:
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g., `mycompany.jfrog.io`).

Authentication is handled via **OAuth** — no API keys required.

## Included

- `mcp.json`: JFrog remote MCP server (connects to `https://<your-instance>/mcp`)
- `skills/jfrog-platform/`: Skill for interacting with JFrog Platform via MCP
- `rules/jfrog-security.mdc`: Supply-chain security practices for dependency files
- `agents/supply-chain-security.md`: Dependency audit agent for vulnerabilities, licenses, and curation

## MCP Capabilities

The JFrog MCP Server provides:

- **Resource Management** — create and manage projects and repositories
- **Artifact Search** — AQL queries to find artifacts across your organization
- **Catalog & Curation** — package info, vulnerability status, curation compliance
- **Security Monitoring** — real-time DevSecOps reports and CVE tracking
