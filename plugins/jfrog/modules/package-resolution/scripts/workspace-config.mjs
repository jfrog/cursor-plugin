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
    const configFile = path.join(
      root,
      ".jfrog",
      "local",
      WORKSPACE_CONFIG_FILE,
    );
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
 * Read + validate the workspace config, reporting *why* it was rejected so
 * callers can surface actionable diagnostics (a silently-ignored typo in this
 * file is otherwise impossible to notice).
 *
 * @param {{ root: string, configFile: string }} pick
 * @returns {Promise<
 *   | { status: "ok", config: { repositories: Record<string, string> } }
 *   | { status: "absent" }
 *   | { status: "unreadable", error: Error }
 *   | { status: "invalid", error: Error }
 *   | { status: "empty" }
 * >}
 */
export async function loadWorkspaceConfig(pick) {
  if (!pick?.configFile) return { status: "absent" };

  let raw;
  try {
    raw = await readFile(pick.configFile, "utf8");
  } catch (err) {
    return { status: "unreadable", error: err };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { status: "invalid", error: err };
  }

  const config = normalizeWorkspaceConfig(data);
  if (!config) return { status: "empty" };
  return { status: "ok", config };
}
