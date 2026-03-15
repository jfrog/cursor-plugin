# JFrog CLI -- Artifactory Commands

## Upload & Download

```bash
# Upload files
jf rt upload "build/*.jar" libs-release-local/com/example/app/1.0/ \
  --flat=false --recursive --threads=5

# Upload with file spec
jf rt upload --spec=upload-spec.json

# Upload with properties
jf rt upload "*.jar" libs-release-local/ --props="build.name=myapp;build.number=42"

# Download files
jf rt download "libs-release-local/com/example/**/*.jar" ./local/ \
  --flat=false --threads=5

# Download with file spec
jf rt download --spec=download-spec.json

# Download latest by property
jf rt download "libs-release-local/com/example/app/*" --props="release=latest" --sort-by=created --sort-order=desc --limit=1
```

## Search & Delete

```bash
# Search artifacts
jf rt search "libs-release-local/com/example/**/*.jar"

# Search with properties
jf rt search "libs-release-local/**" --props="build.name=myapp"

# Delete artifacts
jf rt delete "libs-release-local/com/example/app/1.0-SNAPSHOT/"

# Delete with confirmation prompt
jf rt delete "libs-release-local/old/**" --quiet=false
```

## Properties

```bash
# Set properties
jf rt set-props "libs-release-local/app.jar" "release.status=approved;qa.signed=true"

# Delete properties
jf rt delete-props "libs-release-local/app.jar" "release.status"
```

## Copy & Move

```bash
# Copy between repos
jf rt copy "libs-snapshot-local/app/(*)" "libs-release-local/app/{1}" --flat=false

# Move between repos
jf rt move "libs-snapshot-local/app/(*)" "libs-release-local/app/{1}"
```

## Repository Management

```bash
# Create repository (from template)
jf rt repo-create template.json

# Delete repository
jf rt repo-delete my-repo

# Generate repo template interactively
jf rt repo-template template.json
```

## Build Integration

```bash
# Collect environment variables
jf rt build-collect-env my-build 42

# Add Git info to build
jf rt build-add-git my-build 42

# Add dependencies manually
jf rt build-add-dependencies my-build 42 "libs-release-local/deps/**"

# Publish build info
jf rt build-publish my-build 42

# Promote build
jf rt build-promote my-build 42 libs-release-local --status=released

# Scan build (Xray)
jf rt build-scan my-build 42

# Discard old builds
jf rt build-discard my-build --max-builds=10

# Build Docker and collect info
jf rt build-docker-create docker-local --image-file=build-metadata \
  --build-name=my-build --build-number=42
```

## Package Manager Commands

### Maven

```bash
jf mvnc                          # Configure Maven for Artifactory
jf mvn clean install             # Run Maven with Artifactory integration
jf mvn deploy -Drevision=1.0     # Deploy Maven artifacts
```

### Gradle

```bash
jf gradlec                       # Configure Gradle
jf gradle clean build            # Run Gradle build
jf gradle artifactoryPublish     # Publish to Artifactory
```

### npm

```bash
jf npmc                          # Configure npm
jf npm install                   # Install with Artifactory
jf npm publish                   # Publish package
jf npm ci                        # Clean install
```

### Python (pip/pipenv)

```bash
jf pipc                          # Configure pip
jf pip install -r requirements.txt
jf pipenv install
```

### Go

```bash
jf goc                           # Configure Go
jf go build                      # Build with Artifactory
jf go-publish v1.0.0             # Publish Go module
```

### Docker

```bash
# Pull image through Artifactory
jf docker pull myregistry.jfrog.io/docker-virtual/nginx:latest

# Build and push
jf docker push myregistry.jfrog.io/docker-local/myapp:1.0

# Tag for Artifactory
jf docker tag myapp:latest myregistry.jfrog.io/docker-local/myapp:1.0
```

### NuGet / .NET

```bash
jf nugetc                        # Configure NuGet
jf nuget restore                 # Restore packages
jf dotnet restore                # .NET restore
```

### Terraform

```bash
jf terraform-config              # Configure Terraform registry
jf terraform publish --namespace=myorg --provider=aws --tag=v1.0
```

## Replication

```bash
# Transfer files between Artifactory instances
jf rt transfer-files source-server target-server \
  --include-repos="libs-release-local;docker-local"
```

## Curl Wrapper

```bash
# Direct API calls through jf (handles auth automatically)
jf rt curl -XGET /api/system/ping
jf rt curl -XPOST /api/search/aql -d 'items.find({"repo":"my-repo"})'
```
