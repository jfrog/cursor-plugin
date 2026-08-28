#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

// Tests the skill-governance hook wiring. hooks.json invokes agent-guard DIRECTLY via npx — no
// plugin-side governance code at all — so this validator asserts the wiring's shape and then
// EXECUTES the real command string out of hooks.json against a stub agent-guard.
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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugins", "jfrog");
const hooks = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));

const RELEASES_REGISTRY = "https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/";
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
// `date` lives here too: the hook computes its deadline with $(date +%s), and a PATH without it
// would silently yield "$(( + 25))" = 25 — an epoch in 1970 — rather than exercising the real
// computation. Keeping it beside node (not by adding /bin to PATH) preserves the isolate mode,
// where npx must stay unreachable.
const nodeDir = path.join(sandbox, "node-only");
mkdirSync(nodeDir, { recursive: true });
symlinkSync(process.execPath, path.join(nodeDir, "node"));
symlinkSync("/bin/date", path.join(nodeDir, "date"));

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
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin: input, deadline: process.env.JF_AGENT_GUARD_ENFORCE_DEADLINE ?? "" }));
  if (${JSON.stringify(stdout)}) process.stdout.write(${JSON.stringify(stdout)});
  process.exit(${exitCode});
});
`, { mode: 0o755 });
  chmodSync(path.join(binDir, "npx"), 0o755);
  return record;
}

// Run a hook command the way Cursor does: the string from hooks.json handed to a shell, the event
// JSON on stdin, and CURSOR_PLUGIN_ROOT set as Cursor sets it. `isolate` drops the stub from PATH,
// which is how "npx is not installed at all" is reproduced.
function runHook(command, payload, { isolate = false, extraEnv = {} } = {}) {
  const result = spawnSync(SH, ["-c", command], {
    input: Buffer.from(payload),
    encoding: "buffer",
    timeout: 30_000,
    env: {
      PATH: isolate ? nodeDir : `${binDir}:${nodeDir}`,
      HOME: sandbox,
      CURSOR_PLUGIN_ROOT: pluginRoot,
      ...extraEnv,
    },
  });
  if (result.error) throw new Error(`could not run the hook via ${SH}: ${result.error.message}`);
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

check("a sessionStart pre-warm refreshes the cache the governed hooks then read", () => {
  const warm = entriesFor("sessionStart").find((h) => h.command.includes("@jfrog/agent-guard"));
  assert(warm, "sessionStart must pre-warm agent-guard: it is the ONLY thing that refreshes the " +
    "npx cache, and without it --prefer-offline below can serve a stale binary indefinitely " +
    "(measured: a cached 1.10.0 kept being used while 1.11.0 was latest, reinstating a bug " +
    "1.11.0 had fixed)");
  assert(!warm.command.includes("--prefer-offline"),
    "the pre-warm MUST hit the registry; --prefer-offline here would defeat its only purpose");
  assert(!warm.command.includes("JFROG_AGENT_GUARD_VERSION"),
    "the pre-warm must refresh to latest, not to a pinned version");
  // Cursor's hook schema has no `async`, so the command detaches itself. Both halves matter:
  // the subshell-and-background returns control immediately, and the explicit exit 0 keeps a
  // spawn failure from surfacing as a failed session-start hook.
  assert(/\(.*&\s*\)/.test(warm.command),
    "the pre-warm must detach (subshell + &) so it cannot delay session start");
  assert(/exit 0\s*$/.test(warm.command.trim()),
    "the pre-warm must end in `exit 0`: a warm failure is never a reason to fail session start");
});

for (const step of GOVERNED_STEPS) {
  check(`${step} invokes agent-guard through npx only, with no plugin script in the path`, () => {
    const entries = entriesFor(step);
    assert(entries.length === 1, `expected exactly one ${step} hook, got ${entries.length}`);
    const h = entries[0];
    assert(/(^|\s)npx\s/.test(h.command), `${step} must invoke npx directly, got: ${h.command}`);
    assert(!h.command.includes("command -v"),
      `${step} must not have a PATH fast path: a hijackable agent-guard earlier on PATH would win`);
    assert(!/block-skill|governance-client|skill-path|request-waiver|--waiver-helper/.test(h.command),
      `${step} must not route through a plugin governance script; agent-guard owns the waiver flow`);
    assert(h.command.includes("--enforce-skill") && h.command.includes("--client cursor"),
      `${step} must pass --enforce-skill --client cursor`);
    assert(h.command.includes(RELEASES_REGISTRY),
      `${step} must default to the releases registry, so the artifact is the published one`);
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

  check(`${step} lets npx cold-start and bounds its fetch`, () => {
    const h = entriesFor(step)[0];
    assert((h.timeout ?? 0) >= 30, `${step} timeout ${h.timeout} is too short for an npx cold start`);
    assert(h.command.includes("--prefer-offline"),
      `${step} must prefer the cache, so a warm machine pays no registry round trip`);
    const retries = /npm_config_fetch_retries=(\d+)/.exec(h.command);
    const fetchTimeout = /npm_config_fetch_timeout=(\d+)/.exec(h.command);
    assert(retries && Number(retries[1]) === 0,
      `${step} must set npm_config_fetch_retries=0: npm's default of 2 backs off 10s then 60s`);
    // The VALUE, not just its presence: npm_config_fetch_timeout=300000 is npm's own default, so
    // asserting presence alone would let an edit back to the default pass unnoticed. The bound has
    // to stay well inside the hook timeout to be worth setting at all.
    assert(fetchTimeout && Number(fetchTimeout[1]) <= 10_000,
      `${step} must set npm_config_fetch_timeout <= 10000 (npm's default is 300000ms), got ${fetchTimeout?.[1]}`);
  });

  check(`${step} computes the deadline fresh, with no inheritable fallback`, () => {
    const h = entriesFor(step)[0];
    assert(/_JFAG_NOW=\$\(date \+%s 2>\/dev\/null\);/.test(h.command),
      `${step} must read the clock defensively, tolerating an absent date(1)`);
    assert(h.command.includes('JF_AGENT_GUARD_ENFORCE_DEADLINE="${_JFAG_NOW:+$((_JFAG_NOW + 25))}"'),
      `${step} must compute an absolute deadline at invocation time, and pass EMPTY when the ` +
      `clock could not be read: agent-guard ignores an empty deadline and falls back to its own ` +
      `budget, whereas a garbage epoch floors the budget at 500ms and blocks every skill`);
    assert(!/JF_AGENT_GUARD_ENFORCE_DEADLINE:[-=]/.test(h.command),
      `${step} must not fall back to an inherited value: an absolute instant inherited from an ` +
      `earlier process pins every later invocation to the past`);
  });

  check(`${step} cannot pin the agent-guard version`, () => {
    const h = entriesFor(step)[0];
    assert(!h.command.includes("JFROG_AGENT_GUARD_VERSION"),
      `${step} must resolve latest, so a shipped GA fix reaches users without a plugin release`);
    assert(/@jfrog\/agent-guard(\s|$)/.test(h.command),
      `${step} must name the package unpinned: ${h.command}`);
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

check("the two governed hooks run byte-identical commands", () => {
  assert(commandFor("beforeSubmitPrompt") === commandFor("preToolUse"),
    "the two surfaces must enforce identically; they have drifted apart");
});

check("every hook command is valid POSIX sh", () => {
  for (const step of Object.keys(hooks.hooks ?? {})) {
    for (const h of entriesFor(step)) {
      const r = spawnSync(SH, ["-n", "-c", h.command], { encoding: "utf8" });
      assert(r.status === 0, `${step} command is not valid sh: ${r.stderr.trim()}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Behavioural: execute the real hooks.json command string.
// ---------------------------------------------------------------------------

// A payload shaped like the surface actually sends, so a check cannot pass by feeding preToolUse's
// event to the prompt hook.
const payloadFor = (step) => step === "preToolUse"
  ? `{"hook_event_name":"preToolUse","tool_name":"Read","tool_input":{"file_path":"/a/b/SKILL.md"}}`
  : `{"hook_event_name":"beforeSubmitPrompt","prompt":"/demo-skill"}`;

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
