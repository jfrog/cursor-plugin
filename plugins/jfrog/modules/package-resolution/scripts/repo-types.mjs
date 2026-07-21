// Package-type constants shared by resolver and workspace overlay.

export const PACKAGE_TYPES = ["npm", "pypi", "maven", "go", "docker", "helm", "nuget"];

const TYPE_PACKAGE_TYPE = {
  npm: "npm",
  pypi: "pypi",
  maven: "maven",
  go: "go",
  docker: "docker",
  helm: "helm",
  nuget: "nuget",
};

export function repoMatchesPackageType(config, type) {
  const expected = TYPE_PACKAGE_TYPE[type];
  if (!expected || !config?.packageType) return true;
  return String(config.packageType).toLowerCase() === expected;
}
