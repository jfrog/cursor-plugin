// package-resolution capability — harness-agnostic entrypoint.
//
// Invoked by modules/*-session-start.mjs via run-capability.mjs (argv capability name).
// Performs NO harness-specific I/O (no stdin/stdout).

import { createLogger } from "../../core/logger.mjs";
import { axesForSessionStart } from "../../core/jf-user-agent.mjs";
import { isPackageResolutionEnabled } from "./feature-flag.mjs";
import { renderInstruction } from "./render-instruction.mjs";
import { orchestrateEagerSetup } from "./eager-setup.mjs";
import { maybeSendAprHeartbeat } from "./apr-heartbeat.mjs";
import {
  maybeMigrateScaffoldEnabled,
  resolveOnboardingNudge,
} from "./onboarding.mjs";

const log = createLogger("package-resolution");

/**
 * Adapter `ctx.ide` → UA wire tokens. Unknown ide → omit, not `unknown`.
 * Direct sessionStart (no ide) infers from strong env only.
 * Clears leftover JFROG_APR_UA_* when an axis is absent (Claude omit client).
 */
export function stampHookUaAxes(ctx = {}) {
  const axes = axesForSessionStart(ctx, process.env);
  if (axes.tool) process.env.JFROG_APR_UA_TOOL = axes.tool;
  else delete process.env.JFROG_APR_UA_TOOL;
  if (axes.client) process.env.JFROG_APR_UA_CLIENT = axes.client;
  else delete process.env.JFROG_APR_UA_CLIENT;
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

    // Hook UA from adapter id, or print-policy inference when ide is absent.
    stampHookUaAxes(ctx);

    const killSwitch = flag.mode === "off" && flag.reason === "DISABLE";

    // Off: only the nudge (if eligible) is injected, no routing/pending policy.
    // No routing resolution happens in this mode, so there is no "governed
    // type unresolved" state to check the nudge against.
    if (flag.mode === "off") {
      let nudge = { offer: false, reason: "nudge-error", text: "" };
      try {
        nudge = resolveOnboardingNudge({ ide: ctx.ide, killSwitch });
      } catch (err) {
        log.warn("onboarding nudge failed", {
          error: err?.message ?? String(err),
        });
      }
      this.meta = {
        reason: flag.reason,
        identity: flag.identity ?? "-",
        nudge: nudge.offer,
        nudgeReason: nudge.reason,
        mode: "off",
      };
      return nudge.text;
    }

    // Enabled paths: inject pending/routing; nudge still injected alongside
    // it when types remain unbound + undeclined.

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

    // Nudge is decided AFTER routing resolves, not before: its "public
    // registries are the default, say No to decline" framing must never sit
    // beside a hard block on a governed-but-unresolved type — that pairing is
    // exactly what let an agent read a blocked type as merely unconfigured.
    const blockedByUnresolved = Boolean(
      meta.unresolved && meta.unresolved !== "-",
    );
    let nudge = { offer: false, reason: "nudge-error", text: "" };
    if (blockedByUnresolved) {
      nudge = { offer: false, reason: "governed-type-unresolved", text: "" };
    } else {
      try {
        nudge = resolveOnboardingNudge({ ide: ctx.ide, killSwitch });
      } catch (err) {
        log.warn("onboarding nudge failed", {
          error: err?.message ?? String(err),
        });
      }
    }

    const combined = [text, nudge.text]
      .filter((t) => t?.trim())
      .join("\n\n---\n\n");
    this.meta = {
      reason: flag.reason,
      identity: flag.identity ?? "-",
      nudge: nudge.offer,
      nudgeReason: nudge.reason,
      ...(autoSetupStatus ? { eagerSetup: true } : {}),
      ...meta,
    };
    return combined;
  },
};

export default packageResolution;
