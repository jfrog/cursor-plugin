// Package-type constants shared by resolver and workspace overlay.

export const PACKAGE_TYPES = [
  "npm",
  "pypi",
  "maven",
  "gradle",
  "go",
  "docker",
  "helm",
  "nuget",
];

/**
 * Session verify causes that prove the key itself is wrong. 401/403, 5xx and
 * unreachable are credential or service problems; replacing or dropping the
 * key there would discard a valid choice.
 */
export const BROKEN_KEY_CAUSES = new Set([
  "not-found",
  "package-type-mismatch",
]);

const SAFE_REPO_KEY = /^[A-Za-z0-9._-]+$/;

export function isSafeRepoKey(value) {
  return typeof value === "string" && SAFE_REPO_KEY.test(value);
}

const TYPE_PACKAGE_TYPE = {
  npm: "npm",
  pypi: "pypi",
  maven: "maven",
  gradle: "gradle",
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
