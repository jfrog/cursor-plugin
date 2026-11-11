// fetch() that honors HTTPS_PROXY / NO_PROXY.
//
// Node's fetch ignores the proxy variables, so behind a corporate proxy the
// hooks' direct calls to the JPD went straight out and failed. Same approach
// as jfrog-skills (skills/jfrog/scripts/check-environment.mjs): a CONNECT
// tunnel through the proxy. Only https targets, through plain http:// proxies
// (no socks, PAC or NTLM); anything else goes direct, as plain fetch did. Like
// jf, loopback hosts always go direct, and NO_PROXY takes names, IPs and CIDR.
//
// When the proxy fails before the JPD answers (refused, unreachable, slow to
// open the tunnel, TLS rejected), the call goes direct, as it did before proxy
// support: a JPD that was reachable directly keeps working.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import process from "node:process";

const unbracket = (host) => host.replace(/^\[|\]$/g, "");

// The proxy must open the tunnel within this, so a proxy that hangs still
// leaves the caller's timeout for the direct try.
const CONNECT_TIMEOUT_MS = 1500;

// Same rule as jf (Go's net/http): localhost and loopback IPs are never
// proxied. A name like 127.evil.com is not an IP, so it is proxied. URL
// normalizes IPv6, so ::ffff:127.0.0.1 arrives as ::ffff:7f00:1.
function isLoopback(host) {
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.startsWith("127.");
  if (isIP(host) !== 6) return false;
  if (host === "::1") return true;
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
  return Boolean(mapped) && parseInt(mapped[1], 16) >> 8 === 127;
}

// An IP host inside a NO_PROXY CIDR entry such as 10.0.0.0/8 or fd00::/8.
function inSubnet(host, subnet) {
  const [net, bits] = subnet.split("/");
  const family = isIP(net);
  if (!family || isIP(host) !== family || !/^\d{1,3}$/.test(bits)) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  const list = new BlockList();
  try {
    list.addSubnet(net, Number(bits), type);
  } catch {
    return false;
  }
  return list.check(host, type);
}

function bypassesProxy(target, noProxy) {
  const host = unbracket(target.hostname.toLowerCase());
  if (isLoopback(host)) return true;
  const port = target.port || "443";
  return noProxy.split(",").some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry.includes("/")) return inSubnet(host, entry);
    // host, host:port, [v6]:port, or a bare v6 address such as ::1
    const m = entry.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    const name = unbracket(m ? m[1] : entry);
    const entryPort = m?.[2];
    if (!name || (entryPort && entryPort !== port)) return false;
    if (name === "*") return true;
    const suffix = name.replace(/^\*?\./, "");
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

/**
 * The proxy to use for `target`, or null to go direct.
 * @param {URL} target
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {URL|null}
 */
export function proxyFor(target, env = process.env) {
  if (target.protocol !== "https:") return null;
  // Uppercase first, as jf (Go) reads them.
  const raw = env.HTTPS_PROXY || env.https_proxy;
  if (!raw || bypassesProxy(target, env.NO_PROXY || env.no_proxy || "")) {
    return null;
  }
  try {
    const proxy = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return proxy.protocol === "http:" ? proxy : null;
  } catch {
    return null;
  }
}

/**
 * GET `url` like fetch(url, init), through the proxy the environment names.
 * Only `headers` and `signal` are used, and through a proxy the Response has
 * just a status and a body (no redirects, headers or url): the hooks' callers
 * read only `ok`, `status` and `json()`.
 * @param {string} url
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [init]
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, init = {}) {
  const target = new URL(url);
  const proxy = proxyFor(target);
  if (!proxy) return fetch(url, init);
  try {
    return await getViaProxy(target, proxy, init);
  } catch (err) {
    if (!err?.beforeAnswer) throw err; // after an answer, or the caller's time is up
    return fetch(url, init);
  }
}

function getViaProxy(target, proxy, { headers = {}, signal }) {
  return new Promise((resolve, reject) => {
    let answered = false;
    let connectTimer;
    // Like fetch: an aborted call rejects with the signal's reason. A failure
    // before the JPD answered is marked, so proxyFetch can go direct.
    const fail = (err) => {
      clearTimeout(connectTimer);
      if (signal?.aborted) return reject(signal.reason);
      if (!answered && err instanceof Error) err.beforeAnswer = true;
      reject(err);
    };
    const proxyAuth = {};
    if (proxy.username) {
      const login = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      proxyAuth["Proxy-Authorization"] =
        `Basic ${Buffer.from(login).toString("base64")}`;
    }
    const tunnel = httpRequest({
      host: unbracket(proxy.hostname),
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: { Host: target.host, ...proxyAuth },
      signal,
    });
    connectTimer = setTimeout(
      () => tunnel.destroy(new Error("proxy did not open the tunnel in time")),
      CONNECT_TIMEOUT_MS,
    );
    connectTimer.unref();
    tunnel.on("error", fail);
    tunnel.on("connect", (res, socket) => {
      clearTimeout(connectTimer);
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy answered CONNECT with ${res.statusCode}`));
        return;
      }
      // No servername: Node derives SNI from host and skips it for IPs.
      let req;
      try {
        req = httpsRequest({
          host: unbracket(target.hostname),
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          // Unlike fetch, nothing here decompresses: ask for the plain body.
          headers: { ...headers, "Accept-Encoding": "identity" },
          socket,
          agent: false,
          signal,
        });
      } catch (err) {
        socket.destroy();
        fail(err); // e.g. a header value with CR/LF throws here, not on "error"
        return;
      }
      req.on("error", fail);
      req.on("response", (answer) => {
        answered = true;
        const chunks = [];
        answer.on("data", (chunk) => chunks.push(chunk));
        answer.on("error", fail);
        answer.on("end", () => {
          const empty = [204, 205, 304].includes(answer.statusCode);
          try {
            resolve(
              new Response(empty ? null : Buffer.concat(chunks), {
                status: answer.statusCode,
              }),
            );
          } catch (err) {
            fail(err); // a status Response rejects, e.g. 999
          }
        });
      });
      req.end();
    });
    tunnel.end();
  });
}
