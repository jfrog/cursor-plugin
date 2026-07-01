#!/usr/bin/env node
// Vendors jfrog-setup-package-managers skill from jfrog-agent-hooks into plugins/jfrog/skills/.
//
// Usage:
//   JFROG_AGENT_HOOKS_PATH=/path/to/jfrog-agent-hooks node .github/scripts/sync-package-resolution-skill.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const skillName = "jfrog-setup-package-managers";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const hooksRoot =
    process.env.JFROG_AGENT_HOOKS_PATH?.trim() ||
    path.resolve(repoRoot, "..", "jfrog-agent-hooks");

  const from = path.join(hooksRoot, "skill", skillName);
  const to = path.join(repoRoot, "plugins", "jfrog", "skills", skillName);

  if (!(await fileExists(from))) {
    throw new Error(`skill missing at ${from}. Set JFROG_AGENT_HOOKS_PATH.`);
  }

  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
  console.log(`  ${skillName} -> ${path.relative(process.cwd(), to)}`);
  console.log("done.");
}

await main();
