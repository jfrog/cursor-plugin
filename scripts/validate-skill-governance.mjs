#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

// Tests the skill-governance hook wiring. hooks.json starts a node launcher
// (plugins/jfrog/scripts/enforce-skill.mjs), which spawns agent-guard via npx. The launcher is not
// a policy engine: it only builds the argv, the deadline, and a spawn that Windows can run.
// Cursor's hook schema has no `shell` field, so on Windows the hook string runs in cmd/PowerShell
// and cannot be a POSIX one-liner. This validator asserts that shape, the Windows spawn plan, and
// then EXECUTES the real command string out of hooks.json against a stub agent-guard.
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
//  4. npx ONLY (spawned by the launcher), with no `command -v agent-guard` fast path: a binary earlier on PATH could be
//     anything, whereas npx always resolves the package from the pinned registry.
//
// The plugin root comes from CURSOR_PLUGIN_ROOT, which Cursor sets for a plugin hook (measured
// on Cursor 3.4.20) — the direct analogue of CLAUDE_PLUGIN_ROOT.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "jfrog");
const hooks = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));

const RELEASES_REGISTRY = "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";
const LAUNCHER_COMMAND = 'node "./scripts/enforce-skill.mjs"';
const GOVERNED_STEPS = ["beforeSubmitPrompt", "preToolUse"];
// An absolute sh: the PATH below is deliberately minimal, so `sh` by name would not resolve.
const SH = "/bin/sh";

const sandbox = mkdtempSync(path.join(tmpdir(), "cursor-gov-"));
const binDir = path.join(sandbox, "bin");
mkdirSync(binDir, { recursive: true });
// A directory holding ONLY node, so the stub's shebang resolves while the real npx stays
// unreachable. Using node's own directory would defeat the "npx is missing" check, because the
// real npx sits right beside node — that check would then reach the network instead of exercising
// the 127 path.
// `date` lives here too. The hook used to read the clock with `$(date +%s)`; the launcher now
// reads it in process, and `noDateDir` below drops `date` to prove the hook no longer needs it.
// Keeping it beside node (not by adding /bin to PATH) preserves the isolate mode, where npx
// must stay unreachable.
const nodeDir = path.join(sandbox, "node-only");
mkdirSync(nodeDir, { recursive: true });
symlinkSync(process.execPath, path.join(nodeDir, "node"));
symlinkSync("/bin/date", path.join(nodeDir, "date"));
// `base64` for the same reason: Cursor delivers the event as `printf %s '<b64>' | base64 -d |
// <command>` (see runHook), so without it the harness would hand agent-guard an empty pipe and
// every stdin assertion would fail for a reason that has nothing to do with the hook.
const base64Bin = ["/usr/bin/base64", "/bin/base64"].find((p) => existsSync(p));
if (!base64Bin) throw new Error("base64 not found; cannot reproduce Cursor's payload delivery");
symlinkSync(base64Bin, path.join(nodeDir, "base64"));

// The same directory WITHOUT `date`, for the one check that asserts the hook does not need it. Built as
// its own directory rather than by unlinking `date` between runs, so the checks stay order-
// independent.
const noDateDir = path.join(sandbox, "node-only-nodate");
mkdirSync(noDateDir, { recursive: true });
symlinkSync(process.execPath, path.join(noDateDir, "node"));
symlinkSync(base64Bin, path.join(noDateDir, "base64"));

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
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin: input, deadline: process.env.JF_AGENT_GUARD_ENFORCE_DEADLINE ?? "", retries: process.env.npm_config_fetch_retries ?? "", fetchTimeout: process.env.npm_config_fetch_timeout ?? "" }));
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
function runHook(command, payload, { isolate = false, noDate = false, extraEnv = {}, shell = SH } = {}) {
  const b64 = Buffer.from(payload).toString("base64");
  const wrapped = `printf %s '${b64}' | base64 -d | ${command}`;
  const result = spawnSync(shell, ["-c", wrapped], {
    // The hook path is relative (`./scripts/…`), like the sessionStart hooks: Cursor runs plugin
    // hooks from the plugin root.
    cwd: pluginRoot,
    // fd 0 is /dev/null, exactly as Cursor leaves it. A hook that only works because the
    // harness fed it stdin does not work in Cursor.
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "buffer",
    timeout: 30_000,
    env: {
      PATH: isolate ? nodeDir : `${binDir}:${noDate ? noDateDir : nodeDir}`,
      HOME: sandbox,
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
    const expected = step === "preToolUse" ? `${LAUNCHER_COMMAND} --prefer-offline` : LAUNCHER_COMMAND;
    assert(h.command === expected,
      `${step} must be the node launcher. A POSIX env prefix or $(...) never starts under ` +
      `cmd/PowerShell, which is what Cursor uses on Windows. Got: ${h.command}`);
    assert(!h.command.includes("$"), `${step} command must not use shell substitution`);
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

  check(`${step} leaves time for an npx cold start`, () => {
    const h = entriesFor(step)[0];
    assert((h.timeout ?? 0) >= 30, `${step} timeout ${h.timeout} is too short for an npx cold start`);
  });

  check(`${step} cannot pin the agent-guard version from the hook string`, () => {
    const h = entriesFor(step)[0];
    // The package spec lives in the launcher; the hook string must not grow a pin of its own.
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

check("the two governed hooks differ ONLY in the cache flag", () => {
  const norm = (c) => c.replace(" --prefer-offline", "");
  assert(norm(commandFor("beforeSubmitPrompt")) === norm(commandFor("preToolUse")),
    "the two surfaces must enforce identically apart from --prefer-offline; they have drifted:\n" +
    `  beforeSubmitPrompt: ${commandFor("beforeSubmitPrompt")}\n  preToolUse: ${commandFor("preToolUse")}`);
});

check("every hook command is valid POSIX sh", () => {
  for (const step of Object.keys(hooks.hooks ?? {})) {
    for (const h of entriesFor(step)) {
      const r = spawnSync(SH, ["-n", "-c", h.command], { encoding: "utf8" });
      assert(r.status === 0, `${step} command is not valid sh: ${r.stderr.trim()}`);
    }
  }
});

// Strip every $(…) / $((…)) group, leaving only the command's TOP-LEVEL text. A ';' inside a
// substitution is scoped and harmless; one outside it is not.
const topLevelOf = (s) => {
  let out = "", depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("$(", i)) { depth++; i++; continue; }
    if (depth && s[i] === "(") { depth++; continue; }
    if (depth && s[i] === ")") { depth--; continue; }
    if (!depth) out += s[i];
  }
  return out;
};

// MLAI-1310, the regression this file failed to catch. Cursor appends our command to a pipeline
// it builds — `printf %s '<b64>' | base64 -d | <command>` — so a governed command must be ONE
// simple command. A top-level `;`, `&&` or `||` ends that pipeline, and agent-guard then reads
// the shell's stdin, which Cursor set to /dev/null: 0 bytes, no classifiable event, and a
// no-opinion ALLOW at exit 0 that is indistinguishable from "this prompt was not a skill".
//
// Asserted statically as well as behaviourally below, because this names the property and fails
// with the offending text instead of a mystery allow.
check("no governed command has a top-level ';', '&&' or '||' (it is the tail of Cursor's pipeline)", () => {
  for (const step of GOVERNED_STEPS) {
    const top = topLevelOf(commandFor(step));
    for (const op of [";", "&&", "||"]) {
      assert(!top.includes(op),
        `${step}: a top-level "${op}" severs the payload pipeline Cursor builds, so agent-guard ` +
        `reads /dev/null and silently allows (MLAI-1310). Keep it inside $( ).\n` +
        `         top-level text: ${top.trim()}`);
    }
  }
});

// The launcher owns what the hook string used to: the npm fetch bounds (npm's default of 2 retries
// backs off 10s then 60s; its default fetch timeout is 300000ms), a deadline computed fresh at
// invocation that replaces any inherited value, and an unpinned package spec. On Windows it spawns
// npx.cmd through cmd.exe, so a PowerShell ComSpec cannot parse the argument list.
await check("the launcher builds a bounded, unpinned spawn plan, with npx.cmd through cmd.exe on Windows", async () => {
  const mod = await import(pathToFileURL(path.join(pluginRoot, "scripts", "enforce-skill.mjs")).href);
  assert(typeof mod.resolveEnforceSpawn === "function", "enforce-skill.mjs must export resolveEnforceSpawn");
  const nowSec = 1_700_000_000;
  const common = {
    env: {
      JF_AGENT_GUARD_ENFORCE_DEADLINE: "1",
      JFROG_AGENT_GUARD_VERSION: "0.0.0-master.1.gabc",
      PATH: "C:\\Windows\\System32",
    },
    nowSec,
  };
  const win = mod.resolveEnforceSpawn({ ...common, preferOffline: true, platform: "win32" });
  assert(win.command === "npx.cmd", `Windows must spawn npx.cmd, got ${win.command}`);
  assert(win.shell === "cmd.exe",
    `Windows must pin cmd.exe so ComSpec cannot select PowerShell, got ${String(win.shell)}`);
  assert(win.args.includes('"--prefer-offline"'), `missing offline flag: ${win.args}`);
  assert(win.args.includes(`"${RELEASES_REGISTRY}"`), `registry must be quoted for cmd.exe: ${win.args}`);
  assert(win.args.includes('"@jfrog/agent-guard"'), `package spec must stay unpinned: ${win.args}`);
  assert(win.args.includes('"cursor"'), `--client must be cursor: ${win.args}`);
  assert(!win.args.some((arg) => arg.includes("@jfrog/agent-guard@")),
    `JFROG_AGENT_GUARD_VERSION must not pin the spec: ${win.args}`);
  assert(win.env.JF_AGENT_GUARD_ENFORCE_DEADLINE === String(nowSec + 25),
    `deadline must replace an inherited value; got ${win.env.JF_AGENT_GUARD_ENFORCE_DEADLINE}`);
  assert(win.env.npm_config_fetch_retries === "0",
    "npm_config_fetch_retries=0 is required: npm's default of 2 backs off 10s then 60s");
  assert(win.env.npm_config_fetch_timeout === "10000",
    `npm_config_fetch_timeout must be 10000 (npm's default is 300000), got ${win.env.npm_config_fetch_timeout}`);
  const quoted = mod.resolveEnforceSpawn({
    preferOffline: false,
    env: { JFROG_AGENT_GUARD_REPO: "https://example.invalid/npm/?a=1&b=2" },
    nowSec,
    platform: "win32",
  });
  assert(quoted.args.includes('"https://example.invalid/npm/?a=1&b=2"'),
    `a registry & must stay inside one cmd.exe argument: ${quoted.args}`);
  assert(!quoted.args.includes('"--prefer-offline"'), `beforeSubmitPrompt must refresh the cache: ${quoted.args}`);
  const unix = mod.resolveEnforceSpawn({ ...common, preferOffline: false, platform: "linux" });
  assert(unix.command === "npx" && unix.shell === false,
    `Unix must spawn npx with no shell, got ${unix.command} shell=${String(unix.shell)}`);
  assert(unix.args[unix.args.indexOf("--registry") + 1] === RELEASES_REGISTRY, `default registry drifted: ${unix.args}`);
  assert(!unix.args.includes("--prefer-offline"), `offline flag leaked: ${unix.args}`);
  const stale = mod.resolveEnforceSpawn({
    preferOffline: false,
    env: { JF_AGENT_GUARD_ENFORCE_DEADLINE: "1" },
    nowSec: Number.NaN,
    platform: "linux",
  });
  assert(stale.env.JF_AGENT_GUARD_ENFORCE_DEADLINE === undefined,
    `an unusable clock must drop an inherited deadline, got ${stale.env.JF_AGENT_GUARD_ENFORCE_DEADLINE}`);
  const budgetS = Number(unix.env.JF_AGENT_GUARD_ENFORCE_DEADLINE) - nowSec;
  for (const step of GOVERNED_STEPS) {
    assert(budgetS < (entriesFor(step)[0]?.timeout ?? 0),
      `${step}: the deadline (+${budgetS}s) must fall inside the hook timeout, or agent-guard is killed before it can write its verdict`);
  }
});

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
    assert(seen.retries === "0" && seen.fetchTimeout === "10000",
      `fetch must be bounded: retries=${seen.retries} timeout=${seen.fetchTimeout}`);
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

  // The deadline used to be $(date +%s) inside the hook string. That binary is absent from a
  // minimal Windows PATH, and cmd/PowerShell cannot parse the substitution anyway. The launcher
  // reads the clock in process, so a missing date(1) must not empty the deadline or drop the payload.
  await check(`${step}: with no date(1) on PATH, the deadline is still in the future and the payload arrives`, async () => {
    const record = stubNpx({ stdout: "{}" });
    const payload = payloadFor(step);
    const before = Math.floor(Date.now() / 1000);
    const r = runHook(commandFor(step), payload, { noDate: true });
    assert(r.code === 0, `exit=${r.code} stderr=${r.stderr}`);
    const seen = JSON.parse(readFileSync(record, "utf8"));
    const deadline = Number(seen.deadline);
    assert(Number.isFinite(deadline) && deadline > before,
      `a missing date(1) must not block the clock; got ${JSON.stringify(seen.deadline)}`);
    assert(seen.stdin === payload,
      `losing date(1) must not cost the payload: agent-guard received ${seen.stdin.length} bytes, expected ${payload.length}`);
  });

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

  await check(`${step}: an agent-guard failure fails OPEN, not closed`, async () => {
    stubNpx({ stdout: "", exitCode: 1 });
    const r = runHook(commandFor(step), payloadFor(step));
    assert(!blocks(r),
      `an internal failure must let the skill through, got exit=${r.code} stdout=${r.stdout}`);
  });

  // With npx absent the guard never runs at all. That machine is not governed, so it must not be
  // punished: this is the case `|| exit 2` used to convert into a block.
  await check(`${step}: npx missing entirely fails OPEN`, async () => {
    const r = runHook(commandFor(step), payloadFor(step), { isolate: true });
    assert(!blocks(r), `a missing npx must fail open, got exit=${r.code} stdout=${r.stdout}`);
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
