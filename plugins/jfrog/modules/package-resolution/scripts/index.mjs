// package-resolution capability — harness-agnostic entrypoint.
//
// Invoked by modules/*-session-start.mjs via run-capability.mjs (argv capability name).
// Performs NO harness-specific I/O (no stdin/stdout).

import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { renderInstruction } from "./render-instruction.mjs";
import { orchestrateEagerSetup } from "./eager-setup.mjs";
import { maybeSendAprHeartbeat } from "./apr-heartbeat.mjs";

/**
 * Adapter `ctx.ide` → UA wire `tool=` token.
 * Only hooks-specific mapping (`claude_code` → `claude`). Env-marker harness
 * detection stays in CLI (`ai-agent/`); model stamps only in skills when known.
 * @param {string | undefined} ide
 * @returns {string | undefined}
 */
function wireToolFromIde(ide) {
  if (ide === "claude_code") return "claude";
  if (ide === "cursor" || ide === "copilot") return ide;
  return undefined;
}

export const packageResolution = {
  name: "package-resolution",

  // Last resolved feature-flag mode ("off"|"pending"|"routing") and render detail
  // for the dispatcher EVENT log line.
  mode: undefined,
  meta: undefined,

  /** @returns {Promise<string>} markdown instruction text, or "" when no-op */
  async sessionStart(ctx = {}) {
    const flag = await isPackageResolutionEnabled();
    this.mode = flag.mode;

    // Hook UA tool= from adapter id; CLI may still append ai-agent/ from env.
    const tool = wireToolFromIde(ctx.ide);
    if (tool) process.env.JFROG_APR_UA_TOOL = tool;

    // Feature 2 — auto setup on startup. Only in routing mode (identity +
    // resolution available). Runs OFF the critical path: it just decides what
    // needs setup, spawns a detached worker, and returns a note. Never
    // blocks/breaks injection.
    let autoSetupStatus = "";
    if (flag.mode === "routing") {
      autoSetupStatus = await orchestrateEagerSetup(ctx);
      // Daily best-effort `jf rt ping` (trigger=hook UA) so observability still
      // sees APR sessions when eager setup is skipped. Never throws.
      await Promise.resolve(maybeSendAprHeartbeat());
    }

    const { text, meta } = await renderInstruction(flag, {
      ...ctx,
      autoSetupStatus,
    });
    this.meta = {
      reason: flag.reason,
      identity: flag.identity ?? "-",
      ...(autoSetupStatus ? { eagerSetup: true } : {}),
      ...meta,
    };
    return text;
  },
};

export default packageResolution;
