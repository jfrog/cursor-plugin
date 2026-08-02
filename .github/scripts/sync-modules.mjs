#!/usr/bin/env node
// Vendors modules bundle from jfrog-agent-hooks into plugins/jfrog/.
//
// Usage:
//   JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-modules.mjs
//
// Defaults JFROG_AGENT_HOOKS_PATH to ../jfrog-agent-hooks (sibling clone).
// Reads paths from sync-modules-vendor.json.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const vendorPath = path.join(scriptDir, "sync-modules-vendor.json");

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(fromDir, toDir, relativePath) {
  const from = path.join(fromDir, relativePath);
  const to = path.join(toDir, relativePath);
  if (!(await fileExists(from))) {
    throw new Error(`path missing in upstream: ${relativePath}`);
  }
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
  console.log(`  ${relativePath} -> ${path.relative(process.cwd(), to)}`);
}

async function main() {
  const vendor = JSON.parse(await fs.readFile(vendorPath, "utf8"));
  const paths = vendor.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${vendorPath} must define a non-empty paths array`);
  }

  const hooksRoot =
    process.env.JFROG_AGENT_HOOKS_PATH?.trim() ||
    path.resolve(repoRoot, "..", "jfrog-agent-hooks");

  if (!(await fileExists(hooksRoot))) {
    throw new Error(
      `jfrog-agent-hooks not found at ${hooksRoot}. Set JFROG_AGENT_HOOKS_PATH.`,
    );
  }

  const destPrefix = (vendor.dest_prefix ?? "").replace(/^\/+|\/+$/g, "");
  const destRoot = destPrefix ? path.join(repoRoot, destPrefix) : repoRoot;

  console.log(`--- sync from ${hooksRoot} (pin: ${vendor.pin ?? "local"}) ---`);
  for (const rel of paths) {
    await copyPath(hooksRoot, destRoot, rel);
  }
  console.log("done.");
}

await main();
