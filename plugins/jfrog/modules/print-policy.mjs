#!/usr/bin/env node
// On-demand package-resolution policy printer.
//
// Unlike modules/*-session-start.mjs, this is NOT wired to a hook event. It is
// invoked manually (by the agent, per the enforce notice) so a session that
// started "unconfigured" can load the up-to-date routing policy — resolved
// Artifactory URLs + hard rules — on demand once `jf` is configured.
//
// It reuses the exact feature-flag + renderer the session-start hook uses, so
// the output is identical to what the hook would inject. Running it in active
// mode also warms ~/.jfrog/skills-cache/package-resolution.json.
//
// Usage: node print-policy.mjs [workspaceRoot ...]
//   workspaceRoot: dirs to consider for the .jfrog/local overlay; defaults to cwd.
//
// stdout: the same markdown the sessionStart hook would inject, or "" when
// routing is disabled/off (mode === "off").

import process from "node:process";

import { isPackageResolutionEnabled } from "./package-resolution/scripts/feature-flag.mjs";
import { renderInstruction } from "./package-resolution/scripts/render-instruction.mjs";

function parseWorkspaceRoots() {
  const args = process.argv.slice(2);
  return args.length ? args : [process.cwd()];
}

async function main() {
  const workspaceRoots = parseWorkspaceRoots();
  const flag = await isPackageResolutionEnabled();
  const { text } = await renderInstruction(flag, { workspaceRoots });
  process.stdout.write(text?.trim() ? text : "");
}

main().catch((err) => {
  process.stderr.write(`print-policy failed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
