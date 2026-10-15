#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

// Starts @jfrog/agent-guard --enforce-skill. The hook string in hooks.json is only
// `node` plus this file: Cursor's hook schema has no `shell` field, so on Windows the
// command runs in cmd/PowerShell, which cannot parse a POSIX env prefix or $(date).
// It is also ONE simple command, so it stays the tail of the payload pipeline Cursor
// builds around it (MLAI-1310). This process computes the deadline, then spawns npx.
// It does not read the verdict. Exit 2 and stdout pass through. A spawn failure exits
// 1, which failClosed: false lets through.

import { spawn } from "node:child_process";
import process from "node:process";

import { isMainEntry } from "../modules/core/entry.mjs";

export const RELEASES_REGISTRY = "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";
const DEADLINE_SLACK_SEC = 25;

/**
 * @param {string} arg
 * @returns {string}
 */
export function quoteWindowsArg(arg) {
  const value = String(arg ?? "");
  if (/[\r\n]/.test(value)) {
    throw new Error("Windows spawn arg must not contain CR/LF");
  }
  const escaped = value.replace(/%/g, "%%").replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function registryFrom(env) {
  const raw = env.JFROG_AGENT_GUARD_REPO;
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  return RELEASES_REGISTRY;
}

/**
 * Spawn plan for `npx --enforce-skill`. On Windows the command is npx.cmd under
 * cmd.exe, not ComSpec, so a PowerShell ComSpec cannot parse the argument list.
 * JFROG_AGENT_GUARD_VERSION is ignored: governance must stay on the latest release.
 *
 * @param {{
 *   preferOffline?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   nowSec?: number,
 *   platform?: NodeJS.Platform,
 * }} [opts]
 */
export function resolveEnforceSpawn(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const childEnv = { ...env };
  childEnv.npm_config_fetch_retries = "0";
  childEnv.npm_config_fetch_timeout = "10000";
  if (Number.isFinite(opts.nowSec)) {
    childEnv.JF_AGENT_GUARD_ENFORCE_DEADLINE = String(Math.trunc(opts.nowSec) + DEADLINE_SLACK_SEC);
  } else {
    delete childEnv.JF_AGENT_GUARD_ENFORCE_DEADLINE;
  }

  const args = ["--yes"];
  if (opts.preferOffline === true) args.push("--prefer-offline");
  args.push(
    "--registry",
    registryFrom(env),
    "@jfrog/agent-guard",
    "--enforce-skill",
    "--client",
    "cursor",
  );

  const windows = platform === "win32";
  return {
    command: windows ? "npx.cmd" : "npx",
    args: windows ? args.map(quoteWindowsArg) : args,
    shell: windows ? "cmd.exe" : false,
    env: childEnv,
  };
}

function main() {
  /** @type {ReturnType<typeof resolveEnforceSpawn>} */
  let plan;
  try {
    plan = resolveEnforceSpawn({
      preferOffline: process.argv.slice(2).includes("--prefer-offline"),
      env: process.env,
      nowSec: Math.floor(Date.now() / 1000),
      platform: process.platform,
    });
  } catch {
    process.exit(1);
  }

  /** @type {ReturnType<typeof spawn>} */
  let child;
  try {
    child = spawn(plan.command, plan.args, {
      env: plan.env,
      shell: plan.shell,
      windowsHide: true,
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch {
    process.exit(1);
  }

  child.on("error", () => {
    process.exit(1);
  });
  // A fast exit (including a policy exit 2) can EPIPE the stdin pipe. That must
  // not replace the child's status.
  if (!child.stdin) process.exit(1);
  child.stdin.on("error", () => {});
  process.stdin.pipe(child.stdin);
  child.on("exit", (code, signal) => {
    if (signal || code === null) process.exit(1);
    process.exit(code);
  });
}

if (isMainEntry(import.meta.url)) {
  main();
}
