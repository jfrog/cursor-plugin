import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  BRIDGE_CLIENT_PREFIX,
  EXIT_DISABLED,
  EXIT_ENABLED,
  EXIT_REGISTRY_DISABLED,
  SETTINGS_PATH,
  isGatewayPluginEnabled,
  resolveAgentGuardCredentials,
  runAgentGuardCheck,
} from "../modules/core/agent-guard-check.mjs";

const ROOT = "https://mycompany.jfrog.io";
const ROOT_URL = `${ROOT}${SETTINGS_PATH}`;
const BRIDGE_URL = `${ROOT}${BRIDGE_CLIENT_PREFIX}${SETTINGS_PATH}`;

const ENABLED_BODY = { settings: { mcpGatewayPluginEnabled: true } };
const DISABLED_BODY = { settings: { mcpGatewayPluginEnabled: false } };

// setup.json (v2) in a fresh JFROG_CLI_HOME_DIR so tests never touch ~/.jfrog.
function tempHome(servers) {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-guard-check-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, "setup.json"),
    JSON.stringify({ version: 2, servers }),
  );
  return dir;
}

// What `jf config export <id>` prints: base64 of the server config JSON.
function exportBlob(serverId) {
  return Buffer.from(
    JSON.stringify({ url: ROOT, accessToken: "cli-tok", serverId }),
  ).toString("base64");
}

// execFileSync double standing in for `jf config export <id>`.
function jfExport() {
  return (_cmd, args) => exportBlob(args.at(-1));
}

// A fetch double driven by a url -> response map, recording every URL it was
// called with so a test can prove the SaaS path stays a single request.
function stubFetch(routes) {
  /** @type {string[]} */
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    const route = routes[String(url)];
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

test("force disable wins over force enable", async () => {
  const result = await runAgentGuardCheck({
    env: {
      _JF_AGENT_GUARD_FORCE_DISABLE: "true",
      JF_AGENT_GUARD_FORCE_ENABLE: "true",
    },
    fetchFn: () => assert.fail("must not fetch when forced"),
    execFileSyncFn: () => assert.fail("must not call jf when forced"),
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.match(result.reason, /FORCE_DISABLE/);
});

test("force enable skips network", async () => {
  const result = await runAgentGuardCheck({
    env: { JF_AGENT_GUARD_FORCE_ENABLE: "true" },
    fetchFn: () => assert.fail("must not fetch when forced"),
    execFileSyncFn: () => assert.fail("must not call jf when forced"),
  });
  assert.equal(result.code, EXIT_ENABLED);
  assert.match(result.reason, /FORCE_ENABLE/);
});

test("missing credentials returns disabled", async () => {
  const result = await runAgentGuardCheck({
    env: { JFROG_CLI_HOME_DIR: tempHome({}) },
    fetchFn: () => assert.fail("must not fetch without creds"),
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.match(result.reason, /no AI Governance server/);
});

test("resolveAgentGuardCredentials jf spawn is hidden and shell-free", () => {
  resolveAgentGuardCredentials({
    serverId: "aig",
    env: {},
    execFileSyncFn: (_cmd, _args, opts) => {
      assert.equal(opts.windowsHide, true);
      assert.equal(opts.shell, false);
      throw new Error("jf missing");
    },
  });
});

test("resolveAgentGuardCredentials exports the AI Governance server", () => {
  const env = {
    JFROG_CLI_HOME_DIR: tempHome({
      other: { jpdUrl: "https://other.jfrog.io" },
      aig: { jpdUrl: ROOT, isDefault: true, currentActiveProject: "proj" },
    }),
  };
  const creds = resolveAgentGuardCredentials({
    env,
    execFileSyncFn: jfExport(),
  });
  assert.deepEqual(creds, {
    baseUrl: ROOT,
    token: "cli-tok",
    source: "JF CLI config (server 'aig')",
  });
});

test("resolveAgentGuardCredentials resolves a server without a project", () => {
  const env = {
    JFROG_CLI_HOME_DIR: tempHome({
      aig: { jpdUrl: ROOT, isDefault: true },
    }),
  };
  const creds = resolveAgentGuardCredentials({
    env,
    execFileSyncFn: jfExport(),
  });
  assert.equal(creds?.baseUrl, ROOT);
});

test("resolveAgentGuardCredentials returns null when no server is selectable", () => {
  const ambiguous = {
    a: { jpdUrl: ROOT },
    b: { jpdUrl: ROOT },
  };
  for (const servers of [{}, ambiguous]) {
    const creds = resolveAgentGuardCredentials({
      env: { JFROG_CLI_HOME_DIR: tempHome(servers) },
      execFileSyncFn: () => assert.fail("must not call jf"),
    });
    assert.equal(creds, null);
  }
});

test("resolveAgentGuardCredentials ignores JFROG_URL credentials", () => {
  const creds = resolveAgentGuardCredentials({
    serverId: "aig",
    env: { JFROG_URL: ROOT, JFROG_ACCESS_TOKEN: "env-tok" },
    execFileSyncFn: () => {
      throw new Error("server not found");
    },
  });
  assert.equal(creds, null);
});

test("an explicit serverId overrides the AI Governance server", () => {
  const creds = resolveAgentGuardCredentials({
    serverId: "explicit",
    env: {
      JFROG_CLI_HOME_DIR: tempHome({
        aig: { jpdUrl: ROOT, isDefault: true },
      }),
    },
    execFileSyncFn: (_cmd, args) => {
      assert.deepEqual(args.slice(-3), ["config", "export", "explicit"]);
      return exportBlob("explicit");
    },
  });
  assert.equal(creds?.source, "JF CLI config (server 'explicit')");
});

test("isGatewayPluginEnabled strips trailing /artifactory", async () => {
  /** @type {string | undefined} */
  let requested;
  /** @type {string | undefined} */
  let userAgent;
  const result = await isGatewayPluginEnabled(
    "https://mycompany.jfrog.io/artifactory/",
    "tok",
    {
      fetchFn: async (url, init) => {
        requested = String(url);
        userAgent = init?.headers?.["User-Agent"];
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: true }),
        };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(requested, `https://mycompany.jfrog.io${SETTINGS_PATH}`);
  assert.match(String(userAgent), /^jfrog-skills\//);
  assert.doesNotMatch(String(userAgent), /trigger=/);
  assert.doesNotMatch(String(userAgent), /jfrog-cli-go/);
});

test("isGatewayPluginEnabled maps value:false to registryOff", async () => {
  const result = await isGatewayPluginEnabled(
    "https://mycompany.jfrog.io",
    "tok",
    {
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          settings: { mcpGatewayPluginEnabled: false },
        }),
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.registryOff, true);
});

test("isGatewayPluginEnabled maps AbortError to timeout reason", async () => {
  const result = await isGatewayPluginEnabled(
    "https://mycompany.jfrog.io",
    "tok",
    {
      fetchFn: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.registryOff, undefined);
  assert.match(result.reason, /timeout/);
});

test("isGatewayPluginEnabled rejects non-boolean gateway setting", async () => {
  const yes = await isGatewayPluginEnabled(
    "https://mycompany.jfrog.io",
    "tok",
    {
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ value: "yes" }),
      }),
    },
  );
  assert.equal(yes.ok, false);
  assert.match(yes.reason, /invalid gateway-plugin setting/);

  const missing = await isGatewayPluginEnabled(
    "https://mycompany.jfrog.io",
    "tok",
    {
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ settings: {} }),
      }),
    },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /invalid gateway-plugin setting/);
});

test("runAgentGuardCheck returns registry disabled on value:false", async () => {
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    execFileSyncFn: jfExport(),
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: false }),
    }),
  });
  assert.equal(result.code, EXIT_REGISTRY_DISABLED);
  assert.match(result.reason, /^RegistryDisabled:/);
});

test("runAgentGuardCheck returns enabled on value:true", async () => {
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    execFileSyncFn: jfExport(),
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        settings: { mcp_gateway_plugin_enabled: { value: true } },
      }),
    }),
  });
  assert.equal(result.code, EXIT_ENABLED);
  assert.match(result.reason, /^Enabled:/);
});

test("HTTP non-OK maps to disabled not registry-disabled", async () => {
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    execFileSyncFn: jfExport(),
    fetchFn: async () => ({
      ok: false,
      status: 403,
      json: async () => assert.fail("must not parse body"),
    }),
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.match(result.reason, /HTTP 403/);
});

test("runAgentGuardCheck maps AbortError to disabled with timeout", async () => {
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    execFileSyncFn: jfExport(),
    fetchFn: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.match(result.reason, /^Disabled:/);
  assert.match(result.reason, /timeout/);
});

test("runAgentGuardCheck maps invalid gateway setting to disabled", async () => {
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    execFileSyncFn: jfExport(),
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: "yes" }),
    }),
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.match(result.reason, /^Disabled:/);
  assert.match(result.reason, /invalid gateway-plugin setting/);
});

test("a root path that answers is never retried behind /bridge-client", async () => {
  const { fetchFn, calls } = stubFetch({ [ROOT_URL]: { body: ENABLED_BODY } });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL]);
});

test("a root 404 is retried behind /bridge-client", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: ENABLED_BODY },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL, BRIDGE_URL]);
});

test("a registry turned off behind /bridge-client maps to registryOff", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: DISABLED_BODY },
  });
  const result = await isGatewayPluginEnabled(ROOT, "tok", { fetchFn });
  assert.equal(result.ok, false);
  assert.equal(result.registryOff, true);
});

test("an inconclusive /bridge-client reply keeps the root 404 verdict", async () => {
  const inconclusive = [
    { status: 404 },
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

test("a non-404 failure is never retried", async () => {
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

test("an unreachable root is never retried", async () => {
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
  // The root attempt outlives its full budget before 404-ing. A reused
  // AbortController would hand the retry a spent signal and report a timeout
  // instead of the bridge path's real answer.
  const timeoutMs = 20;
  /** @type {AbortSignal[]} */
  const signals = [];
  const fetchFn = async (url, { signal }) => {
    signals.push(signal);
    if (String(url) === ROOT_URL) {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs * 3));
      return { ok: false, status: 404, json: async () => ({}) };
    }
    assert.equal(signal.aborted, false, "retry received a spent signal");
    return { ok: true, status: 200, json: async () => ENABLED_BODY };
  };
  const result = await isGatewayPluginEnabled(ROOT, "tok", {
    fetchFn,
    timeoutMs,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});

test("a /bridge-client retry that times out leaves the root 404 verdict", async () => {
  const fetchFn = (url, { signal }) =>
    new Promise((resolve, reject) => {
      if (String(url) === ROOT_URL) {
        resolve({ ok: false, status: 404, json: async () => ({}) });
        return;
      }
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  const result = await isGatewayPluginEnabled(ROOT, "tok", {
    fetchFn,
    timeoutMs: 20,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "settings endpoint returned HTTP 404",
  });
});

test("the /artifactory suffix is stripped before both attempts", async () => {
  const { fetchFn, calls } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: ENABLED_BODY },
  });
  const result = await isGatewayPluginEnabled(`${ROOT}/artifactory/`, "tok", {
    fetchFn,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [ROOT_URL, BRIDGE_URL]);
});

test("runAgentGuardCheck maps a /bridge-client hit to enabled", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: ENABLED_BODY },
  });
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    fetchFn,
    execFileSyncFn: jfExport(),
  });
  assert.equal(result.code, EXIT_ENABLED);
});

test("runAgentGuardCheck maps a /bridge-client registry-off to exit 2", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { body: DISABLED_BODY },
  });
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    fetchFn,
    execFileSyncFn: jfExport(),
  });
  assert.equal(result.code, EXIT_REGISTRY_DISABLED);
});

test("runAgentGuardCheck still reports an all-404 platform as disabled", async () => {
  const { fetchFn } = stubFetch({
    [ROOT_URL]: { status: 404 },
    [BRIDGE_URL]: { status: 404 },
  });
  const result = await runAgentGuardCheck({
    serverId: "aig",
    env: {},
    fetchFn,
    execFileSyncFn: jfExport(),
  });
  assert.equal(result.code, EXIT_DISABLED);
  assert.equal(result.reason, "Disabled: settings endpoint returned HTTP 404");
});
