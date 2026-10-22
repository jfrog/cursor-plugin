// GET a JPD path through `jf api` (so jf's proxy settings apply), or through
// fetch when jf is missing or older than 2.100.0. jf runs with the caller's env,
// so the caller sets JFROG_CLI_USER_AGENT.

import { execFile } from "node:child_process";

import { authHeader, safeErrorMessage } from "./jf-identity.mjs";
import { jfInvocation } from "./jf-process.mjs";
import { skillsProductUserAgent } from "./jf-user-agent.mjs";

// Never throws. Resolves to { status, body } (body: parsed JSON of a 2xx, else
// null), or { error } when there was no HTTP answer.
export async function jpdGet(
  apiPath,
  identity,
  { env, timeoutMs, runJfFn = runJf, fetchFn = fetch },
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
// flags a jf killed at the timeout (timedOut) or not installed (missing).
export function runJf(args, { env, timeoutMs }) {
  const { command, args: argv } = jfInvocation(args, { env });
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { env, timeout: timeoutMs, windowsHide: true, encoding: "utf8" },
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
  });
}

// jf api reports the HTTP status only as a stderr line.
// Returns that number, or 0 when there's none.
// The last match wins, so a retry line can't hide the final status.
function parseHttpStatus(text) {
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
