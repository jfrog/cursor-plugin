# User Journeys -- Goal-Oriented Pattern Selection Guide

5 journeys to help you pick the right patterns based on your goals.

## Journey 1: Modernize Delivery

**Goal:** Unify artifact management and automate CI/CD from dev to deployment.

### Step 1: Unify and Control All Artifacts
- Centralize all packages and dependencies into one trusted source
- 40+ package types, intelligent caching, local/remote/virtual repos
- **Use patterns:** `repositories-basic-repository-setup`, `repositories-dependency-resolution-from-multiple-upstream-sources`

### Step 2: Enhance CI/CD Automation
- Automate linking between CI systems and artifact storage
- Full DevOps toolchain compatibility, JFrog CLI, REST API
- **Use patterns:** `builds-ci-integration-with-security-scans`, `builds-ci-integration-with-package-curation-and-security-scans`

### Step 3: Govern the Release Lifecycle
- Track every artifact across the supply chain from dev to deployment
- Integrated SCA, automated SBOM generation, Build Info and Evidence
- **Use patterns:** `release-lifecycle-management-without-security-gates`, `release-lifecycle-with-security-gates`

### Step 4: Deliver to Any Runtime Endpoint
- Automate rollout of trusted software to any runtime (cloud to edge)
- Global CDN distribution, atomic Kubernetes deployment
- **Use patterns:** `repositories-setup-for-cross-team-collaboration`, multi-site patterns

---

## Journey 2: Secure SDLC

**Goal:** Protect the software supply chain at every stage.

### Step 1: Block Risks Before They Enter
- Secure supply chain at entry point with JFrog Curation
- Automated security gate for 3rd party risk, JFrog Catalog for OSS selection
- **Use patterns:** `curation-security`

### Step 2: Secure Binaries with SCA and SBOMs
- Deep binary analysis and risk prevention with Xray
- SCA scanning, automatic SBOM generation
- **Use patterns:** `xray-security`

### Step 3: Fortify Your Code, Remediate Efficiently
- Prioritize real exploitable risks; shift left with SAST and Secrets scanners
- JFrog SAST, Contextual Analysis, Runtime monitoring
- **Use patterns:** `jas-security`, `run-time-security`

---

## Journey 3: Accelerate Productivity

**Goal:** Reduce developer friction and speed up delivery.

### Step 1: Shorten Build Cycles
- Reduce developer downtime via dependency caching and early security identification
- Reliable dependency delivery, complete build automation
- **Use patterns:** `builds-ci-integration`

### Step 2: Simplify Security Overload
- Consolidate security solutions to eliminate friction
- Pre-approved packages (Curation), security noise reduction (Contextual Analysis)
- **Use patterns:** `curation-security`, `xray-security`

### Step 3: Eliminate Context Switching
- Consolidate all context directly into the developer's IDE/workspace
- MCP + CLI + GitHub integration, unified security toolchain
- **Use patterns:** `run-time-security`

### Step 4: Automate New Package Approvals
- Automate OSS package review/approval with full auditability
- Policy-driven approval automation, curated OSS catalog
- **Use patterns:** `curation-security`, `app-trust-application-risk-management`

---

## Journey 4: Tackle Enterprise Complexity

**Goal:** Scale JFrog across a global, complex organization.

### Step 1: Achieve Architectural Agility
- Develop and deliver across any topology (SaaS, self-managed, hybrid, air-gapped)
- 99.9%+ uptime, global high-resilience sync
- **Use patterns:** `multi-site-active-active-with-geo-dns`, `multi-site-active-standby-with-dns-failover`

### Step 2: Manage Scaling Infrastructure
- Unify identity, authorization, and project management at enterprise scale
- Projects for resource isolation, centralized IAM (SSO/RBAC)
- **Use patterns:** `repositories-setup-for-cross-team-collaboration`, `repositories-dependency-resolution-from-multiple-upstream-sources`, `release-lifecycle-with-evidence`

### Step 3: Establish Enterprise Governance
- Unified compliance framework across the entire SDLC
- End-to-end audit trail, proactive risk governance
- **Use patterns:** `app-trust-application-entity-creation`, `app-trust-application-risk-management`

### Step 4: Optimize Global Distribution
- Fast, trusted software releases worldwide
- Flexible distribution, immutable Release Bundles with SBOMs
- **Use patterns:** `release-lifecycle-management-with-build-integration-security-gates-and-distribution`, `multi-site-partially-air-gapped-package-curation`, `multi-site-fully-air-gapped-package-curation`

---

## Journey 5: Deliver Trusted AI

**Goal:** Manage AI/ML assets from development to production.

### Step 1: Centralize & Govern AI Assets
- Unify all AI assets (models, datasets, MCP servers) into one hub
- Unified AI Registry, Secure AI Gateway, proactive security scanning
- **Resources:** JFrog AI Catalog, JFrog ML product page

### Step 2: Build & Deploy Models
- Bridge experimentation to production with FrogML SDK
- Model Registry, security scanning, automated deployment, A/B and Shadow Mode
- **Resources:** FrogML SDK, Model Registry documentation

### Step 3: Monitor Model Performance
- Track real-time model health and detect data drift
- Real-time dashboard, automated drift detection (KL Divergence)
- **Resources:** JFrog ML monitoring documentation

### Step 4: Turn Data Into Features
- Transform raw data into ML features with consistent training/serving
- SQL transformations (Spark SQL), automated materialization
- **Resources:** Feature Store documentation

> Note: Journey 5 primarily uses JFrog ML features and documentation links rather than the pattern system. Use the JFrog Artifactory skill for storing ML model artifacts (Generic or Docker repos).
