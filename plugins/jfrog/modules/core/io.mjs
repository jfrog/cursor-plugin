// Shared stdin helpers for subprocess-style adapters (Claude, Cursor, VS Code).
//
// Hooks deliver their JSON payload on stdin immediately; in non-hook contexts
// (CI, npm scripts, terminal smoke tests) nothing arrives, so we bail out after
// a short idle window rather than hang.

import process from "node:process";

/** A whole payload has arrived, as opposed to a prefix of one. */
function isCompletePayload(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return false; // still mid-payload
  }
  // Objects only: a truncated object never parses, but a truncated number
  // does, so `12` arriving out of `1234` must not look finished.
  return typeof value === "object" && value !== null;
}

// Releasing the stream matters as much as reading it. A 'data' listener puts
// stdin in flowing mode, which keeps the handle referenced and the process
// alive even after the hook has written its answer. A caller that holds the
// pipe open would otherwise hang us until the harness kills the process —
// which, on a fail-closed hook, denies the tool call.
//
// The same caller costs us latency even when nothing hangs: waiting out the
// idle window on every preToolUse call added ~60ms to each of the agent's
// shell commands. A hook payload is one JSON object, so once it parses there
// is nothing left to wait for and we stop reading immediately.
export function readStdin({ idleMs = 50 } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    let settled = false;
    let idleTimer;

    const onData = (chunk) => {
      data += chunk;
      if (isCompletePayload(data)) settle();
      else idleTimer.refresh();
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      process.stdin.off("data", onData);
      process.stdin.off("end", settle);
      process.stdin.off("error", settle);
      process.stdin.pause();
      process.stdin.unref?.();
      resolve(data);
    };

    idleTimer = setTimeout(settle, idleMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", settle);
    process.stdin.on("error", settle);
  });
}

export function parseSessionId(stdinRaw) {
  if (!stdinRaw) return undefined;
  try {
    return JSON.parse(stdinRaw)?.session_id;
  } catch {
    return undefined;
  }
}

// Claude's documented SessionStart sources. VS Code Copilot documents only
// "new", so the two sets stay disjoint and neither can claim the other's
// sessions.
const CLAUDE_SESSION_SOURCES = new Set([
  "startup",
  "resume",
  "clear",
  "compact",
]);

// Positively identify the harness that invoked this hook from its stdin
// payload. Returns "cursor", "copilot", "claude_code", or null when no harness
// left a fingerprint (no stdin — e.g. terminal smoke tests — or a shape none of
// them own).
//
// Why this matters: Cursor reads sessionStart hooks from BOTH
// ~/.cursor/hooks.json AND ~/.claude/settings.json. Without this, a Cursor
// session fires the Claude adapter too, double-injecting the policy. Each
// adapter uses this to no-op when a different harness invoked it.
//
// Every branch below is a signal exactly one harness documents, and null means
// "can't tell". An adapter is only ever registered by the harness it serves, so
// a payload no harness claims is left to whichever adapter was invoked.
export function detectHarness(stdinRaw) {
  if (!stdinRaw) return null;
  try {
    const p = JSON.parse(stdinRaw);
    if (!p) return null;
    // Cursor stamps its own version/agent on every hook payload.
    if (p.cursor_version || p.agent_type === "cursor") {
      return "cursor";
    }
    if (p.hook_event_name === "SessionStart") {
      // Copilot's documented `new` source is decisive. Current VS Code payloads
      // also include a transcript_path, so path presence cannot classify Claude
      // before the source is checked.
      if (p.source === "new") return "copilot";
      if (CLAUDE_SESSION_SOURCES.has(p.source)) return "claude_code";
    }
    // Claude writes a transcript for non-SessionStart hooks too.
    if (p.transcript_path) return "claude_code";
  } catch {
    // stdin wasn't JSON — can't tell.
  }
  return null;
}

/**
 * Workspace roots for this hook invocation.
 * Cursor: workspace_roots[]. Claude and VS Code Copilot: payload cwd.
 * Fallback: process.cwd().
 *
 * @param {string} [stdinRaw]
 * @returns {string[]}
 */
export function parseWorkspaceRoots(stdinRaw) {
  if (stdinRaw?.trim()) {
    try {
      const p = JSON.parse(stdinRaw);
      if (Array.isArray(p.workspace_roots) && p.workspace_roots.length) {
        return p.workspace_roots.filter((r) => typeof r === "string" && r);
      }
      if (typeof p.cwd === "string" && p.cwd) return [p.cwd];
    } catch {
      // fall through
    }
  }

  return [process.cwd()];
}
