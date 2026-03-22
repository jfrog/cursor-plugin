# jfrog

JFrog Platform integration for Cursor — artifact management, security scanning, and supply-chain best practices.

## Prerequisites

1. **JFrog Platform** access (Cloud or self-hosted).
2. An admin must **enable the JFrog MCP Server** on the platform (Cloud/SaaS only):
   - Navigate to **Administration > General > Settings** in the JFrog UI.
   - Toggle the **MCP Server** option ON and save.
3. Set the `JFROG_PLATFORM_URL` environment variable to your JFrog instance (e.g., `mycompany.jfrog.io`).
4. **JFrog CLI** (`jf`) is used by several skills for authentication and REST API operations. It will be installed automatically if missing. Install manually via `brew install jfrog-cli` or the [official install script](https://jfrog.com/help/r/jfrog-cli/install-the-jfrog-cli).

Authentication is handled automatically — **OAuth** for MCP-based workflows, **browser-based login** (`jf config`) for CLI/REST-based skills. No manual API keys or tokens required.

## Included

| Component | Path | Description |
|---|---|---|
| **MCP** | `mcp.json` | Remote JFrog MCP server (OAuth, no API keys) |
| **Rule** | `rules/jfrog-security.mdc` | Supply-chain security practices for dependency files |
| **Agent** | `agents/supply-chain-security.md` | Dependency audit for CVEs, licenses, and curation |

### Skills

| Skill | Triggers when you mention... |
|-------|------------------------------|
| **jfrog-artifactory** | artifactory, repository, artifact, deploy, docker registry, build info, AQL, replication, federation |
| **jfrog-security** | xray, vulnerability, CVE, scan, policy, watch, violation, SBOM, SAST, secrets detection |
| **jfrog-access** | access token, permission, user, group, project, RBAC, authentication, authorization |
| **jfrog-distribution** | distribution, release bundle, promote, environment, edge node, release lifecycle, evidence |
| **jfrog-curation** | curation, package firewall, blocked package, curated repository, waiver, supply chain |
| **jfrog-apptrust** | apptrust, application entity, application version, trusted release, promote version, rollback |
| **jfrog-runtime** | runtime, runtime cluster, running images, runtime sensor, container monitoring, node health |
| **jfrog-mission-control** | mission control, JPD, platform deployment, license, proxy, deployment health |
| **jfrog-workers** | worker, serverless, event hook, TypeScript worker, BEFORE_DOWNLOAD, custom logic |
| **jfrog-cli** | jf command, jfrog cli, jf rt, jf audit, jf scan, jf docker, file spec |
| **jfrog-patterns** | pattern, best practice, architecture, get started, CI integration, multi-site, AppTrust |

## MCP Capabilities

The JFrog MCP Server provides:

- **Resource Management** — create and manage projects and repositories
- **Artifact Search** — AQL queries to find artifacts across your organization
- **Catalog & Curation** — package info, vulnerability status, curation compliance
- **Security Monitoring** — real-time DevSecOps reports and CVE tracking
