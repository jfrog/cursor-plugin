# Artifactory Package Types Reference

Artifactory supports 40+ package types. Below are the most common with their repository configurations.

## Docker

```json
{
  "key": "docker-local",
  "rclass": "local",
  "packageType": "docker",
  "dockerApiVersion": "V2",
  "maxUniqueTags": 0
}
```

Remote URL: `https://registry-1.docker.io/`

CLI: `jf docker push/pull`, `jf rt build-docker-create`

## Maven

```json
{
  "key": "libs-release-local",
  "rclass": "local",
  "packageType": "maven",
  "handleReleases": true,
  "handleSnapshots": false,
  "checksumPolicyType": "client-checksums",
  "snapshotVersionBehavior": "unique",
  "suppressPomConsistencyChecks": false
}
```

Remote URL: `https://repo.maven.apache.org/maven2`

CLI: `jf mvn`, `jf mvnc` (config)

## npm

```json
{
  "key": "npm-local",
  "rclass": "local",
  "packageType": "npm"
}
```

Remote URL: `https://registry.npmjs.org`

CLI: `jf npm install/publish/ci`, `jf npmc` (config)

## PyPI

```json
{
  "key": "pypi-local",
  "rclass": "local",
  "packageType": "pypi"
}
```

Remote URL: `https://files.pythonhosted.org`

Registry URL: `https://pypi.org`

CLI: `jf pip install`, `jf pipenv install`, `jf pipc` (config)

## Go

```json
{
  "key": "go-local",
  "rclass": "local",
  "packageType": "go",
  "externalDependenciesEnabled": false
}
```

Remote URL: `https://proxy.golang.org/`

CLI: `jf go build/publish`, `jf goc` (config)

## Helm

```json
{
  "key": "helm-local",
  "rclass": "local",
  "packageType": "helm"
}
```

Remote URL: `https://charts.helm.sh/stable` (or custom chart repo)

CLI: `jf rt upload *.tgz helm-local/`

## NuGet

```json
{
  "key": "nuget-local",
  "rclass": "local",
  "packageType": "nuget",
  "forceNugetAuthentication": true
}
```

Remote URL: `https://www.nuget.org/api/v2` (V2) or `https://api.nuget.org/v3/index.json` (V3)

CLI: `jf nuget`, `jf nugetc` (config), `jf dotnet`

## Gradle

Uses Maven repo type with Gradle-specific layout.

CLI: `jf gradle`, `jf gradlec` (config)

## Generic

```json
{
  "key": "generic-local",
  "rclass": "local",
  "packageType": "generic"
}
```

For any file type not covered by a specific package type.

CLI: `jf rt upload/download`

## Terraform

```json
{
  "key": "terraform-local",
  "rclass": "local",
  "packageType": "terraform"
}
```

Remote URL: `https://registry.terraform.io/`

CLI: `jf terraform publish/config`

## Cargo (Rust)

```json
{
  "key": "cargo-local",
  "rclass": "local",
  "packageType": "cargo",
  "cargoInternalIndex": true
}
```

Remote URL: `https://github.com/rust-lang/crates.io-index`

## OCI

```json
{
  "key": "oci-local",
  "rclass": "local",
  "packageType": "oci"
}
```

For OCI-compliant container images and artifacts.

## Debian

```json
{
  "key": "debian-local",
  "rclass": "local",
  "packageType": "debian",
  "debianTrivialLayout": false
}
```

Deploy with layout metadata:

```bash
PUT /debian-local/pool/my-package.deb;deb.distribution=focal;deb.component=main;deb.architecture=amd64
```

## RPM

```json
{
  "key": "rpm-local",
  "rclass": "local",
  "packageType": "rpm",
  "yumRootDepth": 0,
  "calculateYumMetadata": true
}
```

## Alpine

```json
{
  "key": "alpine-local",
  "rclass": "local",
  "packageType": "alpine"
}
```

## Conan (C/C++)

```json
{
  "key": "conan-local",
  "rclass": "local",
  "packageType": "conan"
}
```

Remote URL: `https://center.conan.io`

## Swift

```json
{
  "key": "swift-local",
  "rclass": "local",
  "packageType": "swift"
}
```

## Pub (Dart/Flutter)

```json
{
  "key": "pub-local",
  "rclass": "local",
  "packageType": "pub"
}
```

Remote URL: `https://pub.dev`

## Virtual Repository Pattern

For any package type, the virtual repo aggregates local + remote:

```json
{
  "key": "{type}-virtual",
  "rclass": "virtual",
  "packageType": "{type}",
  "repositories": ["{type}-local", "{type}-remote"],
  "defaultDeploymentRepo": "{type}-local"
}
```

Resolution order: repos are tried in array order. First match wins.
