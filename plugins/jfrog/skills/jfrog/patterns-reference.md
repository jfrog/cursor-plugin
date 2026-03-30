# Patterns Reference

## What Are Patterns?

Patterns are recommended architectural setups for the JFrog Platform. Each pattern describes:

- **What problem it solves** and the architecture
- **JFrog concepts** involved (repos, policies, builds, etc.)
- **Difficulty level** (SIMPLE -> INTERMEDIATE -> ADVANCED)
- **What gets created** when the setup wizard runs (repos, policies, watches, projects)
- **Which skills to use** for API/CLI implementation

## Pattern Catalog (22 patterns in 6 categories)

| Category | Patterns | Levels |
|----------|----------|--------|
| [CI Integration](patterns-ci-integration.md) | 4 patterns | SIMPLE to ADVANCED |
| [Repositories](patterns-repositories.md) | 3 patterns | SIMPLE to ADVANCED |
| [Supply Chain Security](patterns-supply-chain-security.md) | 4 patterns | INTERMEDIATE to ADVANCED |
| [Release Lifecycle](patterns-release-lifecycle.md) | 4 patterns | SIMPLE to ADVANCED |
| [Multi-Site Architecture](patterns-multi-site.md) | 5 patterns | All ADVANCED |
| [AppTrust](patterns-apptrust.md) | 2 patterns | Both SIMPLE |

## Which Pattern Should I Use?

Use the 5 user journeys to pick the right patterns. See [patterns-journeys.md](patterns-journeys.md) for the full guide.

| If your goal is... | Start with... |
|---------------------|---------------|
| Centralize artifacts and automate CI/CD | CI Integration + Basic Repo Setup |
| Secure the software supply chain | Xray Security + Curation Security |
| Accelerate developer productivity | CI Integration + Curation + Contextual Analysis |
| Handle enterprise-scale multi-site | Multi-Site Active/Active or Active/Standby |
| Govern releases with compliance | Release Lifecycle + Evidence + AppTrust |
| Deploy trusted AI models | Journey 5 in [patterns-journeys.md](patterns-journeys.md) |

## Difficulty Progression

Start at SIMPLE, build up:

```
SIMPLE                    INTERMEDIATE                    ADVANCED
├── CI Integration        ├── CI + Security Scans         ├── CI + Curation + Scans
├── Basic Repo Setup      ├── Multi-Source Deps            ├── Cross-Team Collaboration
├── RLM (no gates)        ├── RLM + Security Gates         ├── RLM + Distribution
├── AppTrust Entity       ├── Xray Security               ├── JAS Advanced Security
└── AppTrust Risk Mgmt    └── RLM + Security Gates         ├── Runtime Security
                                                           ├── Curation Enforcement
                                                           ├── CI + Evidence
                                                           ├── RLM + Evidence
                                                           └── Multi-Site (5 patterns)
```

## JFrog Concepts Glossary

| Concept | Definition |
|---------|-----------|
| **Build Info** | Metadata collected by JFrog CLI during CI -- environment params, artifacts, components, SBOM |
| **Remote Repository** | Caches and proxies packages from a public/private registry |
| **Local Repository** | Hosts 1st-party artifacts deployed by your team |
| **Virtual Repository** | Logical router for a set of repos, single URL with priority resolution |
| **Federated Repository** | Mirrors artifacts and metadata across JFrog Platform Deployments (JPDs) |
| **Release Bundle** | Immutable, GPG-signed grouping of files/packages for a software release |
| **Environments** | SDLC stage aggregations (DEV, STAGING, PROD) for release promotion |
| **Distribution** | Securely distributes release binaries to Edge nodes |
| **Evidence** | Signed attestation metadata (DSSE format) for artifacts, builds, and Release Bundles |
| **Curation** | Package firewall that blocks malicious/risky OSS before it enters your Artifactory |
| **Security Policy** | Rules for security, operational risk, and license compliance with automated actions |
| **Access Federation** | Synchronizes users, groups, permissions, and tokens across federated JPDs |
| **Contextual Analysis** | Assesses whether detected CVEs are actually exploitable in your specific context |
| **SAST** | Static Application Security Testing for source code vulnerabilities |
| **Image Integrity** | Verifies container images haven't been tampered with at runtime |
| **Runtime Sensor/Controller** | Lightweight Kubernetes agents for real-time monitoring and policy enforcement |
| **Application Entity** | Business-context wrapper for packages with ownership, criticality, and lifecycle stages |

## Implementing Patterns with Skills

Each pattern maps to operations in the atomic product skills:

| Pattern operations | Use skill |
|-------------------|-----------|
| Create repos (local/remote/virtual) | `jfrog-artifactory` or `jfrog-cli` |
| Create projects, users, permissions | `jfrog-access` |
| Create Xray policies and watches | `jfrog-security` |
| Configure curation policies | `jfrog-curation` |
| Create release bundles, promote, distribute | `jfrog-distribution` |
| Attach evidence to artifacts/builds/bundles | `jfrog-distribution` (evidence section) or `jfrog-cli` |
| Deploy Workers for custom logic | `jfrog-workers` |
| Set up federated repos, access federation | `jfrog-artifactory` + `jfrog-access` |
| Create AppTrust applications and policies | `jfrog-apptrust` + `jfrog-access` |
| Monitor Kubernetes runtime | `jfrog-security` (runtime section) |

## Reference Files

- [patterns-ci-integration.md](patterns-ci-integration.md) -- 4 CI Integration patterns
- [patterns-repositories.md](patterns-repositories.md) -- 3 Repository setup patterns
- [patterns-supply-chain-security.md](patterns-supply-chain-security.md) -- 4 Security patterns
- [patterns-release-lifecycle.md](patterns-release-lifecycle.md) -- 4 Release Lifecycle patterns
- [patterns-multi-site.md](patterns-multi-site.md) -- 5 Multi-Site Architecture patterns
- [patterns-apptrust.md](patterns-apptrust.md) -- 2 AppTrust patterns
- [patterns-journeys.md](patterns-journeys.md) -- 5 user journeys (goal-oriented pattern selection)
- [flow-suggestions.md](flow-suggestions.md) -- Action-to-flow mapping with progress diagrams for post-interaction suggestions
