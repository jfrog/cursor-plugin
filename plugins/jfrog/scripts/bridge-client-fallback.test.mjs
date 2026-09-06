// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
//
// Integration coverage for the `/bridge-client` fallback in the two skill
// scripts that probe `/ml/core` (self-hosted JPDs do not serve it off the
// platform root).
//
// Neither script is unit-testable in-process: jfrog-agent-guard-check.mjs
// runs its gate at import time and exports nothing, and
// jfrog-detect-catalog-runtime.mjs shells out to `jf` for its config. Both
// are therefore driven the way a user drives them — spawned as a child
// process against a real localhost JPD stub, with a fake `jf` on PATH and
// HOME redirected so lib/jf.mjs's ~/.jfrog/bin self-heal cannot shadow it.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD_SCRIPT = join(
  pluginRoot,
  "skills/jfrog-mcp-management/scripts/jfrog-agent-guard-check.mjs",
);
const CATALOG_SCRIPT = join(
  pluginRoot,
  "skills/jfrog-init/scripts/jfrog-detect-catalog-runtime.mjs",
);

const SETTINGS_PATH =
  "/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled";
const CATALOG_PATH = "/ml/core/api/v1/mcp-registry/ml-projects";
const BRIDGE = "/bridge-client";

// A shell-script `jf` is the whole isolation strategy here; Windows would
// need a .cmd shim and a different homedir override.
const windows = process.platform === "win32";

const sandbox = mkdtempSync(join(tmpdir(), "jfrog-bridge-test-"));
const fakeJfDir = join(sandbox, "bin");
const fakeHome = join(sandbox, "home");
mkdirSync(fakeJfDir);
mkdirSync(fakeHome);

// ---- localhost JPD stub ----

// Starts a server whose `routes` map a full request path (query stripped) to
// a handler. Records every {path, authed} pair so a test can prove the SaaS
// case never touches `/bridge-client`.
async function startJpd(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    requests.push({ path, authed: Boolean(req.headers.authorization) });
    const route = routes[path];
    if (!route) {
      res.writeHead(404).end("not found");
      return;
    }
    route(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((resolve) => {
      // A child's keep-alive socket can outlive the child briefly; without
      // this, close() waits on it and the suite hangs.
      server.closeAllConnections();
      server.close(resolve);
    });
  return { url, requests, close };
}

const json = (status, body) => (_req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const status = (code) => (_req, res) => res.writeHead(code).end();
// Splits one path between the anonymous probe and the authenticated call,
// which is how a JPD that answers 401 anonymously at the root path still
// 404s there once credentials are sent.
const byAuth = (anon, authed) => (req, res) =>
  (req.headers.authorization ? authed : anon)(req, res);

// ---- child-process helpers ----

function run(script, { args = [], env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        PATH: `${fakeJfDir}:${process.env.PATH}`,
        HOME: fakeHome,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// Writes a `jf` that answers the three subcommands lib/jf.mjs uses, wired to
// `url`. Rewritten per test because each one points at a different port.
function writeFakeJf(url) {
  const cfg = Buffer.from(
    JSON.stringify({ serverId: "test", url, accessToken: "tok" }),
  ).toString("base64");
  const configShow = JSON.stringify([
    { serverId: "test", url, isDefault: true },
  ]);
  writeFileSync(
    join(fakeJfDir, "jf"),
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "jf version 2.0.0"; exit 0; fi',
      `if [ "$1" = "config" ] && [ "$2" = "show" ]; then echo '${configShow}'; exit 0; fi`,
      `if [ "$1" = "config" ] && [ "$2" = "export" ]; then echo '${cfg}'; exit 0; fi`,
      'echo "fake jf: unsupported: $@" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeJfDir, "jf"), 0o755);
}

async function runCatalog(routes) {
  const jpd = await startJpd(routes);
  writeFakeJf(jpd.url);
  try {
    const result = await run(CATALOG_SCRIPT);
    return { ...result, ...jpd, report: JSON.parse(result.stdout.trim()) };
  } finally {
    await jpd.close();
  }
}

async function runGuard(routes) {
  const jpd = await startJpd(routes);
  try {
    const result = await run(GUARD_SCRIPT, {
      env: { JFROG_URL: jpd.url, JFROG_ACCESS_TOKEN: "tok" },
    });
    return { ...result, ...jpd };
  } finally {
    await jpd.close();
  }
}

after(() => {
  // The sandbox lives under the OS temp dir; leaving it is harmless and
  // avoids a recursive rm racing a still-exiting child on slow CI.
});

describe("jfrog-agent-guard-check.mjs", { skip: windows }, () => {
  const ENABLED = { settings: { mcpGatewayPluginEnabled: true } };
  const DISABLED = { settings: { mcpGatewayPluginEnabled: false } };

  test("SaaS: root answers, /bridge-client is never probed", async () => {
    const { code, stdout, requests } = await runGuard({
      [SETTINGS_PATH]: json(200, ENABLED),
    });
    assert.equal(code, 0);
    assert.match(stdout, /^Enabled:/);
    assert.deepEqual(
      requests.map((r) => r.path),
      [SETTINGS_PATH],
    );
  });

  test("self-hosted: a root 404 is retried behind /bridge-client", async () => {
    const { code, stdout, requests } = await runGuard({
      [BRIDGE + SETTINGS_PATH]: json(200, ENABLED),
    });
    assert.equal(code, 0);
    assert.match(stdout, /^Enabled:/);
    assert.deepEqual(
      requests.map((r) => r.path),
      [SETTINGS_PATH, BRIDGE + SETTINGS_PATH],
    );
  });

  test("self-hosted: a registry turned off behind /bridge-client exits 2", async () => {
    const { code, stdout } = await runGuard({
      [BRIDGE + SETTINGS_PATH]: json(200, DISABLED),
    });
    assert.equal(code, 2);
    assert.match(stdout, /^RegistryDisabled:/);
  });

  test("neither path hosts the setting: unchanged Unknown + exit 1", async () => {
    const { code, stdout, requests } = await runGuard({});
    assert.equal(code, 1);
    assert.equal(stdout.trim(), "Unknown: settings endpoint returned HTTP 404");
    assert.equal(requests.length, 2);
  });

  test("a 401 at the root is not retried and keeps its reason", async () => {
    const { code, stdout, requests } = await runGuard({
      [SETTINGS_PATH]: status(401),
      [BRIDGE + SETTINGS_PATH]: json(200, ENABLED),
    });
    assert.equal(code, 1);
    assert.equal(stdout.trim(), "Unknown: settings endpoint returned HTTP 401");
    assert.deepEqual(
      requests.map((r) => r.path),
      [SETTINGS_PATH],
    );
  });

  test("an inconclusive /bridge-client reply keeps the root 404 verdict", async () => {
    const { code, stdout } = await runGuard({
      [BRIDGE + SETTINGS_PATH]: status(500),
    });
    assert.equal(code, 1);
    assert.equal(stdout.trim(), "Unknown: settings endpoint returned HTTP 404");
  });
});

describe("jfrog-detect-catalog-runtime.mjs", { skip: windows }, () => {
  const CATALOG_BODY = { projectKeys: [] };

  test("SaaS: root answers, /bridge-client is never probed", async () => {
    const { code, report, requests } = await runCatalog({
      [CATALOG_PATH]: json(200, CATALOG_BODY),
    });
    assert.equal(code, 0);
    assert.equal(report.status, "green");
    assert.ok(requests.every((r) => !r.path.startsWith(BRIDGE)));
  });

  test("self-hosted: Part A resolves the prefix on a 404", async () => {
    const { code, report, requests } = await runCatalog({
      [BRIDGE + CATALOG_PATH]: json(200, CATALOG_BODY),
    });
    assert.equal(code, 0);
    assert.equal(report.status, "green");
    // Anonymous root 404, anonymous bridge, then the authenticated bridge
    // call — Part B must inherit Part A's resolved prefix, not re-probe root.
    assert.deepEqual(requests, [
      { path: CATALOG_PATH, authed: false },
      { path: BRIDGE + CATALOG_PATH, authed: false },
      { path: BRIDGE + CATALOG_PATH, authed: true },
    ]);
  });

  test("self-hosted: Part B resolves it when the root 401s anonymously", async () => {
    // Part A passes at the root path, so only the authenticated call can
    // discover the /bridge-client layout.
    const { code, report, requests } = await runCatalog({
      [CATALOG_PATH]: byAuth(status(401), status(404)),
      [BRIDGE + CATALOG_PATH]: json(200, CATALOG_BODY),
    });
    assert.equal(code, 0);
    assert.equal(report.status, "green");
    assert.deepEqual(requests, [
      { path: CATALOG_PATH, authed: false },
      { path: CATALOG_PATH, authed: true },
      { path: BRIDGE + CATALOG_PATH, authed: true },
    ]);
  });

  test("self-hosted: a 403 behind /bridge-client is not_entitled, not red", async () => {
    const { code, report } = await runCatalog({
      [CATALOG_PATH]: byAuth(status(401), status(404)),
      [BRIDGE + CATALOG_PATH]: status(403),
    });
    assert.equal(code, 4);
    assert.equal(report.status, "not_entitled");
  });

  test("neither path hosts the catalog: unchanged red + exit 1", async () => {
    const { code, report, url, requests } = await runCatalog({});
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    // The detail must still name the ROOT endpoint, exactly as before.
    assert.equal(
      report.detail,
      `catalog endpoint returned 404 at ${url}${CATALOG_PATH}?pageSize=1 — this JPD may not host the AI Catalog`,
    );
    assert.deepEqual(
      requests.map((r) => r.path),
      [CATALOG_PATH, BRIDGE + CATALOG_PATH],
    );
  });

  test("an authenticated 404 on both paths stays red and names the root", async () => {
    const { code, report, url, requests } = await runCatalog({
      [CATALOG_PATH]: byAuth(status(401), status(404)),
    });
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    assert.equal(
      report.detail,
      `catalog endpoint returned 404 at ${url}${CATALOG_PATH}?pageSize=1 — this JPD may not host the AI Catalog`,
    );
    assert.deepEqual(requests, [
      { path: CATALOG_PATH, authed: false },
      { path: CATALOG_PATH, authed: true },
      { path: BRIDGE + CATALOG_PATH, authed: true },
    ]);
  });

  test("a /bridge-client reply that is not a deployed catalog never wins", async () => {
    // A proxy answering unknown paths with 400/501, or the bridge path itself
    // erroring, must leave the root 404 verdict — turning the non-blocking
    // exit 1 into an exit 3 would block the whole jfrog-init walk.
    for (const bridge of [status(400), status(501), status(503)]) {
      const { code, report } = await runCatalog({
        [BRIDGE + CATALOG_PATH]: bridge,
      });
      assert.equal(code, 1);
      assert.equal(report.status, "red");
      assert.match(report.detail, /may not host the AI Catalog/);
    }
  });

  test("an authenticated /bridge-client 401 does not blame the credentials", async () => {
    // A WAF that rejects the bearer on unknown paths would otherwise be
    // reported as "credentials rejected" (exit 3) for creds that are fine.
    const { code, report } = await runCatalog({
      [CATALOG_PATH]: byAuth(status(401), status(404)),
      [BRIDGE + CATALOG_PATH]: status(401),
    });
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    assert.match(report.detail, /may not host the AI Catalog/);
  });

  test("a captive 200 behind /bridge-client does not win either", async () => {
    const { code, report } = await runCatalog({
      [CATALOG_PATH]: byAuth(status(401), status(404)),
      [BRIDGE + CATALOG_PATH]: json(200, { login: "please" }),
    });
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    assert.match(report.detail, /may not host the AI Catalog/);
  });

  test("a non-404 root failure is never retried", async () => {
    const { code, report, requests } = await runCatalog({
      [CATALOG_PATH]: status(503),
      [BRIDGE + CATALOG_PATH]: json(200, CATALOG_BODY),
    });
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    assert.match(report.detail, /HTTP 503 \(server error\)/);
    assert.deepEqual(
      requests.map((r) => r.path),
      [CATALOG_PATH],
    );
  });

  test("an unreachable JPD is reported as such, with no fallback probe", async () => {
    // Bind a port, learn it, then release it: nothing is listening, so the
    // anonymous probe fails with "000" rather than 404.
    const jpd = await startJpd({});
    const { url } = jpd;
    await jpd.close();
    writeFakeJf(url);
    const { code, stdout } = await run(CATALOG_SCRIPT);
    const report = JSON.parse(stdout.trim());
    assert.equal(code, 1);
    assert.equal(report.status, "red");
    assert.match(report.detail, /connection failed/);
  });
});
