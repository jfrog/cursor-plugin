// Plugin install telemetry payload (epic WNGM-5915): the one body shape the
// worker sends to the Wingman telemetry route. Pure — no I/O — so the contract
// test can build every fixture body with it.
//
// The fixtures in test/fixtures/plugin-telemetry-contract/ are the contract;
// test/plugin-telemetry-contract.test.mjs fails if a field here is added,
// dropped or renamed.

// Wingman route, relative to the JPD base URL, as fixed by the J0 contract
// (WNGM-6852): "Values fixed by this contract" in wingman's
// backend/tests/data/plugin_telemetry_contract/README.md.
export const TELEMETRY_ROUTE = "/wingman/api/v1/telemetry/plugin-lifecycle";

// The generic anonymous JPD, in the EU only, where events go when the customer
// JPD is unknown or can't take them. https only (spec, "Send and fallback").
export const GENERIC_JPD_URL = "https://pluginmetrics.jfrog.io";

// The Copilot adapter's id is not a harness value on the wire (spec, Payload
// contract, `harness` row).
const HARNESS_ALIASES = { copilot: "vscode" };

const OS_BY_PLATFORM = { darwin: "darwin", linux: "linux", win32: "windows" };

/**
 * @param {string} adapterId — the adapter's HARNESS_ID
 * @returns {string} the `harness` value sent
 */
export function telemetryHarness(adapterId) {
  return HARNESS_ALIASES[adapterId] ?? adapterId;
}

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {"darwin" | "linux" | "windows" | "other"}
 */
export function telemetryOs(platform = process.platform) {
  return OS_BY_PLATFORM[platform] ?? "other";
}

/**
 * Request body for one `jfwn_plugin_lifecycle` event. `claimedJpdHost` is sent
 * only when given (generic route); the `previous_*` versions only for `update`.
 * @param {{
 *   action: "install" | "update" | "active",
 *   installId: string,
 *   harness: string,
 *   pluginVersion: string,
 *   hooksVersion: string,
 *   os: string,
 *   reason: string,
 *   jpdUrlSource: string,
 *   claimedJpdHost?: string,
 *   previousPluginVersion?: string,
 *   previousHooksVersion?: string,
 * }} event
 * @returns {Record<string, string>}
 */
export function buildLifecycleBody(event) {
  const body = {
    action: event.action,
    install_id: event.installId,
    harness: telemetryHarness(event.harness),
    plugin_version: event.pluginVersion,
    hooks_version: event.hooksVersion,
    os: event.os,
    reason: event.reason,
    jpd_url_source: event.jpdUrlSource,
  };
  if (event.claimedJpdHost) body.claimed_jpd_host = event.claimedJpdHost;
  if (event.action === "update") {
    body.previous_plugin_version = event.previousPluginVersion ?? "";
    body.previous_hooks_version = event.previousHooksVersion ?? "";
  }
  return body;
}
