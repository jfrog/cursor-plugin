#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

// Tests the skill-governance hook wiring. hooks.json runs the node launcher
// modules/core/enforce-skill.mjs, which spawns agent-guard via npx — no plugin-side governance
// code at all — so this validator asserts the wiring's shape and then EXECUTES the real command
// string out of hooks.json against a stub agent-guard. The launcher owns the deadline, the npm
// fetch bounds, the --server argument and the fail-open answer; its unit tests live with the
// hooks modules.
//
// Four properties carry the whole design, and each is asserted below:
//
//  1. A Cursor verdict travels as JSON on stdout with exit 0. `failClosed` is a crash net, not
//     how a block is signalled — so the hook must NOT wrap the call in `|| exit 2`. An allow is
//     explicit JSON (`{}`), never silence.
//
//  2. Infrastructure failure fails OPEN. npx missing, a failed install, an unreachable registry
//     or no configured JFrog server must let the skill through: a machine that cannot run the
//     guard is not governed by it, and refusing every skill there enforces nothing except the
//     user's inability to work. `failClosed: false` is what makes that true for crashes and
//     timeouts; a real policy denial still blocks, because it rides in the JSON payload.
//
//  3. Nothing may pin the agent-guard version. The hook resolves `latest` so a shipped GA fix
//     reaches users without a plugin release.
//
//  4. npx ONLY, with no `command -v agent-guard` fast path: a binary earlier on PATH could be
//     anything, whereas npx always resolves the package from the pinned registry.
//
// The plugin root comes from CURSOR_PLUGIN_ROOT, which Cursor sets for a plugin hook (measured
// on Cursor 3.4.20) — the direct analogue of CLAUDE_PLUGIN_ROOT.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "jfrog");
const hooks = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));

const RELEASES_REGISTRY = "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";
const GOVERNED_STEPS = ["beforeSubmitPrompt", "preToolUse"];
// Relative because Cursor runs hook commands with the plugin root as the working directory.
const LAUNCHER_COMMAND = 'node "./modules/core/enforce-skill.mjs" --client cursor';
const expectedCommand = (step) =>
  step === "preToolUse" ? `${LAUNCHER_COMMAND} --prefer-offline` : LAUNCHER_COMMAND;
// An absolute sh: the PATH below is deliberately minimal, so `sh` by name would not resolve.
const SH = "/bin/sh";

const sandbox = mkdtempSync(path.join(tmpdir(), "cursor-gov-"));
const binDir = path.join(sandbox, "bin");
mkdirSync(binDir, { recursive: true });
// A directory holding ONLY node, so the stub's shebang resolves while the real npx stays
// unreachable. Using node's own directory would defeat the "npx is missing" check, because the
// real npx sits right beside node — that check would then reach the network instead of exercising
// the 127 path.
// The launcher reads the clock itself, so `date` is no longer needed on PATH.
const nodeDir = path.join(sandbox, "node-only");
mkdirSync(nodeDir, { recursive: true });
symlinkSync(process.execPath, path.join(nodeDir, "node"));
// `base64` for the same reason: Cursor delivers the event as `printf %s '<b64>' | base64 -d |
// <command>` (see runHook), so without it the harness would hand agent-guard an empty pipe and
// every stdin assertion would fail for a reason that has nothing to do with the hook.
const base64Bin = ["/usr/bin/base64", "/bin/base64"].find((p) => existsSync(p));
if (!base64Bin) throw new Error("base64 not found; cannot reproduce Cursor's payload delivery");
symlinkSync(base64Bin, path.join(nodeDir, "base64"));

// JFROG_CLI_HOME_DIR sandboxes holding (or lacking) setup.json, which the launcher reads through
// modules/core/jfrog-ai-governance-config.mjs. Every run gets one, so the developer's real
// ~/.jfrog never leaks into a check.
const cliHome = (name, setup) => {
  const dir = path.join(sandbox, `cli-home-${name}`);
  mkdirSync(dir, { recursive: true });
  if (setup) writeFileSync(path.join(dir, "setup.json"), JSON.stringify(setup));
  return dir;
};
const emptyCliHome = cliHome("empty");

const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures.push(label); console.log(`  FAIL ${label}\n         ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const entriesFor = (step) => hooks?.hooks?.[step] ?? [];
const commandFor = (step) => entriesFor(step)[0]?.command ?? "";
// A blocking answer is a deny in the JSON, or agent-guard's own exit 2. Anything else lets the
// skill through — which is what "fails open" has to mean on a failClosed:false hook.
const blocks = (r) => r.code === 2 || /"permission"\s*:\s*"deny"|"continue"\s*:\s*false/.test(r.stdout);

// A stub npx that records the argv it was handed and the stdin it received, then replays a canned
// result. Installed as `npx` so the hook command finds it first on PATH.
function stubNpx({ stdout = "", exitCode = 0 }) {
  const record = path.join(sandbox, "record.json");
  rmSync(record, { force: true });
  writeFileSync(path.join(binDir, "npx"), `#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin: input, deadline: process.env.JF_AGENT_GUARD_ENFORCE_DEADLINE ?? "", retries: process.env.npm_config_fetch_retries ?? "", fetchTimeout: process.env.npm_config_fetch_timeout ?? "", env: { JF_PROJECT: process.env.JF_PROJECT, JFROG_PROJECT: process.env.JFROG_PROJECT } }));
  if (${JSON.stringify(stdout)}) process.stdout.write(${JSON.stringify(stdout)});
  process.exit(${exitCode});
});
`, { mode: 0o755 });
  chmodSync(path.join(binDir, "npx"), 0o755);
  return record;
}

// Deliver the payload EXACTLY as Cursor does. How the event ARRIVES is the part most likely to
// break, and it is not the way Claude Code does it: on macOS and Linux Cursor never writes the
// event to the hook process's stdin. It base64s the JSON into the command string, pipes it in
// from a pipeline the spawned shell builds itself, and closes the child's own stdin:
//
//   workbench.desktop.main.js   R = `printf %s '${b64}' | base64 -d | ${command}`
//   extensionHostProcess.js     stdio: [ pipeStdin ? "pipe" : "ignore", "pipe", "pipe" ]
//                               // hooks never pass pipeStdin, so fd 0 is /dev/null
//
// Two consequences, and this function exists to make both testable:
//
//   * our command runs as the TAIL OF A PIPELINE, so a top-level `;`, `&&` or `||` inside it
//     severs the payload; agent-guard then reads /dev/null and renders its no-opinion allow.
//     That is MLAI-1310 — every skill allowed, silently, exit 0.
//   * handing the payload to the shell's own stdin instead, as this helper used to, exercises a
//     delivery path Cursor never uses. All 34 checks below passed that way against a hook that
//     delivered nothing at all.
//
// `isolate` drops the stub from PATH, which is how "npx is not installed at all" is reproduced.
// The working directory is the plugin root, as Cursor sets it: the launcher path is relative.
function runHook(command, payload, { isolate = false, extraEnv = {}, shell = SH, cwd = pluginRoot } = {}) {
  const b64 = Buffer.from(payload).toString("base64");
  const wrapped = `printf %s '${b64}' | base64 -d | ${command}`;
  const result = spawnSync(shell, ["-c", wrapped], {
    // fd 0 is /dev/null, exactly as Cursor leaves it. A hook that only works because the
    // harness fed it stdin does not work in Cursor.
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "buffer",
    cwd,
    timeout: 30_000,
    env: {
      PATH: isolate ? nodeDir : `${binDir}:${nodeDir}`,
      HOME: sandbox,
      JFROG_CLI_HOME_DIR: emptyCliHome,
      CURSOR_PLUGIN_ROOT: pluginRoot,
      ...extraEnv,
    },
  });
  if (result.error) throw new Error(`could not run the hook via ${shell}: ${result.error.message}`);
  return {
    code: result.status,
    stdout: result.stdout ? result.stdout.toString() : "",
    stderr: result.stderr ? result.stderr.toString() : "",
  };
}

console.log("Validating the skill-governance hook wiring…");

check("no plugin-side governance code remains at all", () => {
  const gone = [
    "scripts/governance/block-skill.mjs",
    "scripts/governance/request-waiver.mjs",
    "scripts/governance/helpers/credentials.mjs",
    "scripts/governance/helpers/governance-client.mjs",
    "scripts/governance/helpers/skill-fingerprint.mjs",
    "scripts/governance/helpers/skill-package.mjs",
    "scripts/governance/helpers/skill-path.mjs",
    "scripts/governance/helpers/policy-block.mjs",
    "scripts/governance/helpers/template-messages.mjs",
  ];
  for (const rel of gone) {
    let exists = true;
    try { readFileSync(path.join(pluginRoot, rel)); } catch { exists = false; }
    assert(!exists, `${rel} still exists; all governance logic — waivers included — lives in agent-guard`);
  }
});

check("the package-resolution sessionStart hook is byte-identical", () => {
  // Located by CONTENT, never by index: sessionStart is a shared list that other features append
  // to, so an index pins this check to whatever happens to sit there. It has already moved once.
  const want = 'node "./modules/cursor-session-start.mjs" package-resolution';
  const h = entriesFor("sessionStart").find((e) => e.command === want);
  assert(h, `the package-resolution sessionStart hook is missing or its command was altered; ` +
    `found: ${entriesFor("sessionStart").map((e) => e.command).join(" | ")}`);
  assert(h.timeout === 7, "the package-resolution sessionStart hook timeout was altered");
});

check("one governed hook refreshes the npx cache, the other reads it", () => {
  // Measured under Cursor: a detached sessionStart pre-warm does NOT survive — Cursor kills the
  // hook's process group, and no escape (subshell, `sh -mc`, perl setsid) outruns it. So the
  // refresh has to happen on a hook Cursor waits for.
  //
  // beforeSubmitPrompt fires once per prompt and omits --prefer-offline, so it revalidates against
  // the registry and pulls a newer agent-guard into the cache. preToolUse fires on every Read and
  // keeps --prefer-offline, reading what the prompt hook just refreshed. Measured warm: 1091ms
  // revalidating vs 324ms from cache.
  assert(!entriesFor("sessionStart").some((h) => h.command.includes("@jfrog/agent-guard")),
    "sessionStart must not pre-warm: it is killed with the hook and only pretends to keep the " +
    "cache fresh");
  assert(!commandFor("beforeSubmitPrompt").includes("--prefer-offline"),
    "beforeSubmitPrompt must NOT pass --prefer-offline: it is the only thing that refreshes the " +
    "cache, and without it agent-guard is frozen at whatever version was first fetched");
  assert(commandFor("preToolUse").includes("--prefer-offline"),
    "preToolUse must pass --prefer-offline: it fires on every Read, and revalidating each time " +
    "costs ~770ms per call");
});

for (const step of GOVERNED_STEPS) {
  check(`${step} starts the node launcher, with no POSIX syntax in the hook string`, () => {
    const entries = entriesFor(step);
    assert(entries.length === 1, `expected exactly one ${step} hook, got ${entries.length}`);
    const h = entries[0];
    assert(h.command === expectedCommand(step),
      `${step} must be the node launcher: ${expectedCommand(step)}. A POSIX env prefix or $(...) ` +
      `never starts under PowerShell. Got: ${h.command}`);
    assert(!/[$`;&|]/.test(h.command),
      `${step} command must be a plain node command, with no shell substitution or operators: ${h.command}`);
    assert(!h.command.includes("command -v"),
      `${step} must not have a PATH fast path: a hijackable agent-guard earlier on PATH would win`);
    assert(!/block-skill|governance-client|skill-path|request-waiver|--waiver-helper/.test(h.command),
      `${step} must not route through a plugin governance script; agent-guard owns the waiver flow`);
  });

  check(`${step} fails OPEN: no exit-2 wrapper, and failClosed is off`, () => {
    const h = entriesFor(step)[0];
    assert(!/\|\|\s*exit\b/.test(h.command),
      `${step} must not wrap the call in "|| exit": a Cursor verdict is JSON on exit 0, and ` +
      `converting an npx/install failure into a block refuses every skill on a machine that ` +
      `simply cannot run the guard`);
    assert(h.failClosed === false,
      `${step} must set failClosed: false — a crash or timeout must let the skill through, ` +
      `while a real denial still blocks through the JSON payload`);
  });

  // The deadline, the npm fetch bounds and the registry live in the launcher now, and are
  // asserted behaviourally below against the recorded stub environment.
  check(`${step} lets npx cold-start`, () => {
    const h = entriesFor(step)[0];
    assert((h.timeout ?? 0) >= 30, `${step} timeout ${h.timeout} is too short for an npx cold start`);
  });

  check(`${step} cannot pin the agent-guard version from the hook string`, () => {
    const h = entriesFor(step)[0];
    assert(!h.command.includes("JFROG_AGENT_GUARD_VERSION"),
      `${step} must resolve latest, so a shipped GA fix reaches users without a plugin release`);
    assert(!/@jfrog\/agent-guard@/.test(h.command),
      `${step} hook string must not pin the package: ${h.command}`);
  });
}

check("preToolUse is scoped to Read", () => {
  assert(entriesFor("preToolUse")[0]?.matcher === "Read",
    "preToolUse must match Read: a skill the model discovers surfaces as a read of its SKILL.md");
});

check("beforeSubmitPrompt has no matcher, so every submission is seen", () => {
  assert(entriesFor("beforeSubmitPrompt")[0]?.matcher === undefined,
    "a matcher here would filter out the slash invocations this hook exists to gate");
});

// The server and the project are no longer in the hook string: the launcher reads the AI
// Governance server from setup.json and passes `--server <id>` (or `--server ""`), and strips
// JF_PROJECT / JFROG_PROJECT from agent-guard's environment. Both are asserted behaviourally below.

check("the two governed hooks differ ONLY in the cache flag", () => {
  const norm = (c) => c.replace(" --prefer-offline", "");
  assert(norm(commandFor("beforeSubmitPrompt")) === norm(commandFor("preToolUse")),
    "the two surfaces must enforce identically apart from --prefer-offline; they have drifted:\n" +
    `  beforeSubmitPrompt: ${commandFor("beforeSubmitPrompt")}\n  preToolUse: ${commandFor("preToolUse")}`);
});

// The POSIX-validity and top-level ';' / '&&' / '||' checks (MLAI-1310) are replaced by the
// "plain node command" assertion above: a launcher string with none of `$ ` ; & |` cannot sever
// the pipeline Cursor wraps around it. The behavioural pipeline check below stays, since the
// command still runs as the tail of `printf | base64 -d | <command>`.

// A payload shaped like the surface actually sends, so a check cannot pass by feeding preToolUse's
// event to the prompt hook.
const payloadFor = (step) => step === "preToolUse"
  ? `{"hook_event_name":"preToolUse","tool_name":"Read","tool_input":{"file_path":"/a/b/SKILL.md"}}`
  : `{"hook_event_name":"beforeSubmitPrompt","prompt":"/demo-skill"}`;

// Cursor spawns `process.env.SHELL || "/bin/sh"` with -c, so the command must survive whichever
// shell the user happens to have. Shells absent from the runner are skipped rather than failed.
check("the payload survives Cursor's pipeline under every shell Cursor may pick", () => {
  const shells = ["/bin/sh", "/bin/bash", "/bin/zsh"].filter((s) => existsSync(s));
  assert(shells.length > 0, "no shell found to test with");
  for (const step of GOVERNED_STEPS) {
    for (const shell of shells) {
      const record = stubNpx({ stdout: "{}" });
      const payload = payloadFor(step);
      const r = runHook(commandFor(step), payload, { shell });
      assert(r.code === 0, `${step} under ${shell}: exit=${r.code} stderr=${r.stderr}`);
      const seen = JSON.parse(readFileSync(record, "utf8"));
      assert(seen.stdin === payload,
        `${step} under ${shell}: agent-guard received ${seen.stdin.length} bytes, expected ` +
        `${payload.length}. The payload is not reaching it.`);
    }
  }
});

// ---------------------------------------------------------------------------
// Behavioural: execute the real hooks.json command string.
// ---------------------------------------------------------------------------

// Run every behavioural check against BOTH governed surfaces, not just preToolUse. The
// byte-identical check above already makes divergence loud, but it only holds while it runs first;
// looping here means a future hook that stops being identical is still exercised on its own terms
// rather than inheriting preToolUse's result.
for (const step of GOVERNED_STEPS) {
  await check(`${step}: forwards stdin verbatim and hands agent-guard the expected argv`, async () => {
    const record = stubNpx({ stdout: "{}" });
    const payload = payloadFor(step);
    const r = runHook(commandFor(step), payload);
    assert(r.code === 0, `exit=${r.code} stderr=${r.stderr}`);
    const seen = JSON.parse(readFileSync(record, "utf8"));
    assert(seen.stdin === payload, `stdin altered: ${seen.stdin}`);
    assert(seen.argv.includes("--enforce-skill"), `argv missing --enforce-skill: ${seen.argv}`);
    assert(seen.argv[seen.argv.indexOf("--client") + 1] === "cursor", `bad --client: ${seen.argv}`);
    assert(!seen.argv.includes("--waiver-helper"), `--waiver-helper was removed from agent-guard: ${seen.argv}`);
    assert(seen.argv[seen.argv.indexOf("--registry") + 1] === RELEASES_REGISTRY,
      `must default to the releases registry: ${seen.argv}`);
    if (step === "preToolUse") {
      assert(seen.argv.includes("--prefer-offline"), `preToolUse must read the npx cache: ${seen.argv}`);
    } else {
      assert(!seen.argv.includes("--prefer-offline"), `beforeSubmitPrompt must refresh the registry: ${seen.argv}`);
    }
    // The VALUES, not just presence: npm_config_fetch_timeout=300000 is npm's own default, and
    // npm's default of 2 retries backs off 10s then 60s.
    assert(seen.retries === "0" && seen.fetchTimeout === "10000",
      `fetch must be bounded: retries=${seen.retries} timeout=${seen.fetchTimeout}`);
  });

  // The launcher reads the AI Governance server from ${JFROG_CLI_HOME_DIR}/setup.json. `--server`
  // is always the final pair: the id, or the empty string (present as an argument) when none is
  // set, which agent-guard reads as "no server set".
  for (const [label, setup, expectServer] of [
    ["passes --server <id> as the final arguments when setup.json names a server",
      { version: 2, servers: { srv1: { jpdUrl: "https://srv1.example.com", isDefault: true } } }, "srv1"],
    ["passes --server \"\" (no server set) when there is no setup.json", undefined, ""],
  ]) {
    await check(`${step}: ${label}`, async () => {
      const home = cliHome(`${step}-${expectServer || "none"}`, setup);
      const record = stubNpx({ stdout: "" });
      const r = runHook(commandFor(step), payloadFor(step), { extraEnv: { JFROG_CLI_HOME_DIR: home } });
      assert(r.code === 0, `exit=${r.code} stderr=${r.stderr}`);
      const { argv } = JSON.parse(readFileSync(record, "utf8"));
      assert(argv.slice(-2).join("\u0000") === ["--server", expectServer].join("\u0000"),
        `argv must end with --server ${JSON.stringify(expectServer)}: ${JSON.stringify(argv)}`);
    });
  }

  await check(`${step}: ambient JF_PROJECT / JFROG_PROJECT do not reach agent-guard`, async () => {
    const record = stubNpx({ stdout: "" });
    const r = runHook(commandFor(step), payloadFor(step), {
      extraEnv: { JF_PROJECT: "ambient-a", JFROG_PROJECT: "ambient-b" },
    });
    assert(r.code === 0, `exit=${r.code} stderr=${r.stderr}`);
    const { env } = JSON.parse(readFileSync(record, "utf8"));
    assert(!env.JF_PROJECT && !env.JFROG_PROJECT,
      `project env must be absent or empty: ${JSON.stringify(env)}`);
  });

  await check(`${step}: hands agent-guard a deadline in the future, computed at invocation`, async () => {
    const record = stubNpx({ stdout: "{}" });
    const before = Math.floor(Date.now() / 1000);
    runHook(commandFor(step), payloadFor(step), {
      // A stale value in the environment must NOT survive into the child.
      extraEnv: { JF_AGENT_GUARD_ENFORCE_DEADLINE: "1" },
    });
    const seen = JSON.parse(readFileSync(record, "utf8"));
    const deadline = Number(seen.deadline);
    assert(Number.isFinite(deadline) && deadline > before,
      `the deadline must be recomputed, not inherited; got ${seen.deadline}`);
  });

  // The no-date(1) degrade check is gone: the launcher reads the clock in node, so there is no
  // shell clock to lose.

  await check(`${step}: forwards a deny verdict's stdout verbatim and exits 0 (the JSON decides)`, async () => {
    const deny = step === "preToolUse"
      ? `{"permission":"deny","user_message":"blocked"}`
      : `{"continue":false,"user_message":"blocked"}`;
    stubNpx({ stdout: deny });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.code === 0, `a rendered verdict must exit 0 and let the JSON decide, got ${r.code}`);
    assert(r.stdout === deny, `stdout altered: ${r.stdout}`);
    assert(blocks(r), "a deny payload must read as a block");
  });

  await check(`${step}: an allow is forwarded as-is (Cursor requires explicit JSON, not silence)`, async () => {
    stubNpx({ stdout: "{}" });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.code === 0 && r.stdout === "{}",
      `an allow must be explicit JSON: exit=${r.code} stdout=${r.stdout}`);
    assert(!blocks(r), "an empty object must not read as a block");
  });

  await check(`${step}: output that is not valid JSON is forwarded, not repaired`, async () => {
    stubNpx({ stdout: "not json at all" });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.stdout === "not json at all",
      `the hook must forward bytes verbatim and never rewrite a verdict: ${r.stdout}`);
    assert(!blocks(r), `unparseable output is not a deny; failClosed:false lets it through`);
  });

  await check(`${step}: empty stdout with exit 0 stays empty`, async () => {
    stubNpx({ stdout: "", exitCode: 0 });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.stdout === "", `the hook must not invent a verdict: ${r.stdout}`);
    assert(!blocks(r), "silence is not a deny");
  });

  // The launcher's cursor fail-open: `{}` on stdout, exit 0, and a stderr line naming the cause.
  // Partial output from the failed run is dropped, never spliced into `{}`.
  await check(`${step}: an agent-guard failure fails OPEN with exit 0, {} and a stderr line`, async () => {
    stubNpx({ stdout: `{"permission":"de`, exitCode: 1 });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.code === 0 && r.stdout === "{}",
      `an internal failure must let the skill through, got exit=${r.code} stdout=${r.stdout}`);
    assert(!blocks(r), "a failed run must not read as a block");
    assert(/\[jfrog-agent-guard\] skill governance did not run \(npx exited with code 1\); this skill was not governed\./.test(r.stderr),
      `a fail-open must say why on stderr: ${r.stderr}`);
  });

  // With npx absent the guard never runs at all. That machine is not governed, so it must not be
  // punished.
  await check(`${step}: npx missing entirely fails OPEN with exit 0, {} and a stderr line`, async () => {
    const r = runHook(commandFor(step), payloadFor(step), { isolate: true });
    assert(r.code === 0 && r.stdout === "{}",
      `a missing npx must fail open, got exit=${r.code} stdout=${r.stdout}`);
    assert(/\[jfrog-agent-guard\] skill governance did not run \(could not start npx: .*ENOENT.*\); this skill was not governed\./.test(r.stderr),
      `a fail-open must say why on stderr: ${r.stderr}`);
  });

  await check(`${step}: agent-guard's own exit 2 still blocks`, async () => {
    stubNpx({ stdout: "", exitCode: 2 });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(r.code === 2,
      `agent-guard exits 2 for a block it could not deliver; the hook must not mask it, got ${r.code}`);
  });

  await check(`${step}: JFROG_AGENT_GUARD_REPO redirects the registry, and nothing can pin the version`, async () => {
    const record = stubNpx({ stdout: "{}" });
    runHook(commandFor(step), payloadFor(step), {
      extraEnv: {
        JFROG_AGENT_GUARD_REPO: "https://example.invalid/npm/dev/",
        JFROG_AGENT_GUARD_VERSION: "0.0.0-master.1.gabc",
      },
    });
    const seen = JSON.parse(readFileSync(record, "utf8"));
    assert(seen.argv[seen.argv.indexOf("--registry") + 1] === "https://example.invalid/npm/dev/",
      `registry override ignored: ${seen.argv}`);
    assert(seen.argv.includes("@jfrog/agent-guard"),
      `the package spec must stay unpinned: ${seen.argv}`);
    assert(!seen.argv.some((a) => a.startsWith("@jfrog/agent-guard@")),
      `no environment variable may pin the version: ${seen.argv}`);
  });
}

rmSync(sandbox, { recursive: true, force: true });
if (failures.length) { console.log(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll checks passed.");
