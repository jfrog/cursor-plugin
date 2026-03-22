---
name: JFrog Patterns
description: Use when helping users set up JFrog Platform architectures, best practices, or workflows. Covers 22 recommended patterns across CI integration, repositories, security, release lifecycle, multi-site, and AppTrust. Also covers 5 user journeys (Modernize Delivery, Secure SDLC, Accelerate Productivity, Enterprise Complexity, Trusted AI). Triggers on mentions of pattern, best practice, architecture, get started, CI integration, multi-site, release lifecycle, AppTrust, or how to set up JFrog.
---

# JFrog Patterns Skill

## Authentication

This skill does not call JFrog APIs directly. Use the product skills (jfrog-artifactory, jfrog-access, jfrog-security, jfrog-distribution, jfrog-curation, jfrog-workers) for authentication and API/CLI usage when implementing a pattern.

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
| [CI Integration](ci-integration.md) | 4 patterns | SIMPLE to ADVANCED |
| [Repositories](repositories.md) | 3 patterns | SIMPLE to ADVANCED |
| [Supply Chain Security](supply-chain-security.md) | 4 patterns | INTERMEDIATE to ADVANCED |
| [Release Lifecycle](release-lifecycle.md) | 4 patterns | SIMPLE to ADVANCED |
| [Multi-Site Architecture](multi-site.md) | 5 patterns | All ADVANCED |
| [AppTrust](apptrust.md) | 2 patterns | Both SIMPLE |

## Which Pattern Should I Use?

Use the 5 user journeys to pick the right patterns. See [journeys.md](journeys.md) for the full guide.

| If your goal is... | Start with... |
|---------------------|---------------|
| Centralize artifacts and automate CI/CD | CI Integration + Basic Repo Setup |
| Secure the software supply chain | Xray Security + Curation Security |
| Accelerate developer productivity | CI Integration + Curation + Contextual Analysis |
| Handle enterprise-scale multi-site | Multi-Site Active/Active or Active/Standby |
| Govern releases with compliance | Release Lifecycle + Evidence + AppTrust |
| Deploy trusted AI models | Journey 5 in [journeys.md](journeys.md) |

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
| Create AppTrust applications and policies | AppTrust REST APIs (in `jfrog-access`) |
| Monitor Kubernetes runtime | `jfrog-security` (runtime section) |

## Flow Encouragement (Agent Behavior)

Use [flow-suggestions.md](flow-suggestions.md) in **two situations**:

### A. After completing an action

Check whether the action is part of a larger pattern. If it is, **show progress and offer options** to continue:

1. **Acknowledge first** -- confirm the action succeeded before suggesting anything.
2. **Always show the diagram** -- render the mermaid progress diagram so the user can see where they are in the pattern. This is mandatory, not optional. Mark completed steps with `:::done` and the suggested next step with `:::next`. Prefer `flowchart LR` (horizontal) for simple sequential flows; only use `flowchart TD` for branching or multi-path architectures.
3. **Offer a selection** -- after the diagram, use the `AskQuestion` tool to present 2-3 options the user can pick from. The first option should be the natural next step in the pattern. Include at least one alternative path and always end with a "Something else" option so the user never feels locked in.
4. **Never block** -- the suggestion goes at the end of your response, after the completed work.
5. **Context-aware** -- if the user already has the next piece in place, skip that option and suggest the one after it.

### B. When the user is exploring or doesn't know what to do

If the user asks things like "what can I do?", "how do I get started?", "what should I set up?", or generally seems unsure about next steps -- use the **Getting Started** section of flow-suggestions.md. Show the appropriate journey or entry-point diagram and use `AskQuestion` to let them pick a starting point. This also applies when the user asks what they can do with their JFrog environment.

### General rules (both A and B)

- **Respect the answer** -- if the user declines or picks "something else", do not push the pattern again.
- **Graphical first** -- always show a mermaid diagram before offering options; the visual context is mandatory.

## Reference Files

- [ci-integration.md](ci-integration.md) -- 4 CI Integration patterns
- [repositories.md](repositories.md) -- 3 Repository setup patterns
- [supply-chain-security.md](supply-chain-security.md) -- 4 Security patterns
- [release-lifecycle.md](release-lifecycle.md) -- 4 Release Lifecycle patterns
- [multi-site.md](multi-site.md) -- 5 Multi-Site Architecture patterns
- [apptrust.md](apptrust.md) -- 2 AppTrust patterns
- [journeys.md](journeys.md) -- 5 user journeys (goal-oriented pattern selection)
- [flow-suggestions.md](flow-suggestions.md) -- Action-to-flow mapping with progress diagrams for post-interaction suggestions

## Official Documentation

- [JFrog Help Center](https://jfrog.com/help/home)
- [JFrog REST APIs](https://jfrog.com/help/r/jfrog-rest-apis)
- [Build Integration](https://jfrog.com/help/r/jfrog-integrations-documentation/build-integration)
- [Release Lifecycle Management](https://jfrog.com/help/r/jfrog-artifactory-documentation/release-lifecycle-management)
- [AppTrust REST APIs](https://jfrog.com/help/r/jfrog-rest-apis/apptrust-rest-apis)
