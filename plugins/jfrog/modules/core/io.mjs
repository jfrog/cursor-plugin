// Shared stdin helpers for the subprocess-style adapters (Claude, Cursor).
//
// Hooks deliver their JSON payload on stdin immediately; in non-hook contexts
// (CI, npm scripts, terminal smoke tests) nothing arrives, so we bail out after
// a short idle window rather than hang.

import process from "node:process";

export function readStdin({ idleMs = 50 } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    const idleTimer = setTimeout(settle, idleMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      idleTimer.refresh();
    });
    process.stdin.on("end", () => {
      clearTimeout(idleTimer);
      settle();
    });
    process.stdin.on("error", () => {
      clearTimeout(idleTimer);
      settle();
    });
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

// Positively identify the harness that invoked this hook from its stdin
// payload. Returns "cursor", "claude_code", or null when it can't tell
// (no stdin — e.g. terminal smoke tests — or an unrecognized shape).
//
// Why this matters: Cursor reads sessionStart hooks from BOTH
// ~/.cursor/hooks.json AND ~/.claude/settings.json. Without this, a Cursor
// session fires the Claude adapter too, double-injecting the policy. Each
// adapter uses this to no-op when a different harness invoked it.
//
// Cursor: cursor_version / agent_type. Claude: transcript_path / hook_event_name /
// session_id. Cursor also reads ~/.claude/settings.json, so each adapter no-ops
// when a different harness invoked it.
export function detectHarness(stdinRaw) {
  if (!stdinRaw) return null;
  try {
    const p = JSON.parse(stdinRaw);
    if (!p) return null;
    if (p.cursor_version || p.agent_type === "cursor") {
      return "cursor";
    }
    if (p.transcript_path || p.hook_event_name || p.session_id) {
      return "claude_code";
    }
  } catch {
    // stdin wasn't JSON — can't tell.
  }
  return null;
}

/**
 * Workspace roots for this hook invocation.
 * Cursor: workspace_roots[]. Claude: payload cwd. Fallback: process.cwd().
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
