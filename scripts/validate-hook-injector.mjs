#!/usr/bin/env node

// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

// Smoke test for the sessionStart injector + plugin packaging, grouped into:
//   Syntax         — the injector exists and parses.
//   Lint           — plugin.json / hooks.json / template wiring is internally
//                    consistent (name, paths).
//   Format         — running the injector emits a well-formed sessionStart
//                    payload (valid JSON, correct shape).
//   Injection logic — the payload actually carries the real template, and
//                    fail-closed paths emit {}.
// A template-filename / read-path mismatch makes the injector silently emit
// nothing (it catches the read error and exits 0); these checks turn that
// silent failure into a hard error.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "plugins", "jfrog");
const injector = path.join(pluginDir, "scripts", "inject-instructions.mjs");
const templatesDir = path.join(pluginDir, "templates");
const hooksFile = path.join(pluginDir, "hooks", "hooks.json");
const pluginManifestFile = path.join(pluginDir, ".cursor-plugin", "plugin.json");

const failures = [];

function section(title) {
  console.log(`\n${title}`);
}

function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL ${label}\n         ${error.message}`);
  }
}

// Run the injector with a clean copy of the env plus the given overrides, so an
// inherited force-flag or real JFrog credentials can't skew the result.
function runInjector(overrides) {
  const env = { ...process.env };
  delete env._JF_AGENT_GUARD_FORCE_DISABLE;
  delete env.JF_AGENT_GUARD_FORCE_ENABLE;
  return execFileSync(process.execPath, [injector], {
    encoding: "utf8",
    env: { ...env, ...overrides },
  });
}

// Same as runInjector, but also captures stderr and clears any JFrog env vars
// so the jf-CLI fallback in resolveCredentials() is actually reachable.
function runInjectorWithDebug(overrides) {
  const env = { ...process.env };
  delete env._JF_AGENT_GUARD_FORCE_DISABLE;
  delete env.JF_AGENT_GUARD_FORCE_ENABLE;
  delete env.JFROG_URL;
  delete env.JF_URL;
  delete env.JFROG_ACCESS_TOKEN;
  delete env.JF_ACCESS_TOKEN;
  const result = spawnSync(process.execPath, [injector], {
    encoding: "utf8",
    env: { ...env, JF_AGENT_GUARD_DEBUG: "true", ...overrides },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Stubs a fake `jf` executable on PATH that emits the given config token, so
// the CLI-fallback path can be exercised without a real JFrog CLI install.
function withFakeJfOnPath(configToken, fn) {
  const bin = mkdtempSync(path.join(tmpdir(), "fake-jf-"));
  const jfPath = path.join(bin, "jf");
  writeFileSync(jfPath, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(configToken)});\n`);
  chmodSync(jfPath, 0o755);
  try {
    return fn(`${bin}${path.delimiter}${process.env.PATH}`);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

function main() {
  console.log("Validating sessionStart injector + plugin packaging…");

  // ---- Syntax: the injector exists and is parseable JS ----
  section("Syntax");
  check("injector source exists", () => {
    if (!existsSync(injector)) throw new Error(`missing: ${injector}`);
  });
  check("injector parses (node --check)", () => {
    execFileSync(process.execPath, ["--check", injector], { stdio: "pipe" });
  });

  // ---- Lint: manifest, hook wiring, and template read-path are consistent ----
  section("Lint (manifest & wiring)");

  check("plugin.json is named the jfrog plugin", () => {
    const pluginManifest = JSON.parse(readFileSync(pluginManifestFile, "utf8"));
    if (pluginManifest.name !== "jfrog") {
      throw new Error(`plugin.json name "${pluginManifest.name}" is not "jfrog"`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(pluginManifest.version ?? "")) {
      throw new Error(`plugin.json version is missing or not semver: ${JSON.stringify(pluginManifest.version)}`);
    }
  });

  check("hooks.json wires sessionStart to the injector", () => {
    const hooks = JSON.parse(readFileSync(hooksFile, "utf8"));
    const entries = hooks?.hooks?.sessionStart;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("hooks.json has no sessionStart hooks");
    }
    const commands = entries.map((e) => e.command ?? "");
    if (!commands.some((c) => c.includes("inject-instructions.mjs"))) {
      throw new Error("no sessionStart command references inject-instructions.mjs");
    }
  });

  // The filename the injector reads must match a real, non-empty template.
  let templateName;
  check("injector reads an existing template file", () => {
    const src = readFileSync(injector, "utf8");
    const match = src.match(/"templates"\s*,\s*"([^"]+)"/);
    if (!match) throw new Error("could not find the templates/<file> read path in the injector");
    templateName = match[1];
    const templatePath = path.join(templatesDir, templateName);
    if (!existsSync(templatePath)) {
      throw new Error(`injector reads "${templateName}" but it does not exist in plugins/jfrog/templates/`);
    }
    if (statSync(templatePath).size === 0) {
      throw new Error(`template "${templateName}" is empty`);
    }
  });

  // ---- Format: force-enable emits a well-formed sessionStart payload ----
  section("Format (injected payload shape)");
  let injectedContext;
  check("force-enable emits valid JSON with a non-empty additional_context", () => {
    const stdout = runInjector({ JF_AGENT_GUARD_FORCE_ENABLE: "true", JFROG_URL: "https://example.jfrog.io" });
    if (!stdout.trim()) throw new Error("stdout was empty");
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`stdout did not parse as JSON: ${error.message}`);
    }
    if (typeof payload?.additional_context !== "string" || payload.additional_context.trim().length === 0) {
      throw new Error("additional_context is missing or empty");
    }
    injectedContext = payload.additional_context;
  });

  // ---- Injection logic: the payload is the real template; fail-closed works ----
  section("Injection logic");
  check("force-enable injects the actual template, byte-for-byte", () => {
    if (injectedContext === undefined) throw new Error("force-enable payload not captured (see Format check)");
    if (!templateName) throw new Error("template name was not resolved (see Lint check)");
    const expected = readFileSync(path.join(templatesDir, templateName), "utf8");
    if (injectedContext !== expected) {
      throw new Error("injected additionalContext does not match the template file content");
    }
  });
  // ---- jf CLI fallback: resolveCredentials() falls back to `jf config export` ----
  section("jf CLI fallback");
  check("resolves credentials via 'jf config export' when env vars are unset", () => {
    const token = Buffer.from(
      JSON.stringify({ url: "https://example.jfrog.io", accessToken: "fake-token", serverId: "test-server" }),
    ).toString("base64");
    withFakeJfOnPath(token, (fakePath) => {
      const { stderr } = runInjectorWithDebug({ PATH: fakePath });
      if (!stderr.includes("Resolved credentials via 'jf config export'")) {
        throw new Error(`expected debug log confirming jf CLI fallback, got:\n${stderr}`);
      }
    });
  });

  check("force-disable emits {} (fail-closed)", () => {
    const stdout = runInjector({ _JF_AGENT_GUARD_FORCE_DISABLE: "true" }).trim();
    if (stdout !== "{}") throw new Error(`expected "{}", got ${JSON.stringify(stdout)}`);
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();
