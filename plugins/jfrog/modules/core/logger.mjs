// Shared logger — every hook, resolver call, and feature-flag check writes here.
//
// Log file: ~/.jfrog/logs/agent-hooks.log
// Format:   <iso-timestamp>  <LEVEL>  [component]  <message>  k1=v1 k2=v2 ...
//
// One line per event, append-only, sync writes so short-lived hook processes
// flush before exit. Tail with `make logs` / `tail -F ~/.jfrog/logs/agent-hooks.log`.
//
// Errors from the logger itself are swallowed — a misbehaving log MUST NOT
// break the hook (otherwise the agent session breaks).
//
// Log level: `logLevel` in ~/.jfrog/agents-conf.json (default info).
// Undocumented; for test isolation only — not a customer-facing control:
// JFROG_AGENT_HOOKS_LOG_FILE overrides the log path.
//
// Levels:
//   silent  no output at all
//   debug   step-by-step internals (resolver probes, feature-flag detail)
//   info    user-visible events (hook fired, rewrite applied)
//   event   one-line header + indented fields (hook summaries; easy to scan)
//   warn    recoverable issues (unresolved repo, conflict, fallback)
//   error   unexpected failures (caught exceptions, IO errors)

import { mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";

import { getGlobalLogLevel } from "./agents-config.mjs";

function defaultLogFile() {
  return path.join(homedir(), ".jfrog", "logs", "agent-hooks.log");
}

function logFile() {
  return process.env.JFROG_AGENT_HOOKS_LOG_FILE || defaultLogFile();
}

// `silent` is a sentinel above every numeric level — nothing matches it.
const LEVELS = { debug: 10, info: 20, event: 25, warn: 30, error: 40, silent: 1000 };

let minLevelResolved = false;
let minLevel = LEVELS.info;
let disabled = false;

function resolveMinLevel() {
  if (minLevelResolved) return;
  minLevelResolved = true;
  const envLevel = getGlobalLogLevel();
  minLevel = LEVELS[envLevel] ?? LEVELS.info;
  disabled = minLevel >= LEVELS.silent;
}

// Short trace id per process — lets you correlate a single hook invocation's
// multi-line output (resolver + feature flag + outcome).
const TRACE_ID = randomBytes(4).toString("hex");

// Per-process context that imported modules inherit. The session hook
// (inject-instructions) calls setLogContext({ ide, sessionId }) after
// detecting them, so feature-flag and resolver log lines pick up the same
// IDE / session tag automatically.
const CONTEXT = {};
export function setLogContext(ctx) {
  if (!ctx) return;
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null) CONTEXT[k] = v;
  }
}

let ensuredDir = false;
let ensuredDirFor = "";
function ensureDir() {
  const file = logFile();
  if (ensuredDir && ensuredDirFor === file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    ensuredDir = true;
    ensuredDirFor = file;
  } catch {
    // ignore — write attempt below will also swallow
  }
}

// Tags we promote to fixed-width bracket prefixes for scannability.
// Everything else in kv goes to the tail as key=value.
const PREFIX_TAGS = ["ide", "sessionId", "trace"];

// Column widths — every line uses these exactly so brackets line up across
// the file. Sized for current values with a small safety margin; any value
// longer than its column is truncated with an ellipsis by `fitCol` so a
// future long component / IDE name can never silently break alignment.
//
//   COL_LEVEL    — log level inside two spaces (e.g. "EVENT", "DEBUG")
//   COL_COMPONENT — "[component]" bracketed, e.g. "[session-policy]"
//   COL_IDE      — inside the [...] (the brackets themselves are added later)
//   COL_SESSION  — "sess:<8 hex>", inside [...]
//   COL_TRACE    — "trace:<8 hex>", inside [...]
const COL_LEVEL = 5;
const COL_COMPONENT = 20;
const COL_IDE = 12;
const COL_SESSION = 13; // "sess:" (5) + 8-char shortId
const COL_TRACE = 14;   // "trace:" (6) + 8-char shortId

function fitCol(s, width) {
  if (s.length === width) return s;
  if (s.length < width) return s.padEnd(width);
  // Truncate with an ellipsis so overflow is visible but doesn't break the
  // column. (Single char ellipsis keeps width exact.)
  return s.slice(0, width - 1) + "…";
}

function shortId(s) {
  if (!s) return "";
  return String(s).split("-")[0].slice(0, 8);
}

function formatKV(kv) {
  if (!kv) return "";
  const parts = [];
  for (const [k, v] of Object.entries(kv)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    const needsQuote = /[\s="']/.test(s);
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    parts.push(`${k}=${needsQuote ? `"${escaped}"` : escaped}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function formatKVLines(kv, indent = "  ") {
  if (!kv) return "";
  const lines = [];
  for (const [k, v] of Object.entries(kv)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    lines.push(`${indent}${k}: ${s}`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

function bracketPrefixes(kv) {
  // Bracketed columns in fixed order: [ide] [sess:xxxx] [trace:xxxx]
  // Each inner value is padded/truncated to a fixed width by fitCol so the
  // brackets themselves always land at the same byte column.
  const ide = fitCol(kv.ide ?? "-", COL_IDE);
  const sess = fitCol(`sess:${shortId(kv.sessionId) || "-"}`, COL_SESSION);
  const trace = fitCol(`trace:${kv.trace || "-"}`, COL_TRACE);
  return `[${ide}]  [${sess}]  [${trace}]`;
}

function write(level, component, message, kv) {
  resolveMinLevel();
  if (disabled) return;
  const num = LEVELS[level] ?? LEVELS.info;
  if (num < minLevel) return;

  const ts = new Date().toISOString();
  const lvl = fitCol(level.toUpperCase(), COL_LEVEL);
  const comp = fitCol(`[${component}]`, COL_COMPONENT);

  const allKv = { trace: TRACE_ID, ide: CONTEXT.ide, sessionId: CONTEXT.sessionId, ...kv };
  const prefix = bracketPrefixes(allKv);

  // Strip promoted tags from the kv tail so we don't print them twice.
  const tailKv = { ...allKv, pid: process.pid };
  for (const k of PREFIX_TAGS) delete tailKv[k];
  delete tailKv.trace;

  // EVENT summaries (sessionStart / preToolUse) use a short header plus one
  // field per indented line — much easier to scan than a long k=v tail.
  const line =
    level === "event"
      ? `${ts}  ${lvl}  ${comp}  ${prefix}  ${message}${formatKVLines(tailKv)}\n`
      : `${ts}  ${lvl}  ${comp}  ${prefix}  ${message}${formatKV(tailKv)}\n`;

  try {
    ensureDir();
    appendFileSync(logFile(), line);
  } catch {
    // swallow — the hook must keep working
  }
}

export function createLogger(component) {
  return {
    debug: (msg, kv) => write("debug", component, msg, kv),
    info: (msg, kv) => write("info", component, msg, kv),
    warn: (msg, kv) => write("warn", component, msg, kv),
    error: (msg, kv) => write("error", component, msg, kv),
    event: (msg, kv) => write("event", component, msg, kv),
    child: (sub) => createLogger(`${component}/${sub}`),
  };
}

export function logFilePath() {
  return logFile();
}

export function traceId() {
  return TRACE_ID;
}
