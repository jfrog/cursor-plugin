// Run a single capability's sessionStart by name (argv from hook runner).
//
// Static allowlist only — no arbitrary dynamic imports. Each capability is a
// separate hooks.json entry (separate subprocess); this module does not merge
// multiple capabilities in one process.
//
// Entry path convention (dev repo and plugin copy are identical):
//   {pluginRoot}/{name}/scripts/index.mjs

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { setLogContext, createLogger } from "./logger.mjs";

const log = createLogger("run-capability");

/** modules bundle root (parent of core/ and package-resolution/). */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Shipped capabilities — add a name here; folder layout must match convention. */
const ALLOWLIST = new Set(["package-resolution"]);

/**
 * @param {string} name — capability id
 * @returns {string} absolute path to index.mjs
 */
export function capabilityEntryPath(name) {
  return path.join(PLUGIN_ROOT, name, "scripts", "index.mjs");
}

/** @returns {(() => Promise<module>) | null} */
function loadCapabilityModule(name) {
  if (!ALLOWLIST.has(name)) return null;
  const href = pathToFileURL(capabilityEntryPath(name)).href;
  return () => import(href);
}

function hookDurMs(ctx) {
  return typeof ctx.startedAtMs === "number" ? Date.now() - ctx.startedAtMs : undefined;
}

/**
 * @param {string} name — capability id from process.argv[2]
 * @param {object} ctx — shared session context (ide, sessionId, workspaceRoots, …)
 * @returns {Promise<string>} markdown to inject, or "" on no-op / failure
 */
export async function runCapability(name, ctx = {}) {
  const load = loadCapabilityModule(name);
  if (!load) {
    log.error("unknown capability", { name });
    return "";
  }

  setLogContext({ ide: ctx.ide, sessionId: ctx.sessionId });

  try {
    const mod = await load();
    const cap = mod.default;
    if (!cap?.sessionStart) {
      log.error("capability missing sessionStart", { name });
      return "";
    }

    const text = await cap.sessionStart(ctx);
    const trimmed = text?.trim() ? text : "";

    if (trimmed) {
      log.debug("sessionStart injected", {
        enabled: true,
        capabilities: name,
        mode: cap.mode,
        ...(cap.meta ?? {}),
        bytes: trimmed.length,
        durMs: hookDurMs(ctx),
      });
    } else {
      log.debug("sessionStart no-op", { capabilities: name, durMs: hookDurMs(ctx) });
    }

    return trimmed;
  } catch (err) {
    log.error("capability sessionStart failed", {
      capability: name,
      error: err?.message ?? String(err),
    });
    return "";
  }
}

export { ALLOWLIST, PLUGIN_ROOT };
