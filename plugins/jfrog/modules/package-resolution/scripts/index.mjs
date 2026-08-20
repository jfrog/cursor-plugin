// package-resolution capability — harness-agnostic entrypoint.
//
// Invoked by modules/*-session-start.mjs via run-capability.mjs (argv capability name).
// Performs NO harness-specific I/O (no stdin/stdout).

import { createLogger } from "../../core/logger.mjs";
import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { renderInstruction } from "./render-instruction.mjs";
import { orchestrateEagerSetup } from "./eager-setup.mjs";
import { maybeSendAprHeartbeat } from "./apr-heartbeat.mjs";
import {
  maybeMigrateScaffoldEnabled,
  removeOnboardingOfferRules,
  tryBeginOnboardingNudge,
} from "./onboarding.mjs";

const log = createLogger("package-resolution");

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

/**
 * Sync soft-bridge offer rules (or clear them). Kill switch clears only.
 * @param {{ ide?: string, sessionId?: string, killSwitch?: boolean }} opts
 * @returns {{ offer: boolean, reason: string }}
 */
function syncOfferRules(opts = {}) {
  if (opts.killSwitch) {
    removeOnboardingOfferRules();
    return { offer: false, reason: "DISABLE" };
  }
  return tryBeginOnboardingNudge({
    actor: { ide: opts.ide, sessionId: opts.sessionId },
  });
}

export const packageResolution = {
  name: "package-resolution",

  // Last resolved feature-flag mode ("off"|"pending"|"routing") and render detail
  // for the dispatcher EVENT log line.
  mode: undefined,
  meta: undefined,

  /** @returns {Promise<string>} markdown instruction text, or "" when no-op */
  async sessionStart(ctx = {}) {
    // Kill switch must not persist enabled:true on a legacy scaffold — that
    // would activate APR the moment DISABLE is later removed, without consent.
    if (process.env.JF_AGENT_PACKAGE_RESOLUTION_DISABLE !== "1") {
      try {
        maybeMigrateScaffoldEnabled();
      } catch (err) {
        log.warn("scaffold enabled migration failed", {
          error: err?.message ?? String(err),
        });
      }
    }

    const flag = await isPackageResolutionEnabled();
    this.mode = flag.mode;

    // Hook UA tool= from adapter id; CLI may still append ai-agent/ from env.
    const tool = wireToolFromIde(ctx.ide);
    if (tool) process.env.JFROG_APR_UA_TOOL = tool;

    const killSwitch = flag.mode === "off" && flag.reason === "DISABLE";
    let nudge = { offer: false, reason: "nudge-error" };
    try {
      nudge = syncOfferRules({
        ide: ctx.ide,
        sessionId: ctx.sessionId,
        killSwitch,
      });
    } catch (err) {
      log.warn("onboarding nudge failed", {
        error: err?.message ?? String(err),
      });
    }

    // Off: no policy injection. Soft-bridge rules already synced above
    // (except kill switch, which cleared them).
    if (flag.mode === "off") {
      this.meta = {
        reason: flag.reason,
        identity: flag.identity ?? "-",
        nudge: nudge.offer,
        nudgeReason: nudge.reason,
        mode: "off",
      };
      return "";
    }

    // Enabled paths: inject pending/routing; keep offer rules when types remain
    // unbound + undeclined (synced above).

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
      nudge: nudge.offer,
      nudgeReason: nudge.reason,
      ...(autoSetupStatus ? { eagerSetup: true } : {}),
      ...meta,
    };
    return text;
  },
};

export default packageResolution;
