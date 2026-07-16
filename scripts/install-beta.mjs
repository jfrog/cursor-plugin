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

const PLUGIN_HOOKS_BUG_URL =
  "https://forum.cursor.com/t/plugin-hooks-not-loading-into-cursor-ide/156702";

const useColor =
  !process.env.NO_COLOR && (process.env.FORCE_COLOR === "1" || process.stdout.isTTY);

function paint(open, text, close = "\x1b[0m") {
  return useColor ? `${open}${text}${close}` : text;
}

const style = {
  bold: (text) => paint("\x1b[1m", text),
  dim: (text) => paint("\x1b[2m", text),
  title: (text) => paint("\x1b[1m\x1b[36m", text),
  success: (text) => paint("\x1b[32m", text),
  warn: (text) => paint("\x1b[33m", text),
  info: (text) => paint("\x1b[36m", text),
  label: (text) => paint("\x1b[2m", text),
  path: (text) => paint("\x1b[36m", text),
  url: (text) => paint("\x1b[34m", text),
  step: (text) => paint("\x1b[1m\x1b[35m", text),
  code: (text) => paint("\x1b[32m", text),
  error: (text) => paint("\x1b[1m\x1b[31m", text),
  divider: (text) => paint("\x1b[2m", text),
  bullet: (text) => paint("\x1b[33m", "•") + (useColor ? " " : " ") + text,
};

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
  if (msg) console.error(style.error(`${msg}\n`));
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

function fmtPath(p) {
  return style.path(shortPath(p));
}

function fmtLine(text) {
  if (text.startsWith("http://") || text.startsWith("https://")) return style.url(text);
  if (text.includes("→") || text.startsWith("~") || text.startsWith("/")) return style.path(text);
  return text;
}

function blank() {
  console.log("");
}

function heading(title) {
  blank();
  console.log(style.bold(title));
  console.log(style.divider("─".repeat(Math.min(title.length, 72))));
}

function step(n, title, lines = []) {
  console.log(`  ${style.step(String(n))}. ${style.bold(title)}`);
  for (const line of lines) {
    console.log(`     ${fmtLine(line)}`);
  }
}

function bullet(lines) {
  for (const line of lines) {
    console.log(`  ${style.bullet(fmtLine(line))}`);
  }
}

function printInstallHeader({ dryRun }) {
  blank();
  if (dryRun) {
    console.log(style.warn("JFrog Cursor beta — install preview (dry run)"));
  } else {
    console.log(style.success("✓ ") + style.title("JFrog Cursor beta — installed"));
  }
}

function printInstallPaths(sourceDir) {
  blank();
  console.log(`  ${style.label("Source")}   ${fmtPath(sourceDir)}`);
  console.log(`  ${style.label("Target")}   ${fmtPath(INSTALL_DIR)}`);
}

function printInstallActions(o, sourceDir) {
  if (o.dryRun) {
    blank();
    console.log(`  ${style.warn("Would run:")}`);
    bullet([`Remove ${shortPath(INSTALL_DIR)}`, `Copy ${shortPath(sourceDir)} → ${shortPath(INSTALL_DIR)}`]);
    return;
  }

  blank();
  console.log(`  ${style.success("✓")} Plugin files are in place.`);
}

function printNextSteps() {
  heading("What's next in Cursor");

  step(1, "Reload Cursor", [
    "Developer → Reload Window",
    "Or quit Cursor fully (Cmd+Q) and reopen",
  ]);

  step(2, "Turn on plugin hooks (required for sessionStart today)", [
    "Settings → Rules, Skills, Subagents",
    'Enable "Include third-party Plugins, Skills, and other configs"',
    style.dim("Skills and MCP from this plugin work without this setting."),
    style.warn("Session-start hooks do not — Cursor bug, workaround above:"),
    PLUGIN_HOOKS_BUG_URL,
  ]);

  step(3, "Open a new Agent chat");

  step(4, "Confirm the plugin loaded", [
    "Settings → Plugins → Installed",
    'Look for "JFrog Platform" (local name: jfrog-beta)',
  ]);
}

function printOptionalConfig() {
  heading("Optional — route installs through Artifactory");

  console.log(`  ${style.label("Edit")} ${fmtPath(path.join(homedir(), ".jfrog", "agents-conf.json"))}:`);
  blank();
  console.log(`    ${style.code('{ "packageResolution": { "enabled": true } }')}`);
  blank();
  console.log(`  ${style.dim("Open a new Agent chat after changing this file.")}`);
}

function printTroubleshooting() {
  heading("If the plugin does not show up");

  bullet([
    "Cloud Dashboard (cursor.com) → Settings → Security & Identity → Marketplace and Plugins",
    '→ "Allow Local Plugin Imports" → ON  (Enterprise Admins only; not in IDE Settings)',
    "Then quit Cursor fully and reopen.",
    "Also enable IDE: Settings → Rules, Skills, Subagents → Include third-party Plugins…",
    "More detail: AGENT-PACKAGE-RESOLUTION-BETA.md in this repo.",
  ]);
}

function printUninstallResult({ dryRun, wasInstalled, cloneHint }) {
  blank();
  if (dryRun) {
    console.log(style.warn("JFrog Cursor beta — uninstall preview (dry run)"));
  } else {
    console.log(style.success("✓ ") + style.title("JFrog Cursor beta — uninstalled"));
  }
  blank();
  console.log(`  ${style.label("Target")}   ${fmtPath(INSTALL_DIR)}`);

  blank();
  if (!wasInstalled) {
    console.log(`  ${style.dim("Nothing to remove — plugin was not installed.")}`);
  } else if (dryRun) {
    console.log(`  ${style.warn("Would remove the plugin directory above.")}`);
  } else {
    console.log(`  ${style.success("✓")} Plugin directory removed.`);
  }

  heading("What's next in Cursor");
  step(1, "Reload Cursor", ["Developer → Reload Window"]);

  if (cloneHint) {
    heading("Optional cleanup");
    console.log(`  ${style.dim("Remove the cloned repo if you no longer need it:")}`);
    console.log(`  ${style.code(`rm -rf ${shortPath(cloneHint)}`)}`);
  }
}

async function cmdInstall(o, sourceDir) {
  const manifest = path.join(sourceDir, ".cursor-plugin", "plugin.json");
  if (!(await exists(manifest))) {
    throw new Error(`not a Cursor plugin (missing ${manifest})`);
  }

  printInstallHeader({ dryRun: o.dryRun });
  printInstallPaths(sourceDir);

  if (o.dryRun) {
    printInstallActions(o, sourceDir);
  } else {
    await rm(INSTALL_DIR, { recursive: true, force: true });
    await mkdir(path.dirname(INSTALL_DIR), { recursive: true });
    await cp(sourceDir, INSTALL_DIR, { recursive: true, force: true });
    printInstallActions(o, sourceDir);
  }

  printNextSteps();
  printOptionalConfig();
  if (!o.dryRun) {
    printTroubleshooting();
  } else {
    blank();
    console.log(`  ${style.info("Re-run without --dry-run to install for real.")}`);
  }
}

async function cmdUninstall(o) {
  const wasInstalled = await exists(INSTALL_DIR);
  const cloneHint = (await exists(DEFAULT_CLONE)) ? DEFAULT_CLONE : null;

  if (wasInstalled && !o.dryRun) {
    await rm(INSTALL_DIR, { recursive: true, force: true });
  }

  printUninstallResult({ dryRun: o.dryRun, wasInstalled, cloneHint });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const sourceDir = path.join(o.repoPath, PLUGIN_SUBDIR);

  if (o.uninstall) {
    await cmdUninstall(o);
    return;
  }

  await cmdInstall(o, sourceDir);
}

main().catch((err) => {
  console.error(`\n${style.error("Install failed:")} ${err?.message ?? err}`);
  process.exit(1);
});
