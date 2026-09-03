// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BRIDGE_CLIENT_PREFIX,
  EXIT_DISABLED,
  EXIT_ENABLED,
  EXIT_REGISTRY_DISABLED,
  SETTINGS_PATH,
  isGatewayPluginEnabled,
  runAgentGuardCheck,
} from "../modules/core/agent-guard-check.mjs";

const ROOT = "https://acme.jfrog.io";
const ROOT_URL = `${ROOT}${SETTINGS_PATH}`;
const BRIDGE_URL = `${ROOT}${BRIDGE_CLIENT_PREFIX}${SETTINGS_PATH}`;

// A fetch double driven by a url -> response map. Records every URL it was
// called with so tests can assert the SaaS path stays a single request.
function stubFetch(routes) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`unstubbed URL: ${url}`);
    if (typeof route === "function") return route();
    const { status = 200, body } = route;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { fetchFn, calls };
}

const enabledBody = { settings: { mcpGatewayPluginEnabled: true } };
const disabledBody = { settings: { mcpGatewayPluginEnabled: false } };

// ---- /bridge-client fallback (self-hosted JPDs) ----

test("isGatewayPluginEnabled does not retry when the root path answers", async () => {
  const { fetchFn, calls } = stubFetch({ [ROOT_URL]: { body: enabledBody } });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL]);
});

test("isGatewayPluginEnabled retries behind /bridge-client on a root 404", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: enabledBody },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL, BRIDGE_URL]);
});

test("isGatewayPluginEnabled surfaces a registry-off answer from /bridge-client", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: disabledBody },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.equal(result.registryOff, true);
  assert.equal(result.ok, false);
});

test("isGatewayPluginEnabled keeps the root 404 when /bridge-client 404s too", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { status: 404 },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, {
    ok: false,
    reason: "settings endpoint returned HTTP 404",
  });
  assert.deepEqual(calls, [ROOT_URL, BRIDGE_URL]);
});

test("isGatewayPluginEnabled keeps the root 404 when /bridge-client is inconclusive", async () => {
  const inconclusive = [
    { status: 401 },
    { status: 500 },
    { body: { settings: { mcpGatewayPluginEnabled: "yes" } } },
    () => {
      throw new Error("ECONNREFUSED");
    },
  ];
  for (const bridge of inconclusive) {
    const { fetchFn } = stubFetch({
      [ROOT_URL]: { status: 404 },
      [BRIDGE_URL]: bridge,
    });
    const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
    assert.deepEqual(result, {
      ok: false,
      reason: "settings endpoint returned HTTP 404",
    });
  }
});

test("isGatewayPluginEnabled never retries a non-404 failure", async () => {
  for (const status of [401, 403, 500, 502]) {
    const { fetchFn, calls } = stubFetch({ [ROOT_URL]: { status } });
    const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
    assert.deepEqual(result, {
      ok: false,
      reason: `settings endpoint returned HTTP ${status}`,
    });
    assert.deepEqual(calls, [ROOT_URL], `status ${status} must not retry`);
  }
});

test("isGatewayPluginEnabled never retries an unreachable root", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: () => {
      throw new Error("ENOTFOUND");
    },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, {
    ok: false,
    reason: "settings endpoint unreachable (ENOTFOUND)",
  });
  assert.deepEqual(calls, [ROOT_URL]);
});

test("the /bridge-client retry gets its own timeout budget", async () => {
  // The root attempt outlives its full budget before 404-ing. If the retry
  // reused that AbortController it would start already-aborted and report a
  // timeout instead of the bridge path's real answer.
  const timeoutMs = 20;
  const signals = [];
  const fetchFn = async (url, { signal }) => {
    signals.push(signal);
    if (url === ROOT_URL) {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs * 3));
      return { ok: false, status: 404, json: async () => ({}) };
    }
    assert.equal(signal.aborted, false, "retry received a spent signal");
    return { ok: true, status: 200, json: async () => enabledBody };
  };
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn, timeoutMs });
  assert.deepEqual(result, { ok: true });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});

test("a /bridge-client retry that times out leaves the root 404 verdict", async () => {
  const fetchFn = (url, { signal }) =>
    new Promise((resolve, reject) => {
      if (url === ROOT_URL) {
        resolve({ ok: false, status: 404, json: async () => ({}) });
        return;
      }
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn, timeoutMs: 20 });
  assert.deepEqual(result, {
    ok: false,
    reason: "settings endpoint returned HTTP 404",
  });
});

test("the /artifactory suffix is stripped before both attempts", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: enabledBody },
  });
  const result = await isGatewayPluginEnabled(`${ROOT}/artifactory/`, "tok", {
    fetchFn,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL, BRIDGE_URL]);
});

// ---- exit-code contract through the public entry point ----

test("runAgentGuardCheck maps a /bridge-client hit to EXIT_ENABLED", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: enabledBody },
  });
  const result = await runAgentGuardCheck({
    env: { JFROG_URL: ROOT, JFROG_ACCESS_TOKEN: "tok" },
    fetchFn,
  });
  assert.equal(result.code, EXIT_ENABLED);
});

test("runAgentGuardCheck maps a /bridge-client registry-off to EXIT_REGISTRY_DISABLED", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: disabledBody },
  });
  const result = await runAgentGuardCheck({
    env: { JFROG_URL: ROOT, JFROG_ACCESS_TOKEN: "tok" },
    fetchFn,
  });
  assert.equal(result.code, EXIT_REGISTRY_DISABLED);
});

test("runAgentGuardCheck still reports an all-404 platform as EXIT_DISABLED", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { status: 404 },
  });
  const result = await runAgentGuardCheck({
    env: { JFROG_URL: ROOT, JFROG_ACCESS_TOKEN: "tok" },
    fetchFn,
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.equal(result.reason, "Disabled: settings endpoint returned HTTP 404");
});
