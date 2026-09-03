#!/usr/bin/env node
// Vendors modules bundle from jfrog-agent-hooks into plugins/jfrog/.
//
// Usage:
//   JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-modules.mjs
//
// Defaults JFROG_AGENT_HOOKS_PATH to ../jfrog-agent-hooks (sibling clone).
// Reads paths from sync-modules-vendor.json.
//
// Optional vendor.keep: dest-relative file paths restored after sync so a
// temporary overlay (e.g. MLD-1386 core files) is not wiped until upstream
// ships them and keep is removed.

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * @param {string} destRoot
 * @param {string[]} keepRels — paths relative to destRoot
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function stashKeepFiles(destRoot, keepRels) {
  /** @type {Map<string, Buffer>} */
  const stash = new Map();
  for (const rel of keepRels) {
    if (typeof rel !== "string" || !rel.trim()) continue;
    const normalized = rel.replace(/^\/+/, "");
    const full = path.join(destRoot, normalized);
    if (!(await fileExists(full))) continue;
    stash.set(normalized, await fs.readFile(full));
  }
  return stash;
}

/**
 * @param {string} destRoot
 * @param {Map<string, Buffer>} stash
 */
export async function restoreKeepFiles(destRoot, stash) {
  for (const [rel, buf] of stash) {
    const full = path.join(destRoot, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buf);
    console.log(`  keep restored: ${rel}`);
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
  const keep = Array.isArray(vendor.keep) ? vendor.keep : [];

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
  const stash = await stashKeepFiles(destRoot, keep);
  for (const rel of paths) {
    await copyPath(hooksRoot, destRoot, rel);
  }
  await restoreKeepFiles(destRoot, stash);
  console.log("done.");
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main();
}
