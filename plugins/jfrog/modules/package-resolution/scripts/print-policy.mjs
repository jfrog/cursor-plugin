#!/usr/bin/env node
// On-demand package-resolution policy printer.
//
// Unlike modules/*-session-start.mjs, this is NOT wired to a hook event. It is
// invoked manually (by the agent, per the pending notice) so a session that
// started "unconfigured" can load the up-to-date routing policy — resolved
// Artifactory URLs + hard rules — on demand once `jf` is configured.
//
// It delegates to the exact same `packageResolution.sessionStart(ctx)` the
// session-start hook runs, so recovery behaves identically to opening a fresh
// session: it warms ~/.jfrog/skills-cache/package-resolution.json AND triggers
// eager `jf setup` (background worker + receipt + lock) for auto-setup types.
// Safe to run repeatedly — the receipt/lock dedupe. print-policy is agent-invoked
// (not the 7s hook), so the background spawn is fine.
//
// Usage: node print-policy.mjs [workspaceRoot ...]
//   workspaceRoot: dirs to consider for the .jfrog/local overlay; defaults to cwd.
//
// stdout: the same markdown the sessionStart hook would inject, or "" when
// routing is disabled/off (mode === "off").

import process from "node:process";

import packageResolution from "./index.mjs";

function parseWorkspaceRoots() {
  const args = process.argv.slice(2);
  return args.length ? args : [process.cwd()];
}

async function main() {
  const workspaceRoots = parseWorkspaceRoots();
  const text = await packageResolution.sessionStart({ workspaceRoots });
  process.stdout.write(text?.trim() ? text : "");
}

main().catch((err) => {
  process.stderr.write(`print-policy failed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
