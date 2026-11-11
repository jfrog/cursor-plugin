// GET a JPD path through `jf api` (so jf's proxy settings apply), or through
// proxyFetch (HTTPS_PROXY) when jf is missing or older than 2.100.0. jf runs
// with the caller's env, so the caller sets JFROG_CLI_USER_AGENT.

import { execFile } from "node:child_process";

import { authHeader, safeErrorMessage } from "./jf-identity.mjs";
import { jfInvocation } from "./jf-process.mjs";
import { skillsProductUserAgent } from "./jf-user-agent.mjs";
import { proxyFetch } from "./proxy-fetch.mjs";

// Never throws. Resolves to { status, body } (body: parsed JSON of a 2xx, else
// null), or { error } when there was no HTTP answer.
export async function jpdGet(
  apiPath,
  identity,
  { env, timeoutMs, runJfFn = runJf, fetchFn = proxyFetch },
) {
  if (identity.serverId) {
    const viaJf = await getWithJf(apiPath, identity.serverId, {
      env,
      timeoutMs,
      runJfFn,
    });
    if (viaJf) return viaJf;
  }
  return getWithFetch(apiPath, identity, { timeoutMs, fetchFn });
}

// Asks through `jf api`. Returns null when jf can't run it,
// so the caller falls back to fetch.
async function getWithJf(apiPath, serverId, { env, timeoutMs, runJfFn }) {
  const run = await runJfFn(
    ["api", "--server-id", serverId, "-H", "Accept: application/json", apiPath],
    { env, timeoutMs },
  );
  if (run.missing) return null;
  if (run.timedOut) return { error: "timeout" };
  const status = parseHttpStatus(run.stderr) || (run.code === 0 ? 200 : 0);
  if (status) {
    const ok = status >= 200 && status < 300;
    return { status, body: ok ? parseJson(run.stdout) : null };
  }
  if (/is not a jf command|unknown command/i.test(run.stderr + run.stdout)) {
    return null;
  }
  return { error: lastLine(run.stderr) || `jf api exited with ${run.code}` };
}

// Asks directly with the token. Used only when `jf api` can't be used.
async function getWithFetch(apiPath, identity, { timeoutMs, fetchFn }) {
  const root = identity.url.replace(/\/+$/, "").replace(/\/artifactory$/, "");
  try {
    const response = await fetchFn(root + apiPath, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader(identity),
        "User-Agent": skillsProductUserAgent(),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    return { status: response.status, body };
  } catch (err) {
    return {
      error: err?.name === "TimeoutError" ? "timeout" : safeErrorMessage(err),
    };
  }
}

// Runs jf and waits for it to finish. Never throws: it returns the output, and
// flags a jf killed at the timeout (timedOut) or one it can't run (missing: not
// installed, or refused for cmd.exe); the caller then falls back to fetch.
export function runJf(
  args,
  { env, timeoutMs, platform, execFileFn = execFile },
) {
  const { command, args: argv, shell } = jfInvocation(args, { env, platform });
  if (!command) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "",
      timedOut: false,
      missing: true,
    });
  }
  return new Promise((resolve) => {
    const child = execFileFn(
      command,
      argv,
      { env, timeout: timeoutMs, windowsHide: true, encoding: "utf8", shell },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (Number.isInteger(err.code) ? err.code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut: Boolean(err?.killed),
          missing: err?.code === "ENOENT",
        });
      },
    );
    // jf never needs input here; a closed stdin can't block it on a prompt.
    // A stdin error (jf missing, or gone first) must not crash the process.
    child?.stdin?.on("error", () => {});
    child?.stdin?.end();
  });
}

// For a 429 or a 5xx, jf prints no "Http Status" line, only its retry
// executor's [Warn] line, followed by the response body on stderr. That line
// is read first, so a body can't pass for jf's own status line.
const SERVER_RESPONSE = /\[Warn\] The server response:\s*(\d{3})/;

// jf api reports the HTTP status only as a stderr line.
// Returns that number, or 0 when there's none.
// Otherwise the last match wins, so a retry line can't hide the final status.
export function parseHttpStatus(text) {
  const warned = text.match(SERVER_RESPONSE);
  if (warned) return Number(warned[1]);
  let status = 0;
  for (const line of text.split("\n")) {
    const match = line.match(/Http Status:\s*(\d{3})/);
    if (match) status = Number(match[1]);
  }
  return status;
}

// The response body jf api prints on stdout. Returns null when it isn't valid JSON.
function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// The error to report when jf failed with no HTTP answer.
function lastLine(stderr) {
  const line = stderr
    .trim()
    .split("\n")
    .at(-1)
    ?.replace(/^\s*\[\w+\]\s*/, "");
  return line ? safeErrorMessage({ message: line }) : "";
}
