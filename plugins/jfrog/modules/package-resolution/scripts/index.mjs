// package-resolution capability — harness-agnostic entrypoint.
//
// Invoked by modules/*-session-start.mjs via run-capability.mjs (argv capability name).
// Performs NO harness-specific I/O (no stdin/stdout).

import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { renderInstruction } from "./render-instruction.mjs";
import { orchestrateEagerSetup } from "./eager-setup.mjs";

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

    // Feature 2 — auto setup on startup. Only in routing mode (identity +
    // resolution available). Runs OFF the critical path: it just decides what
    // needs setup, spawns a detached worker, and returns a note. Never
    // blocks/breaks injection.
    let autoSetupStatus = "";
    if (flag.mode === "routing") {
      autoSetupStatus = await orchestrateEagerSetup(ctx);
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
