# JFrog CLI -- Security Commands

## Project Audit

Scans project dependencies for vulnerabilities, license compliance, and operational risks.

```bash
# Basic audit (scans current project)
jf audit

# Audit with watches (applies your Xray policies)
jf audit --watches=prod-watch

# Audit specific project type
jf audit --mvn      # Maven project
jf audit --npm      # npm project
jf audit --pip      # Python project
jf audit --go       # Go project
jf audit --gradle   # Gradle project
jf audit --nuget    # .NET project

# Audit with minimum severity filter
jf audit --min-severity=High

# Audit with fail on specific severity (for CI gates)
jf audit --fail=true
```

### Advanced Security (JAS) Flags

```bash
# Enable all JAS features
jf audit --watches=prod-watch

# SAST scanning
jf audit --sast

# Secrets detection
jf audit --secrets

# Infrastructure as Code scanning
jf audit --iac

# Combine multiple
jf audit --sast --secrets --iac
```

## Binary Scanning

Scan individual files or Docker images without a project context.

```bash
# Scan a JAR/WAR file
jf scan ./myapp-1.0.jar

# Scan with minimum severity
jf scan ./myapp.jar --min-severity=High

# Scan a directory of artifacts
jf scan ./build/output/

# Scan with watches (apply policies)
jf scan ./myapp.jar --watches=prod-watch
```

## Docker Scanning

```bash
# Scan a Docker image
jf docker scan myapp:latest

# Scan with severity filter
jf docker scan myapp:1.0 --min-severity=Critical

# Scan with watches
jf docker scan myapp:1.0 --watches=docker-watch
```

## Build Scanning

```bash
# Scan a published build
jf rt build-scan my-build 42

# Scan build with fail option (for CI)
jf rt build-scan my-build 42 --fail=true
```

## Curation Audit

Check if your project's dependencies comply with Curation policies.

```bash
# Audit against curation policies
jf curation-audit

# Curation audit for specific package manager
jf curation-audit --npm
jf curation-audit --pip
jf curation-audit --mvn
```

## SBOM Export

```bash
# Generate SBOM for a build
jf sbom --build-name=my-build --build-number=42 --format=cyclonedx

# SBOM for Docker image
jf sbom --image=myapp:1.0 --format=spdx
```

## Output Formats

```bash
# JSON output (for CI/CD integration)
jf audit --format=json

# Table output (default, human-readable)
jf audit --format=table

# Simple text output
jf audit --format=simple-json
```

## CI/CD Integration Pattern

```bash
# Typical CI pipeline security gate
jf audit --fail=true --min-severity=High
if [ $? -ne 0 ]; then
  echo "Security violations found. Build blocked."
  exit 1
fi
```
