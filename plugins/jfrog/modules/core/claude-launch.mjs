// How Claude Code started the session, as the Local Shadow scanner's Launch
// (agent-guard --launch-json -). Keys are the scanner's JSON keys; a key we
// can't learn is left out, and the scanner uses its default for it.
//
// Sources:
//   1. the SessionStart payload: cwd, permission_mode, agent_type
//   2. Claude's environment, which the hook inherits
//   3. Claude's command line, found by walking up the hook's parent processes
//   4. ~/.claude.json (trust) and the running Claude's version
//
// The launch can hold secrets (--settings text, MCP configs), so it goes to
// agent-guard on stdin and is never logged; only its key names are.

import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

// Each env key the scanner reads, copied as is when set.
const LAUNCH_ENV_KEYS = Object.freeze([
  "CLAUDE_CODE_USE_POWERSHELL_TOOL",
  "CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT",
  "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS",
  "CLAUDE_CODE_DISABLE_WEB_FETCH",
  "DISABLE_TELEMETRY",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
]);

// CLAUDE_CODE_ENTRYPOINT → the scanner's surface.
const SURFACES = Object.freeze({
  cli: "terminal",
  "claude-vscode": "vscode",
  "claude-desktop": "desktop",
  "sdk-ts": "agent_sdk",
  "sdk-py": "agent_sdk",
  "sdk-cli": "agent_sdk",
});

// The env flag that selects each provider. Without one the provider is
// claude.ai or console, which the environment can't tell apart.
const PROVIDER_ENV = Object.freeze([
  ["CLAUDE_CODE_USE_BEDROCK", "bedrock"],
  ["CLAUDE_CODE_USE_VERTEX", "agent_platform"],
  ["CLAUDE_CODE_USE_FOUNDRY", "foundry"],
]);

// How far up the process tree Claude may be: hook → shell → claude, plus
// wrappers such as npx or a version manager.
const MAX_ANCESTORS = 8;
const COMMAND_TIMEOUT_MS = 5_000;

const isOn = (value) =>
  typeof value === "string" &&
  value !== "" &&
  value !== "0" &&
  value.toLowerCase() !== "false";

const text = (value) =>
  typeof value === "string" && value ? value : undefined;

const VERSION = /\d+\.\d+\.\d+/;

// Path functions for the platform the paths come from.
const pathFor = (platform) => (platform === "win32" ? path.win32 : path.posix);

// Windows env keys are case-insensitive (`SystemRoot`), but a copied env object
// is a plain object.
function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
}

// The scanner's name for the OS.
export function scannerOS(platform, env = {}, readFileFn = readFileSync) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") {
    if (env.WSL_DISTRO_NAME) return "wsl";
    try {
      if (/microsoft/i.test(readFileFn("/proc/version", "utf8"))) return "wsl";
    } catch {
      // no /proc/version: plain linux
    }
  }
  return platform;
}

// Fields from the SessionStart payload.
export function launchFromPayload(payload) {
  const out = {};
  if (text(payload?.cwd)) out.cwd = payload.cwd;
  if (text(payload?.permission_mode))
    out.permission_mode = payload.permission_mode;
  if (text(payload?.agent_type)) out.agent = payload.agent_type;
  return out;
}

// Fields from Claude's environment.
export function launchFromEnv(env, platform) {
  const out = {};
  if (text(env.CLAUDE_CONFIG_DIR)) out.config_dir = env.CLAUDE_CONFIG_DIR;
  const launchEnv = {};
  for (const key of LAUNCH_ENV_KEYS) {
    if (typeof env[key] === "string") launchEnv[key] = env[key];
  }
  if (Object.keys(launchEnv).length) out.env = launchEnv;
  const entrypoint = text(env.CLAUDE_CODE_ENTRYPOINT);
  if (entrypoint) out.surface = SURFACES[entrypoint] ?? "unknown";
  const provider = PROVIDER_ENV.find(([key]) => isOn(env[key]));
  if (provider) out.provider = provider[1];
  if (platform === "win32" && text(env.CLAUDE_CODE_GIT_BASH_PATH))
    out.git_bash = "true";
  return out;
}

// A .claude.json projects key or a cwd, comparable: / separators, no trailing
// slash, and no case on Windows and macOS, whose file systems ignore it.
function trustKey(dir, platform) {
  let key = dir.replaceAll("\\", "/");
  if (key.length > 1) key = key.replace(/\/+$/, "");
  return platform === "win32" || platform === "darwin"
    ? key.toLowerCase()
    : key;
}

// The workspace's trust, as Claude decides it from .claude.json: "true" when
// the workspace or any folder above it has hasTrustDialogAccepted true (Claude
// doesn't ask in a folder under a trusted one); "false" when an entry says
// false and none above is trusted; nothing when no folder up to the root has
// an entry.
export function workspaceTrust(
  cwd,
  {
    env,
    home = homedir(),
    platform = process.platform,
    readFileFn = readFileSync,
  },
) {
  if (!cwd) return undefined;
  const file = path.join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");
  let projects;
  try {
    projects = JSON.parse(readFileFn(file, "utf8"))?.projects;
  } catch {
    return undefined;
  }
  if (!projects || typeof projects !== "object") return undefined;
  const accepted = new Map();
  for (const [key, entry] of Object.entries(projects)) {
    const value = entry?.hasTrustDialogAccepted;
    if (typeof value !== "boolean") continue;
    const k = trustKey(key, platform);
    accepted.set(k, accepted.get(k) === true || value);
  }
  let found;
  for (let dir = trustKey(cwd, platform); ; ) {
    const value = accepted.get(dir);
    if (value === true) return "true";
    if (value === false) found = "false";
    const parent = path.posix.dirname(dir);
    if (parent === dir || parent === ".") break;
    dir = parent;
  }
  return found;
}

// The running Claude's executable as an absolute path, or undefined. argv[0]
// is often a bare "claude" the shell found on PATH, so the OS is asked for
// the file the process runs: /proc on Linux, lsof's first txt file on macOS
// (ps prints argv[0] as typed), the process list on Windows.
function claudeExecutable({ pid, program }, { platform, execFn, readlinkFn }) {
  const { isAbsolute } = pathFor(platform);
  let exe;
  try {
    if (platform === "linux") exe = readlinkFn(`/proc/${pid}/exe`);
    else if (platform !== "win32") {
      const out = execFn(
        "/usr/sbin/lsof",
        ["-w", "-a", "-p", String(pid), "-d", "txt", "-Fn"],
        {
          encoding: "utf8",
          timeout: COMMAND_TIMEOUT_MS,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      exe = /^n(.+)$/m.exec(out)?.[1];
    }
  } catch {
    // fall back to argv[0]
  }
  if (exe && isAbsolute(exe)) return exe;
  return program && isAbsolute(program) ? program : undefined;
}

// The running Claude's version (see findClaude): the package.json next to
// cli.js for an npm install run by node, else `<executable> --version`
// ("2.1.311 (Claude Code)"). Never a bare `claude` from PATH, which may be
// another install, or a file in the workspace on Windows.
export function claudeVersion(
  claude,
  {
    platform = process.platform,
    env = process.env,
    execFn = execFileSync,
    readFileFn = readFileSync,
    readlinkFn = readlinkSync,
  } = {},
) {
  if (!claude) return undefined;
  try {
    if (claude.script) {
      const { dirname, join } = pathFor(platform);
      const pkg = JSON.parse(
        readFileFn(join(dirname(claude.script), "package.json"), "utf8"),
      );
      return VERSION.exec(String(pkg?.version))?.[0];
    }
    const exe = claudeExecutable(claude, { platform, execFn, readlinkFn });
    if (!exe) return undefined;
    const out = execFn(exe, ["--version"], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      env,
      windowsHide: true,
    });
    return VERSION.exec(out)?.[0];
  } catch {
    return undefined;
  }
}

// Splits a Windows command line by the CommandLineToArgvW rules.
export function splitWindowsCommandLine(line) {
  const args = [];
  let cur = "";
  let inQuotes = false;
  let hasArg = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") {
        n++;
        i++;
      }
      if (line[i] === '"') {
        cur += "\\".repeat(Math.floor(n / 2));
        if (n % 2) cur += '"';
        else {
          inQuotes = !inQuotes;
        }
      } else {
        cur += "\\".repeat(n);
        i--;
      }
      hasArg = true;
    } else if (c === '"') {
      inQuotes = !inQuotes;
      hasArg = true;
    } else if (/\s/.test(c) && !inQuotes) {
      if (hasArg) args.push(cur);
      cur = "";
      hasArg = false;
    } else {
      cur += c;
      hasArg = true;
    }
  }
  if (hasArg) args.push(cur);
  return args;
}

// The hook's ancestors, nearest first: [{ pid, argv, exe? }]. argv is exact on
// Linux and Windows; on macOS ps joins it with spaces, so it's rebuilt by
// psArgv. exe, the executable's full path, is known on Windows only.
export function listAncestors({
  pid = process.ppid,
  platform = process.platform,
  env = process.env,
  execFn = execFileSync,
  readFileFn = readFileSync,
} = {}) {
  if (platform === "linux") return linuxAncestors(pid, readFileFn);
  if (platform === "win32") return windowsAncestors(pid, env, execFn);
  return psAncestors(pid, execFn);
}

function linuxAncestors(pid, readFileFn) {
  const out = [];
  for (let i = 0; i < MAX_ANCESTORS && pid > 1; i++) {
    try {
      const argv = readFileFn(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .filter((a, idx, all) => idx < all.length - 1 || a !== "");
      out.push({ pid, argv });
      const status = readFileFn(`/proc/${pid}/status`, "utf8");
      pid = Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] ?? 0);
    } catch {
      break;
    }
  }
  return out;
}

// ps for each ancestor only, so no other process's command line is read: its
// parent and program (comm), then its command line (args).
function psAncestors(pid, execFn) {
  function ps(fields) {
    return execFn("ps", ["-o", fields, "-p", String(pid)], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }
  const ancestors = [];
  for (let i = 0; i < MAX_ANCESTORS && pid > 1; i++) {
    let head, args;
    try {
      head = ps("ppid=,comm=");
      args = ps("args=");
    } catch {
      break;
    }
    const m = /^\s*(\d+)\s+(.*?)\s*$/s.exec(head);
    if (!m) break;
    ancestors.push({ pid, argv: psArgv(m[2], args.trim()) });
    pid = Number(m[1]);
  }
  return ancestors;
}

const CLI_END = /[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.m?js(?=\s|$)/;

// argv from macOS ps, which prints it joined with spaces, so a path with a
// space can't be split back on whitespace. comm is the program as it was
// started, spaces kept, and args starts with it. When the program isn't Claude
// itself, an npm install's cli.js is kept whole too: it runs from the nearest
// word before cli.js that starts a path (/, ~, ./ or ../). Only the other
// arguments are split on whitespace, so a value with a space in it is still
// cut.
export function psArgv(comm, args) {
  let program = comm;
  let rest = "";
  if (comm && (!args || args === comm || args.startsWith(`${comm} `))) {
    rest = args.slice(comm.length).trim();
  } else {
    [program = "", ...rest] = args.split(/\s+/);
    rest = rest.join(" ");
  }
  const argv = [program];
  const end = isClaudeProgram(program) ? null : CLI_END.exec(rest);
  if (end) {
    const stop = end.index + end[0].length;
    const words = [...rest.slice(0, stop).matchAll(/\S+/g)];
    const first = words.findLastIndex((w) => /^(?:[/~]|\.\.?\/)/.test(w[0]));
    const start = words[first >= 0 ? first : words.length - 1].index;
    argv.push(...splitWords(rest.slice(0, start)), rest.slice(start, stop));
    rest = rest.slice(stop);
  }
  argv.push(...splitWords(rest));
  return argv;
}

function splitWords(s) {
  return s.split(/\s+/).filter(Boolean);
}

function isClaudeProgram(program) {
  const name = path.basename(program.replaceAll("\\", "/"));
  return name.replace(/\.exe$/i, "") === "claude";
}

// PowerShell by full path, never a bare name a workspace file could answer.
function powershellPath(env) {
  const root = envValue(env, "SYSTEMROOT");
  const systemRoot = root && path.win32.isAbsolute(root) ? root : "C:\\Windows";
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function windowsAncestors(pid, env, execFn) {
  const script = [
    `$p = ${Number(pid)}`,
    "$out = @()",
    `for ($i = 0; $i -lt ${MAX_ANCESTORS}; $i++) {`,
    '  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$p"',
    "  if (-not $w) { break }",
    "  $out += [pscustomobject]@{ pid = $p; cmd = $w.CommandLine; exe = $w.ExecutablePath }",
    "  $p = $w.ParentProcessId",
    "}",
    "ConvertTo-Json -InputObject $out -Compress",
  ].join("\n");
  const json = execFn(
    powershellPath(env),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  return (JSON.parse(json) ?? []).map(({ pid: p, cmd, exe }) => ({
    pid: p,
    argv: splitWindowsCommandLine(cmd ?? ""),
    ...(text(exe) && { exe }),
  }));
}

// The running Claude among the ancestors, or null: its pid, its own arguments
// (after the program, or after cli.js for an npm install run by node), and
// what its version is read from: program (its executable, or argv[0]) or
// script (cli.js).
export function findClaude(ancestors) {
  for (const { pid, argv, exe } of ancestors) {
    if (!argv.length) continue;
    if (isClaudeProgram(argv[0]))
      return { pid, program: exe ?? argv[0], args: argv.slice(1) };
    const script = argv.findIndex((a) =>
      /[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.(js|mjs)$/.test(a),
    );
    if (script >= 0)
      return { pid, script: argv[script], args: argv.slice(script + 1) };
  }
  return null;
}

// Claude's own arguments, or null when no ancestor is Claude.
export function findClaudeArgs(ancestors) {
  return findClaude(ancestors)?.args ?? null;
}

// Claude's CLI flags → Launch keys. kind: bool (no value), one (one value),
// many (values until the next flag).
const FLAGS = Object.freeze({
  "--permission-mode": ["one", "permission_mode"],
  "--dangerously-skip-permissions": ["bool", "dangerously_skip_permissions"],
  "--allow-dangerously-skip-permissions": [
    "bool",
    "allow_dangerously_skip_permissions",
  ],
  "-p": ["bool", "print"],
  "--print": ["bool", "print"],
  "--settings": ["one", "settings"],
  "--setting-sources": ["one", "setting_sources"],
  "--add-dir": ["many", "add_dirs"],
  "--plugin-dir": ["many", "plugin_dirs"],
  "--plugin-url": ["many", "plugin_urls"],
  "--agent": ["one", "agent"],
  "--agents": ["one", "agents_json"],
  "--mcp-config": ["many", "mcp_config"],
  "--strict-mcp-config": ["bool", "strict_mcp_config"],
  "--allowedTools": ["many", "allowed_tools"],
  "--allowed-tools": ["many", "allowed_tools"],
  "--disallowedTools": ["many", "disallowed_tools"],
  "--disallowed-tools": ["many", "disallowed_tools"],
  "--tools": ["many", "tools"],
  "--bare": ["bool", "bare"],
  "--safe-mode": ["bool", "safe_mode"],
  "--restricted": ["bool", "restricted"],
  "--disable-slash-commands": ["bool", "disable_slash_commands"],
  "--permission-prompt-tool": ["one", "permission_prompt_tool"],
  "--permission-prompts": ["one", "permission_prompts"],
  "--init": ["bool", "init"],
  "--init-only": ["bool", "init_only"],
  "--maintenance": ["bool", "maintenance"],
});

// A value that ps split on whitespace, joined back: inline JSON until it
// parses, and a tool rule like Bash(git log:*) until its parentheses close.
// Returns [value, next index].
function takeValue(args, start) {
  const first = args[start];
  if (first.startsWith("{") || first.startsWith("["))
    return takeJSONValue(args, start);
  let value = first;
  let end = start + 1;
  while (openParens(value) > 0 && end < args.length) value += " " + args[end++];
  return [value, end];
}

function openParens(text) {
  return (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
}

function takeJSONValue(args, start) {
  for (let end = start + 1; end <= args.length; end++) {
    const candidate = args.slice(start, end).join(" ");
    try {
      JSON.parse(candidate);
      return [candidate, end];
    } catch {
      // keep joining
    }
  }
  return [args[start], start + 1];
}

// A flag value that is inline JSON stays text; any other value is a file.
// Returns the file's text, or undefined when it can't be read.
function configText(value, cwd, readFileFn) {
  if (value.trimStart().startsWith("{")) return value;
  try {
    return readFileFn(path.resolve(cwd ?? "", value), "utf8");
  } catch {
    return undefined;
  }
}

// Parses Claude's arguments into Launch keys. Unknown flags and positional
// arguments (the prompt) are skipped.
export function launchFromArgs(args, { cwd, readFileFn = readFileSync } = {}) {
  const out = {};
  const raw = {};
  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const spec = Object.hasOwn(FLAGS, name) ? FLAGS[name] : undefined;
    if (!spec) {
      i++;
      continue;
    }
    const [kind, key] = spec;
    if (kind === "bool") {
      raw[key] = true;
      i++;
      continue;
    }
    const values = [];
    if (eq > 0) {
      values.push(arg.slice(eq + 1));
      i++;
    } else {
      i++;
      while (i < args.length && !args[i].startsWith("-")) {
        const [value, next] = takeValue(args, i);
        values.push(value);
        i = next;
        if (kind === "one") break;
      }
    }
    if (!values.length) continue;
    raw[key] = kind === "one" ? values[0] : [...(raw[key] ?? []), ...values];
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key === "settings") {
      if (value.trimStart().startsWith("{")) out.settings_text = value;
      else out.settings_path = path.resolve(cwd ?? "", value);
    } else if (key === "mcp_config") {
      const texts = value
        .map((v) => configText(v, cwd, readFileFn))
        .filter(Boolean);
      if (texts.length) out.mcp_config_text = texts;
    } else if (key === "add_dirs" || key === "plugin_dirs") {
      out[key] = value.map((dir) => path.resolve(cwd ?? "", dir));
    } else if (key === "allowed_tools" || key === "disallowed_tools") {
      out[key] = value.flatMap((v) =>
        v
          .split(/[\s,]+(?![^(]*\))/)
          .map((t) => t.trim())
          .filter(Boolean),
      );
    } else if (key === "tools") {
      out.tools = value.join(" ");
    } else {
      out[key] = value;
    }
  }
  return out;
}

// The session's launch. Every source is best effort: a source that fails adds
// nothing. Fields from the command line win over the payload, except cwd and a
// payload permission_mode, which say what the session is now.
export function buildLaunch(
  payload,
  {
    env = process.env,
    platform = process.platform,
    home = homedir(),
    readFileFn = readFileSync,
    listAncestorsFn = listAncestors,
    claudeVersionFn = claudeVersion,
  } = {},
) {
  const fromPayload = launchFromPayload(payload);
  const cwd = fromPayload.cwd;
  let claude = null;
  let fromArgs = {};
  try {
    claude = findClaude(listAncestorsFn({ platform, env }));
    if (claude) fromArgs = launchFromArgs(claude.args, { cwd, readFileFn });
  } catch {
    // no process list: no CLI flags, and no version
  }
  const launch = {
    home,
    os: scannerOS(platform, env, readFileFn),
    ...launchFromEnv(env, platform),
    ...fromArgs,
    ...fromPayload,
  };
  const trusted = workspaceTrust(cwd, { env, home, platform, readFileFn });
  if (trusted) launch.trusted = trusted;
  const version = claudeVersionFn(claude, { platform, env, readFileFn });
  if (version) launch.claude_version = version;
  return launch;
}
