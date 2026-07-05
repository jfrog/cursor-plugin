// package-resolution capability — harness-agnostic entrypoint.
//
// Invoked by modules/*-session-start.mjs via run-capability.mjs (argv capability name).
// Performs NO harness-specific I/O (no stdin/stdout).

import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { renderInstruction } from "./render-instruction.mjs";

export const packageResolution = {
  name: "package-resolution",

  // Last resolved feature-flag mode ("off"|"enforce"|"active") and render detail
  // for the dispatcher EVENT log line.
  mode: undefined,
  meta: undefined,

  /** @returns {Promise<string>} markdown instruction text, or "" when no-op */
  async sessionStart(ctx = {}) {
    const flag = await isPackageResolutionEnabled();
    this.mode = flag.mode;
    const { text, meta } = await renderInstruction(flag, ctx);
    this.meta = {
      reason: flag.reason,
      identity: flag.identity ?? "-",
      ...meta,
    };
    return text;
  },
};

export default packageResolution;
