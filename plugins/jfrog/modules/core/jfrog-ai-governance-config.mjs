#!/usr/bin/env node
// jfrog-ai-governance-config.mjs — resolve and update the JFrog AI Governance
// server and project in ${JFROG_CLI_HOME_DIR:-~/.jfrog}/setup.json.
//
// Usage, commands, options and exit codes: see USAGE below (also printed on a
// usage error).
//
// Contract:
//   - Exactly one entry has `isDefault`. A v1 file with a single entry is
//     treated as its default and migrated (written back as v2) by `get`.
//   - `set` on an ambiguous file (no clear default) needs no --force and
//     leaves the target as the only default.
//   - A file whose `version` is newer than this script knows is read, but
//     never written.
//   - Unknown keys are preserved on every write.
//   - Writes are temp file + rename, no lock.
//   - stderr: an `info:` line if deprecated env vars are set; `debug:` lines
//     with JF_AGENT_GUARD_LOG_LEVEL=debug.
//   - Self-contained (Node builtins only): copied verbatim into the hooks,
//     which import resolveAiGovernanceConfig and run `server-id`.
//
// File shape:
//   { "version", "servers": { "<id>": { "jpdUrl", "currentActiveProject"?,
//                                       "isDefault"? } } }

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `\
Usage: jfrog-ai-governance-config.mjs <command> [options]

Commands:
  get                        Print the AI Governance server and project as JSON:
                             {status, serverId?, jpdUrl?, project?, path?}.
                             status: ok | no_project | ambiguous | missing | corrupt
                             (corrupt: setup.json is not valid; path names it).
  list                       Print every saved server as a JSON array of
                             {serverId, jpdUrl, project?, isDefault}.
  set <server-id> [project]  Make <server-id> the AI Governance server (jpdUrl
                             from \`jf config show\`).
                             Project omitted: keep the saved one.
                             Project "": save none.
  server-id                  Print only the server id, for command substitution.
                             Prints nothing if the id contains invalid characters.
                             Always exits 0.

Options:
  --force                    set: override the saved server or project, or
                             replace a corrupt file. Only when you know what
                             you are doing.

Environment:
  JF_AGENT_GUARD_LOG_LEVEL=debug  Print debug lines on stderr.

Exit codes:
  0  ok
  1  set failed (message on stderr)
  2  usage error
`;
const CURRENT_VERSION = 2;
const DEPRECATED_ENV = [
  "JFROG_URL",
  "JF_URL",
  "JFROG_ACCESS_TOKEN",
  "JF_ACCESS_TOKEN",
  "JF_PROJECT",
  "JFROG_PROJECT",
  "JF_SERVER",
  "JFROG_SERVER_ID",
  "JF_SERVER_ID",
];
const NOOP_LOG = { debug() {} };
// Same safe charset the hooks require for project keys passed to agent-guard.
const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Git Bash rewrites path-like arguments (/ \) and cmd.exe re-parses the npx
// shim (& %), so such an id can't safely go into a hook command line.
const UNSAFE_SERVER_ID = /[/\\&%]/;

// import.meta.url is symlink-resolved, argv[1] is not; compare real paths.
function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(moduleUrl) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v !== "";

function aiGovernanceConfigPath(env) {
  return join(
    env.JFROG_CLI_HOME_DIR || join(homedir(), ".jfrog"),
    "setup.json",
  );
}

// A missing file has no entries. A file that exists but is unreadable, not a
// JSON object, or has a non-object `servers` is `corrupt` (and has no data).
function loadSetup(path, log) {
  const corrupt = { data: null, entries: [], corrupt: true };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      log.debug(`no setup.json at ${path}`);
      return { data: null, entries: [], absent: true };
    }
    log.debug(
      err instanceof SyntaxError
        ? `${path} is not valid JSON`
        : `could not read ${path}: ${err.code || err.message}`,
    );
    return corrupt;
  }
  if (!isObject(parsed)) {
    log.debug(`${path} is not a JSON object`);
    return corrupt;
  }
  if (parsed.servers !== undefined && !isObject(parsed.servers)) {
    log.debug(`${path}: "servers" is not an object`);
    return corrupt;
  }
  const entries = Object.entries(parsed.servers ?? {}).filter(([, e]) =>
    isObject(e),
  );
  return { data: parsed, entries };
}

const isNewer = (data) =>
  typeof data?.version === "number" && data.version > CURRENT_VERSION;

// The entry `get` would select, or null when ambiguous. A lone entry without
// isDefault is the implied default.
function select(entries) {
  const defaults = entries.filter(([, e]) => e.isDefault === true);
  if (defaults.length === 1) {
    return { id: defaults[0][0], entry: defaults[0][1], implied: false };
  }
  if (defaults.length === 0 && entries.length === 1) {
    return { id: entries[0][0], entry: entries[0][1], implied: true };
  }
  return null;
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    // "wx" fails if anything (e.g. a planted symlink) already exists at tmp.
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", {
      flag: "wx",
      mode: 0o644,
    });
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Never created or already renamed.
    }
    throw err;
  }
}

/**
 * Select the AI Governance server from setup.json, migrating a lone v1 entry to v2.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env] default process.env
 * @param {{debug(message: string): void}} [options.log] default silent
 * @returns {{status: "missing" | "ambiguous"}
 *   | {status: "corrupt", path: string}
 *   | {status: "ok" | "no_project", serverId: string, jpdUrl: string, project?: string}}
 *   corrupt: the file exists but is not a valid setup object.
 */
export function resolveAiGovernanceConfig({
  env = process.env,
  log = NOOP_LOG,
} = {}) {
  const path = aiGovernanceConfigPath(env);
  log.debug(`reading ${path}`);
  const { data, entries, corrupt } = loadSetup(path, log);
  if (corrupt) return { status: "corrupt", path };
  if (entries.length === 0) {
    log.debug("missing: no usable entries");
    return { status: "missing" };
  }
  const sel = select(entries);
  if (!sel) {
    const marked = entries.filter(([, e]) => e.isDefault === true).length;
    log.debug(
      marked
        ? `ambiguous: ${marked} entries marked isDefault`
        : `ambiguous: ${entries.length} entries, none marked isDefault`,
    );
    return { status: "ambiguous" };
  }
  log.debug(
    `default "${sel.id}" (${sel.implied ? "only entry, implied" : "explicit isDefault"})`,
  );
  if (sel.implied && !isNewer(data)) {
    try {
      writeAtomic(path, {
        ...data,
        version: CURRENT_VERSION,
        servers: {
          ...data.servers,
          [sel.id]: { ...sel.entry, isDefault: true },
        },
      });
      log.debug(`migrated ${path}: "${sel.id}" is now the default`);
    } catch (err) {
      log.debug(`migration write to ${path} failed: ${err.message}`);
    }
  }
  const base = { serverId: sel.id, jpdUrl: sel.entry.jpdUrl };
  const project = sel.entry.currentActiveProject;
  if (nonEmpty(project)) return { status: "ok", ...base, project };
  log.debug(`no_project: "${sel.id}" has no currentActiveProject`);
  return { status: "no_project", ...base };
}

// Same as `get` but never migrates.
function listAiGovernanceConfig({ env = process.env, log = NOOP_LOG } = {}) {
  const path = aiGovernanceConfigPath(env);
  log.debug(`reading ${path}`);
  return loadSetup(path, log)
    .entries.map(([serverId, e]) => ({
      serverId,
      jpdUrl: e.jpdUrl,
      ...(nonEmpty(e.currentActiveProject) && {
        project: e.currentActiveProject,
      }),
      isDefault: e.isDefault === true,
    }))
    .sort((a, b) => a.serverId.localeCompare(b.serverId));
}

// Platform root URL, or "" when `raw` is not an http(s) URL. A missing scheme
// means https.
function normalizeJpdUrl(raw) {
  const s = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin + url.pathname.replace(/(\/(artifactory|ui))*\/*$/, "");
  } catch {
    return "";
  }
}

// Returns the server list, or null when jf could not be run or its output
// was unusable (reported to the caller as "could not run jf", distinct from
// "server not configured"). jf is looked up on PATH only.
function loadJfServers(env, log) {
  // On Windows an npm-installed jf is a .cmd shim, which only a shell can
  // launch; the command is a constant, so passing it as one string is safe.
  const opts = { encoding: "utf8", env, timeout: 30_000 };
  const r =
    process.platform === "win32"
      ? spawnSync("jf config show --format=json", { ...opts, shell: true })
      : spawnSync("jf", ["config", "show", "--format=json"], opts);
  if (r.error || r.status !== 0) {
    log.debug(
      `jf config show failed: ${r.error?.message || `exit ${r.status}`}`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(r.stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.servers)) return parsed.servers;
  } catch (err) {
    log.debug(`jf config show output not parseable: ${err.message}`);
  }
  return null;
}

/**
 * Make serverId the AI Governance server.
 * Without force it refuses to switch away from another default server, and to
 * change or clear the saved non-empty project.
 * @param {string} serverId jf CLI server id
 * @param {string} [project] undefined keeps the saved project; "" saves none
 * @param {object} [options]
 * @param {boolean} [options.force] override the refusals above
 * @param {NodeJS.ProcessEnv} [options.env] default process.env
 * @param {{debug(message: string): void}} [options.log] default silent
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function setAiGovernanceConfig(
  serverId,
  project,
  { force = false, env = process.env, log = NOOP_LOG } = {},
) {
  if (nonEmpty(project) && !PROJECT_KEY.test(project)) {
    return {
      ok: false,
      error: `invalid project key ${JSON.stringify(project)}`,
    };
  }
  const path = aiGovernanceConfigPath(env);
  const { data, entries, absent, corrupt } = loadSetup(path, log);
  if (corrupt && !force) {
    return refuse(`${path} is corrupt`, log);
  }
  if (isNewer(data)) {
    return refuse(
      `${path} was written by a newer version (${data.version}); refusing to modify it`,
      log,
    );
  }
  const current = select(entries);
  const previous = entries.find(([id]) => id === serverId)?.[1];
  const existing = current?.entry.currentActiveProject;
  log.debug(
    current
      ? `current default: "${current.id}" (${nonEmpty(existing) ? `project "${existing}"` : "no project"})`
      : "no current default",
  );
  if (current && current.id !== serverId) {
    if (!force) {
      return refuse(
        `the AI Governance server in ${path} is "${current.id}"; setting "${serverId}" would change it`,
        log,
      );
    }
    log.debug(`switching default "${current.id}" -> "${serverId}" (--force)`);
  } else if (current && project !== undefined && project !== (existing ?? "")) {
    if (!force && nonEmpty(existing)) {
      const change = nonEmpty(project) ? `setting "${project}"` : "clearing it";
      return refuse(
        `"${serverId}" uses project "${existing}"; ${change} would change it`,
        log,
      );
    }
    log.debug(`setting project of "${serverId}" to "${project}"`);
  } else if (current) {
    log.debug(`"${serverId}" is already the default; refreshing`);
  } else {
    log.debug(`new default "${serverId}"`);
  }
  // The jf CLI is consulted only once the saved state allows the change, so a
  // refusal names the saved server, not a missing jf config entry.
  const jfServers = loadJfServers(env, log);
  if (!jfServers) {
    return {
      ok: false,
      error:
        "could not run `jf config show`; is the JFrog CLI installed and on PATH?",
    };
  }
  const jpdUrlOf = (s) =>
    normalizeJpdUrl(`${s.url ?? ""}`.trim() || `${s.artifactoryUrl ?? ""}`);
  const jf = jfServers.find(
    (s) => isObject(s) && s.serverId === serverId && jpdUrlOf(s),
  );
  log.debug(
    `jf config show returned servers: ${jfServers
      .filter(isObject)
      .map((s) => s.serverId)
      .join(", ")}`,
  );
  if (!jf) {
    log.debug(`"${serverId}" not found in jf config show`);
    return {
      ok: false,
      error: `server "${serverId}" is not in the jf CLI config`,
    };
  }
  log.debug(`"${serverId}" -> ${jpdUrlOf(jf)}`);
  const nextServers = Object.fromEntries(
    entries.map(([id, e]) => {
      const { isDefault: _drop, ...rest } = e;
      return [id, rest];
    }),
  );
  const { currentActiveProject: saved, ...kept } = previous ?? {};
  const nextProject = project === undefined ? saved : project;
  nextServers[serverId] = {
    ...kept,
    jpdUrl: jpdUrlOf(jf),
    ...(nonEmpty(nextProject) && { currentActiveProject: nextProject }),
    isDefault: true,
  };
  log.debug(`${absent ? "creating" : "updating"} ${path}`);
  try {
    writeAtomic(path, {
      ...data,
      version: CURRENT_VERSION,
      servers: nextServers,
    });
  } catch (err) {
    log.debug(`write to ${path} failed: ${err.message}`);
    return { ok: false, error: `write failed: ${err.message}` };
  }
  log.debug(`wrote ${path}`);
  return { ok: true };
}

function refuse(error, log) {
  log.debug(`refused: ${error}`);
  return { ok: false, error };
}

function usage() {
  process.stderr.write(USAGE);
  return 2;
}

function main(argv, env) {
  const [mode, ...rest] = argv;
  const log = {
    debug: (m) =>
      env.JF_AGENT_GUARD_LOG_LEVEL === "debug" &&
      process.stderr.write(`debug: ${m}\n`),
  };

  if (mode === "server-id") {
    try {
      const cfg = resolveAiGovernanceConfig({ env, log });
      if (cfg.status === "ok" || cfg.status === "no_project") {
        if (UNSAFE_SERVER_ID.test(cfg.serverId)) {
          log.debug(
            `server-id: "${cfg.serverId}" not printed; Windows shells would rewrite it`,
          );
        } else {
          process.stdout.write(`${cfg.serverId}\n`);
        }
      }
    } catch {
      // Always exit 0 with no output: callers use this in $(...).
    }
    return 0;
  }

  const [serverId, project, ...extra] = rest.filter((a) => a !== "--force");
  const force = rest.includes("--force");
  const argsOk =
    mode === "set" ? serverId !== undefined && !extra.length : !rest.length;
  const stray = rest.some((a) => a.startsWith("-") && a !== "--force");
  const badProject = nonEmpty(project) && !PROJECT_KEY.test(project);
  if (badProject) {
    process.stderr.write(
      `ai-governance-config: invalid project key ${JSON.stringify(project)}\n`,
    );
  }
  if (
    !["get", "list", "set"].includes(mode) ||
    !argsOk ||
    stray ||
    badProject
  ) {
    return usage();
  }

  const used = DEPRECATED_ENV.filter((name) => nonEmpty(env[name]));
  if (used.length) {
    process.stderr.write(
      `info: ${used.join(", ")} set but ignored (deprecated); AI Governance config comes from ${aiGovernanceConfigPath(env)}. Continuing normally without using them.\n`,
    );
  }

  if (mode === "get") {
    process.stdout.write(
      JSON.stringify(resolveAiGovernanceConfig({ env, log }), null, 2) + "\n",
    );
    return 0;
  }
  if (mode === "list") {
    process.stdout.write(
      JSON.stringify(listAiGovernanceConfig({ env, log }), null, 2) + "\n",
    );
    return 0;
  }
  const result = setAiGovernanceConfig(serverId, project, {
    force,
    env,
    log,
  });
  if (!result.ok) {
    process.stderr.write(`ai-governance-config: ${result.error}\n`);
    return 1;
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
