// Workspace-local repo overrides — `.jfrog/local/package-resolution.json`
// Schema: `{ "repositories": { "<pkgType>": "<repoKey>", ... } }` only.
//
// Multi-root: first root (in harness order) that has the file wins.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_CONFIG_FILE = "package-resolution.json";

/**
 * First workspace root that has `.jfrog/local/package-resolution.json`.
 *
 * @param {string[]} workspaceRoots
 * @returns {{ root: string, configFile: string } | null}
 */
export function pickWorkspaceConfigRoot(workspaceRoots) {
  if (!workspaceRoots?.length) return null;
  for (const root of workspaceRoots) {
    if (typeof root !== "string" || !root) continue;
    const configFile = path.join(root, ".jfrog", "local", WORKSPACE_CONFIG_FILE);
    if (existsSync(configFile)) {
      return { root, configFile };
    }
  }
  return null;
}

function normalizeWorkspaceConfig(data) {
  if (!data?.repositories || typeof data.repositories !== "object") return null;
  const repositories = {};
  for (const [type, repoKey] of Object.entries(data.repositories)) {
    if (typeof repoKey === "string" && repoKey) repositories[type] = repoKey;
  }
  if (!Object.keys(repositories).length) return null;
  return { repositories };
}

/**
 * @param {{ root: string, configFile: string }} pick
 * @returns {Promise<{ repositories: Record<string, string> } | null>}
 */
export async function loadWorkspaceConfig(pick) {
  if (!pick?.configFile) return null;
  try {
    const raw = await readFile(pick.configFile, "utf8");
    return normalizeWorkspaceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}
