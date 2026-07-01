#!/usr/bin/env node
// Install the JFrog Cursor beta plugin to ~/.cursor/plugins/local/jfrog-beta
//
// Usage:
//   node scripts/install-beta.mjs
//   node scripts/install-beta.mjs --repo-path /path/to/cursor-plugin
//   node scripts/install-beta.mjs --uninstall
//   node scripts/install-beta.mjs --dry-run
//
// Copies plugins/jfrog/ into Cursor's local plugin directory (no marketplace).
// After install: Developer → Reload Window in Cursor.

import { access, cp, mkdir, rm } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(HERE, "..");
const PLUGIN_SUBDIR = path.join("plugins", "jfrog");
const LOCAL_PLUGIN_NAME = "jfrog-beta";
const DEFAULT_CLONE = path.join(homedir(), ".jfrog", "cursor-plugin-beta");
const INSTALL_DIR = path.join(homedir(), ".cursor", "plugins", "local", LOCAL_PLUGIN_NAME);

function parseArgs(argv) {
  const o = { repoPath: DEFAULT_REPO, uninstall: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo-path") o.repoPath = path.resolve(argv[++i] ?? "");
    else if (a === "--uninstall") o.uninstall = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "-h" || a === "--help") printUsage(0);
    else printUsage(2, `Unknown argument: ${a}`);
  }
  return o;
}

function printUsage(code, msg) {
  if (msg) console.error(`${msg}\n`);
  console.log(`Usage:
  node scripts/install-beta.mjs [--repo-path PATH] [--dry-run]
  node scripts/install-beta.mjs --uninstall [--dry-run]

Installs plugins/jfrog/ to ~/.cursor/plugins/local/${LOCAL_PLUGIN_NAME}/`);
  process.exit(code);
}

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function shortPath(p) {
  return p.replace(homedir(), "~");
}

function printLocalPluginReminder() {
  console.log("\nnote: if the plugin does not appear after reload, your team may block local");
  console.log("  plugin imports (Cursor Enterprise). Ask admin to enable Allow Local Plugin");
  console.log("  Imports, then Cmd+Q and reopen. See AGENT-PACKAGE-RESOLUTION-BETA.md.");
}

async function cmdInstall(o, sourceDir) {
  const manifest = path.join(sourceDir, ".cursor-plugin", "plugin.json");
  if (!(await exists(manifest))) {
    throw new Error(`not a Cursor plugin (missing ${manifest})`);
  }

  console.log(`plugin source: ${shortPath(sourceDir)}`);
  console.log(`install to:    ${shortPath(INSTALL_DIR)}`);

  if (o.dryRun) {
    console.log(`  [dry-run] rm -rf ${shortPath(INSTALL_DIR)}`);
    console.log(`  [dry-run] cp -R ${shortPath(sourceDir)} ${shortPath(INSTALL_DIR)}`);
  } else {
    await rm(INSTALL_DIR, { recursive: true, force: true });
    await mkdir(path.dirname(INSTALL_DIR), { recursive: true });
    await cp(sourceDir, INSTALL_DIR, { recursive: true, force: true });
    console.log(`  installed: ${shortPath(INSTALL_DIR)}`);
  }

  console.log("\nnext:");
  console.log("  1. In Cursor: Developer → Reload Window");
  console.log("  2. Open a new Agent chat");
  console.log("  3. Verify under Settings → Plugins → Installed");
  console.log(
    "\nenable Agent Package Resolution: set packageResolution.enabled to true in ~/.jfrog/agents-conf.json",
  );
  if (!o.dryRun) printLocalPluginReminder();
}

async function cmdUninstall(o) {
  console.log(`remove: ${shortPath(INSTALL_DIR)}`);

  if (!(await exists(INSTALL_DIR))) {
    console.log("  (not installed — nothing to remove)");
  } else if (o.dryRun) {
    console.log(`  [dry-run] rm -rf ${shortPath(INSTALL_DIR)}`);
  } else {
    await rm(INSTALL_DIR, { recursive: true, force: true });
    console.log("  removed");
  }

  const cloneHint = (await exists(DEFAULT_CLONE)) ? DEFAULT_CLONE : null;
  console.log("\nuninstalled jfrog beta local plugin.");
  console.log("reload Cursor: Developer → Reload Window");
  if (cloneHint) {
    console.log(`\noptional — remove the cloned repo:\n  rm -rf ${shortPath(cloneHint)}`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const sourceDir = path.join(o.repoPath, PLUGIN_SUBDIR);

  if (o.uninstall) {
    await cmdUninstall(o);
    return;
  }

  console.log(`repo root: ${shortPath(o.repoPath)}`);
  await cmdInstall(o, sourceDir);
}

main().catch((err) => {
  console.error(`install-beta failed: ${err?.message ?? err}`);
  process.exit(1);
});
