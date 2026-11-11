#!/usr/bin/env node
// Agent Guard launcher for the skill-governance hooks.
//   node enforce-skill.mjs --client <claude-code|cursor|vscode> [--prefer-offline]
//
// Starts `npx @jfrog/agent-guard --enforce-skill --client <name> [--server <id>]`.
// The server is the jf CLI one Agent Guard would pick on its own. The hook
// string is only `node` plus this file: VS Code (and Claude Code without Git
// Bash) runs hook strings with PowerShell on Windows, which cannot parse a POSIX
// env prefix or $(date). This process computes the deadline, bounds the npm
// fetch, then spawns npx. It does not read the verdict: Agent Guard's exit 0
// or 2 passes through with its stdout.
//
// On Windows it runs npm's npx-cli.js with node and no shell, so arguments
// arrive intact. Only when npm is not beside node.exe does it fall back to
// npx.cmd under cmd.exe, and then it refuses an argument cmd.exe cannot carry
// (%, ", CR/LF) rather than mangle it, except the optional server id, which it
// leaves out.
//
// Every other outcome (bad argv, spawn failure, signal, any other exit code)
// fails open in the shape the client reads as "allow", see FAIL_OPEN. Agent
// Guard's own stderr always reaches the client; the launcher adds a line naming
// the cause except where the client would show it to the user, see FAIL_OPEN.
// Each fail-open is also logged to agent-hooks.log; an allow or block is not,
// since PreToolUse fires on every Read.
//
// Unlike rewrite-mcp-json, the Agent Guard version is never pinned, so a
// governance fix reaches users without a plugin release:
// JFROG_AGENT_GUARD_VERSION and JFROG_AGENT_GUARD_BIN are ignored.
// JFROG_AGENT_GUARD_REPO still redirects the registry.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isMainEntry } from "./entry.mjs";
import { createLogger } from "./logger.mjs";
import {
  AGENT_GUARD_PACKAGE,
  listJfCliServers,
  pickDefaultJfCliServer,
  resolveAgentGuardNpmRegistry,
} from "./rewrite-mcp-json.mjs";

const log = createLogger("enforce-skill");

export const DEADLINE_SLACK_SEC = 25;
export const NPM_FETCH_RETRIES = "0";
export const NPM_FETCH_TIMEOUT_MS = "10000";

/**
 * How each client reads a launcher that could not get a verdict. Exit 2 is the
 * only deliberate block everywhere. Claude Code treats any other non-zero exit
 * as a non-blocking error and shows its stderr, so it keeps exit 1. VS Code's
 * PreToolUse denies on any other non-zero exit, and Cursor reads its answer
 * from stdout, so both get an empty JSON answer and exit 0.
 *
 * `notice` adds failOpenMessage to stderr. Claude Code shows a non-blocking
 * error's stderr to the user, and claude-plugin's hook printed nothing of its
 * own, so it gets none and its user-facing text is unchanged. VS Code and
 * Cursor keep stderr in their hook output log, where the line helps debugging.
 */
export const FAIL_OPEN = Object.freeze({
  "claude-code": Object.freeze({ code: 1, stdout: "", notice: false }),
  cursor: Object.freeze({ code: 0, stdout: "{}", notice: true }),
  vscode: Object.freeze({ code: 0, stdout: "{}", notice: true }),
});

/**
 * Without a known client, `{}` with exit 0 is an allow for every client, and
 * the notice names the miswiring.
 */
export const FAIL_OPEN_UNKNOWN_CLIENT = Object.freeze({
  code: 0,
  stdout: "{}",
  notice: true,
});

export const CLIENTS = Object.freeze(Object.keys(FAIL_OPEN));

/**
 * The stderr line for a fail-open, worded as vscode-plugin's launcher words it.
 *
 * @param {string} cause
 * @returns {string}
 */
export function failOpenMessage(cause) {
  return `[jfrog-agent-guard] skill governance did not run (${cause}); this skill was not governed.\n`;
}

/**
 * @param {string | undefined} client
 * @returns {{ code: number, stdout: string, notice: boolean }}
 */
export function failOpenFor(client) {
  return Object.hasOwn(FAIL_OPEN, client ?? "")
    ? FAIL_OPEN[/** @type {keyof typeof FAIL_OPEN} */ (client)]
    : FAIL_OPEN_UNKNOWN_CLIENT;
}

/**
 * @param {string[]} argv — process.argv.slice(2)
 * @returns {{ client: string, preferOffline: boolean }}
 * @throws {Error} on a missing or unknown --client, or an unknown argument
 */
export function parseEnforceArgs(argv) {
  let client;
  let preferOffline = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prefer-offline") {
      preferOffline = true;
    } else if (arg === "--client") {
      client = argv[++i];
    } else {
      throw new Error(`unknown argument: ${JSON.stringify(arg)}`);
    }
  }
  if (!CLIENTS.includes(client ?? "")) {
    throw new Error(
      `--client must be one of ${CLIENTS.join(", ")}: ${JSON.stringify(client)}`,
    );
  }
  return { client, preferOffline };
}

/**
 * npm's npx entry point, installed next to node.exe by the Windows Node
 * installer. Running it with node needs no shell, unlike npx.cmd.
 *
 * @param {string} execPath
 * @param {(p: string) => boolean} [exists]
 * @returns {string | undefined}
 */
export function bundledNpxCli(execPath, exists = existsSync) {
  const cli = path.win32.join(
    path.win32.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  return exists(cli) ? cli : undefined;
}

/**
 * Quote one argument for the npx.cmd fallback under `cmd.exe /d /s /c`. That
 * command line has no escape for `%` (`%%` stays literal, `%VAR%` expands) and
 * none for `"` inside quotes, so an argument holding either is refused.
 *
 * @param {string} arg
 * @returns {string}
 * @throws {Error} when the argument holds `%`, `"`, CR or LF
 */
export function quoteCmdArg(arg) {
  const value = String(arg ?? "");
  if (/[\r\n%"]/.test(value)) {
    throw new Error(
      `cmd.exe cannot carry this argument intact: ${JSON.stringify(value)}`,
    );
  }
  return `"${value}"`;
}

/**
 * The jf CLI server Agent Guard picks when run without `--server`: the only
 * one configured, or the default. With JFROG_URL set it uses env credentials
 * instead, so there is nothing to pass.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} the server id, or "" when Agent Guard should choose
 */
export function defaultServerId(env = process.env) {
  if (env.JFROG_URL) return "";
  const picked = pickDefaultJfCliServer(listJfCliServers({ env }));
  return "serverId" in picked ? picked.serverId : "";
}

/**
 * Spawn plan for `npx --enforce-skill`. POSIX runs npx with no shell. Windows
 * runs npx-cli.js with node, falling back to npx.cmd under cmd.exe (not
 * ComSpec, which may be PowerShell) only when npm is not beside node.exe.
 * The optional `serverId` follows `--client`; the cmd.exe fallback omits it when
 * cmd.exe cannot carry it, since the id is never worth failing open over.
 *
 * @param {{
 *   client: string,
 *   preferOffline?: boolean,
 *   serverId?: string,
 *   env?: NodeJS.ProcessEnv,
 *   nowSec?: number,
 *   platform?: NodeJS.Platform,
 *   execPath?: string,
 *   exists?: (p: string) => boolean,
 * }} opts
 * @returns {{ command: string, args: string[], shell: "cmd.exe" | false, env: NodeJS.ProcessEnv }}
 * @throws {Error} when the cmd.exe fallback cannot carry an argument
 */
export function resolveEnforceSpawn(opts) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const execPath = opts.execPath ?? process.execPath;
  const childEnv = {
    ...env,
    npm_config_fetch_retries: NPM_FETCH_RETRIES,
    npm_config_fetch_timeout: NPM_FETCH_TIMEOUT_MS,
  };
  // An inherited absolute deadline would pin this run to an earlier instant.
  if (Number.isFinite(opts.nowSec)) {
    childEnv.JF_AGENT_GUARD_ENFORCE_DEADLINE = String(
      Math.trunc(opts.nowSec) + DEADLINE_SLACK_SEC,
    );
  } else {
    delete childEnv.JF_AGENT_GUARD_ENFORCE_DEADLINE;
  }

  const args = ["--yes"];
  if (opts.preferOffline === true) args.push("--prefer-offline");
  args.push(
    "--registry",
    resolveAgentGuardNpmRegistry(env),
    AGENT_GUARD_PACKAGE,
    "--enforce-skill",
    "--client",
    opts.client,
  );

  const server =
    opts.serverId && !opts.serverId.startsWith("--")
      ? ["--server", opts.serverId]
      : [];
  if (platform !== "win32") {
    return {
      command: "npx",
      args: [...args, ...server],
      shell: false,
      env: childEnv,
    };
  }
  const cli = bundledNpxCli(execPath, opts.exists);
  if (cli) {
    return {
      command: execPath,
      args: [cli, ...args, ...server],
      shell: false,
      env: childEnv,
    };
  }
  const quoted = args.map(quoteCmdArg);
  try {
    quoted.push(...server.map(quoteCmdArg));
  } catch {
    // cmd.exe cannot carry this id; Agent Guard resolves the server itself.
  }
  return {
    command: "npx.cmd",
    args: quoted,
    shell: "cmd.exe",
    env: childEnv,
  };
}

/**
 * Runs Agent Guard with the hook payload on its stdin and resolves the
 * launcher's exit code: the child's 0 or 2 with its stdout, otherwise the
 * client's fail-open answer.
 *
 * @param {{
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   nowSec?: number,
 *   platform?: NodeJS.Platform,
 *   execPath?: string,
 *   exists?: (p: string) => boolean,
 *   spawnFn?: typeof spawn,
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 * }} [opts]
 * @returns {Promise<number>}
 */
export function runEnforceSkill(opts = {}) {
  // First, so the deadline counts from the hook's start.
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const argv = opts.argv ?? process.argv.slice(2);
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const spawnFn = opts.spawnFn ?? spawn;
  const env = opts.env ?? process.env;
  const clientAt = argv.indexOf("--client");
  const client = clientAt === -1 ? undefined : argv[clientAt + 1];
  const failOpenAnswer = failOpenFor(client);

  return new Promise((resolve) => {
    let settled = false;
    /** @param {number} code @param {string | Buffer} output */
    const finish = (code, output) => {
      if (settled) return;
      settled = true;
      if (output.length === 0) resolve(code);
      else stdout.write(output, () => resolve(code));
    };
    /** @param {string} cause */
    const failOpen = (cause) => {
      if (settled) return;
      log.warn("skill governance failed open", { client, cause });
      if (failOpenAnswer.notice) stderr.write(failOpenMessage(cause));
      finish(failOpenAnswer.code, failOpenAnswer.stdout);
    };

    /** @type {ReturnType<typeof resolveEnforceSpawn>} */
    let plan;
    try {
      plan = resolveEnforceSpawn({
        ...parseEnforceArgs(argv),
        serverId: defaultServerId(env),
        env,
        nowSec,
        platform: opts.platform,
        execPath: opts.execPath,
        exists: opts.exists,
      });
    } catch (err) {
      failOpen(err instanceof Error ? err.message : String(err));
      return;
    }

    /** @type {ReturnType<typeof spawn>} */
    let child;
    try {
      child = spawnFn(plan.command, plan.args, {
        env: plan.env,
        shell: plan.shell,
        windowsHide: true,
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (err) {
      failOpen(`could not start ${plan.command}: ${err?.message ?? err}`);
      return;
    }

    child.on("error", (err) =>
      failOpen(`could not start ${plan.command}: ${err?.message ?? err}`),
    );
    if (!child.stdin || !child.stdout) {
      child.kill?.();
      failOpen(`${plan.command} has no stdio pipes`);
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    // A fast exit (including a policy exit 2) can EPIPE the stdin pipe. That must
    // not replace the child's status.
    child.stdin.on("error", () => {});
    stdin.pipe(child.stdin);
    child.on("close", (code, signal) => {
      if (!signal && (code === 0 || code === 2)) {
        finish(code, Buffer.concat(chunks));
      } else {
        failOpen(
          signal
            ? `npx was killed by ${signal}`
            : `npx exited with code ${code}`,
        );
      }
    });
  });
}

if (isMainEntry(import.meta.url)) {
  runEnforceSkill().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(
        failOpenMessage(`launcher error: ${err?.message ?? err}`),
      );
      process.stdout.write(FAIL_OPEN_UNKNOWN_CLIENT.stdout, () =>
        process.exit(FAIL_OPEN_UNKNOWN_CLIENT.code),
      );
    },
  );
}
