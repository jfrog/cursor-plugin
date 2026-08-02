// Package-type → `jf setup` package-manager family (Option C multi-package-manager
// zero-touch).
//
// Governance is keyed by Artifactory repo *type*; eager setup and rewrite
// guidance act on *package managers*. One type may own several (pypi → pip,
// pipenv, uv). Intersect with `jf setup --help` at runtime — this map is a
// ceiling, not a hardcode of CLI support.
//
// `twine` is intentionally excluded from the pypi family (publish-only; not
// part of zero-touch install routing). `yarn` and `poetry` are omitted (not
// first-class in Fly Desktop / product support). Gradle is its own Artifactory
// package type — not folded under maven.

import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/**
 * Artifactory package type → `jf setup` package-manager family
 * (ceiling; intersect with CLI help). `twine` omitted from `pypi`.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const TYPE_TO_PACKAGE_MANAGERS = Object.freeze({
  npm: Object.freeze(["npm", "pnpm"]),
  pypi: Object.freeze(["pip", "pipenv", "uv"]),
  maven: Object.freeze(["maven"]),
  gradle: Object.freeze(["gradle"]),
  go: Object.freeze(["go"]),
  docker: Object.freeze(["docker", "podman"]),
  helm: Object.freeze(["helm"]),
  nuget: Object.freeze(["nuget", "dotnet"]),
});

/**
 * `jf setup` package-manager token → PATH binary name(s). First hit wins.
 * `pip` requires the pip CLI (`pip3`/`pip`) — `jf setup pip` runs
 * `pip config set` (not a bare Python write).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const PACKAGE_MANAGER_BINARIES = Object.freeze({
  npm: ["npm"],
  pnpm: ["pnpm"],
  pip: ["pip3", "pip"],
  pipenv: ["pipenv"],
  uv: ["uv"],
  maven: ["mvn"],
  gradle: ["gradle"],
  go: ["go"],
  docker: ["docker"],
  podman: ["podman"],
  helm: ["helm"],
  nuget: ["nuget"],
  dotnet: ["dotnet"],
});

/**
 * Package managers whose `jf setup` only writes config files (settings.xml /
 * Gradle init) and never shells out to the client. Wrapper-only projects
 * (`./mvnw`, `./gradlew`) must still get zero-touch config — do not PATH-gate.
 * @type {ReadonlySet<string>}
 */
const PACKAGE_MANAGERS_SETUP_WITHOUT_CLIENT = new Set(["maven", "gradle"]);

/**
 * Package managers to attempt for a governed package type (empty if unknown).
 * @param {string} type Artifactory package type (e.g. `pypi`, `npm`)
 * @returns {readonly string[]} `jf setup` package-manager tokens for that type
 */
export function packageManagersForType(type) {
  return TYPE_TO_PACKAGE_MANAGERS[type] ?? [];
}

/**
 * Whether a package manager is eligible for eager `jf setup` w.r.t. client
 * availability. Missing required binary → skip (warn); no failed receipt.
 *
 * Uses a PATH directory walk (no `which`/`where` spawn) so sessionStart can
 * probe the full family without burning the hook budget. On Windows, also
 * tries `PATHEXT` suffixes (`.cmd`, `.exe`, …).
 *
 * Test hooks:
 * - `JFROG_TEST_ASSUME_PACKAGE_MANAGERS_PRESENT=1` → all present (unless listed missing)
 * - `JFROG_TEST_MISSING_PACKAGE_MANAGERS=uv,pipenv` → force those absent
 * Legacy aliases `JFROG_TEST_ASSUME_PMS_PRESENT` / `JFROG_TEST_MISSING_PMS` still work.
 *
 * @param {string} packageManager `jf setup` package-manager token
 * @returns {boolean}
 */
export function packageManagerBinaryOnPath(packageManager) {
  const missingRaw =
    process.env.JFROG_TEST_MISSING_PACKAGE_MANAGERS ||
    process.env.JFROG_TEST_MISSING_PMS ||
    "";
  const missing = new Set(
    missingRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (missing.has(String(packageManager).toLowerCase())) return false;
  if (
    process.env.JFROG_TEST_ASSUME_PACKAGE_MANAGERS_PRESENT === "1" ||
    process.env.JFROG_TEST_ASSUME_PMS_PRESENT === "1"
  ) {
    return true;
  }

  if (PACKAGE_MANAGERS_SETUP_WITHOUT_CLIENT.has(packageManager)) return true;

  const bins = PACKAGE_MANAGER_BINARIES[packageManager];
  if (!bins?.length) return false;
  for (const bin of bins) {
    if (binaryOnPath(bin)) return true;
  }
  return false;
}

/** @type {string[] | null} */
let cachedPathDirs = null;

/** @returns {string[]} directories from `PATH` (cached for the process) */
function pathDirs() {
  if (cachedPathDirs) return cachedPathDirs;
  cachedPathDirs = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  return cachedPathDirs;
}

/**
 * Reset PATH cache (tests that mutate PATH between checks).
 * @returns {void}
 */
export function resetPathCacheForTests() {
  cachedPathDirs = null;
}

/**
 * Basenames to try for a command on this platform.
 * Windows needs `npm.cmd` / `docker.exe` via PATHEXT; POSIX uses the bare name.
 * @param {string} bin
 * @returns {string[]}
 */
function pathCandidateNames(bin) {
  if (process.platform !== "win32") return [bin];
  const lower = bin.toLowerCase();
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  if (exts.some((ext) => lower.endsWith(ext.toLowerCase()))) return [bin];
  return [bin, ...exts.map((ext) => bin + ext.toLowerCase())];
}

/**
 * True if `bin` exists as an executable regular file in any PATH directory.
 * On Windows, also matches `bin.cmd` / `bin.exe` via PATHEXT.
 * @param {string} bin executable basename
 * @returns {boolean}
 */
function binaryOnPath(bin) {
  const names = pathCandidateNames(bin);
  for (const dir of pathDirs()) {
    for (const name of names) {
      try {
        const candidate = path.join(dir, name);
        const st = statSync(candidate);
        if (!st.isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // missing, not a file, not executable, or unreadable dir
      }
    }
  }
  return false;
}
