"use strict";

const fs = require("fs");
const readline = require("readline");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const PROXY_TYPES = new Set(["http", "https", "socks4", "socks5"]);

// ---------------------------------------------------------------------------
// Proxy type detection
// ---------------------------------------------------------------------------

/**
 * Returns the proxy URL string for a given host, port and type.
 * Supported types: 'http' (default), 'https', 'socks4', 'socks5'.
 */
function buildProxyUrl(host, port, type = "http", username, password) {
  const scheme = type.toLowerCase();
  let auth = "";
  if (username != null && password != null) {
    auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  }
  return `${scheme}://${auth}${host}:${port}`;
}

/**
 * Builds the appropriate axios httpsAgent / httpAgent for the proxy type.
 */
function buildAgent(proxyUrl, type) {
  const t = (type || "http").toLowerCase();
  if (t === "socks4" || t === "socks5") {
    const agent = new SocksProxyAgent(proxyUrl);
    return { httpAgent: agent, httpsAgent: agent };
  }
  // http / https proxy — use https-proxy-agent for both protocols so that
  // CONNECT tunnelling works for HTTPS targets too.
  const agent = new HttpsProxyAgent(proxyUrl);
  return { httpAgent: agent, httpsAgent: agent };
}

// ---------------------------------------------------------------------------
// Read proxies from a file
// ---------------------------------------------------------------------------

/**
 * Reads proxies from a file, one per line.
 * Each line should be formatted as:
 *   host:port           (HTTP proxy assumed)
 *   host:port:type      (type = http | https | socks4 | socks5)
 *   host:port:username:password
 *   host:port:type:username:password
 * Lines starting with # are treated as comments and ignored.
 *
 * @param {string}   file     Path to the proxy list file.
 * @param {Function} callback Called for every valid proxy with (host, port, type, username, password).
 * @returns {Promise<void>}   Resolves once the file has been fully read.
 */
function readProxiesFromFile(file, callback) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const parts = trimmed.split(":");
      const host = parts[0];
      const port = parts[1];
      let type = "http";
      let username;
      let password;
      const rest = parts.slice(2);

      if (rest.length === 1) {
        if (PROXY_TYPES.has(rest[0].toLowerCase())) {
          type = rest[0].toLowerCase();
        } else {
          username = rest[0];
        }
      } else if (rest.length === 2) {
        username = rest[0];
        password = rest[1];
      } else if (rest.length === 3) {
        if (PROXY_TYPES.has(rest[0].toLowerCase())) {
          type = rest[0].toLowerCase();
          username = rest[1];
          password = rest[2];
        } else if (PROXY_TYPES.has(rest[2].toLowerCase())) {
          username = rest[0];
          password = rest[1];
          type = rest[2].toLowerCase();
        } else {
          username = rest[0];
          password = rest[1];
        }
      }

      if (host && port) callback(host, port, type, username, password);
    });

    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Core check function
// ---------------------------------------------------------------------------

/**
 * Checks whether a single proxy is accessible.
 *
 * @param {string} host  Proxy host.
 * @param {string|number} port  Proxy port.
 * @param {Object} options
 * @param {string}  options.url        Target URL to request through the proxy.
 * @param {RegExp}  [options.regex]    Optional regex that must match the response body.
 * @param {string}  [options.type]     Proxy type: 'http' (default), 'https', 'socks4', 'socks5'.
 * @param {string}  [options.username] Proxy username for authenticated proxies.
 * @param {string}  [options.password] Proxy password for authenticated proxies.
 * @param {number}  [options.timeout]  Request timeout in milliseconds (default: 10 000).
 * @param {Function} [callback]        Optional Node-style callback (host, port, ok, statusCode, err).
 * @returns {Promise<{host, port, ok, statusCode, err}>}
 */
function checkProxy(host, port, options, callback) {
  const type = (options.type || "http").toLowerCase();
  const timeout = options.timeout != null ? options.timeout : 10_000;
  const username = options.username;
  const password = options.password;

  const proxyUrl = buildProxyUrl(host, port, type, username, password);
  const agents = buildAgent(proxyUrl, type);

  const promise = axios
    .get(options.url, {
      ...agents,
      timeout,
      validateStatus: () => true, // never throw on HTTP error status
      responseType: "text",
    })
    .then((res) => {
      let ok = true;
      let err = null;

      if (res.status !== 200) {
        ok = false;
        err = `HTTP ${res.status}`;
      } else if (
        !res.data ||
        (options.regex && !options.regex.test(res.data))
      ) {
        ok = false;
        err = `Body doesn't match the regex ${options.regex}.`;
      }

      const result = { host, port, ok, statusCode: res.status, err };
      if (callback) callback(host, port, ok, res.status, err);
      return result;
    })
    .catch((axiosErr) => {
      const result = { host, port, ok: false, statusCode: -1, err: axiosErr };
      if (callback) callback(host, port, false, -1, axiosErr);
      return result;
    });

  return promise;
}

// ---------------------------------------------------------------------------
// Batch check from file
// ---------------------------------------------------------------------------

/**
 * Checks all proxies listed in a file.
 *
 * @param {string} file     Path to the proxy list file.
 * @param {Object} options  Same options as {@link checkProxy}, plus:
 * @param {number} [options.concurrency]  Max simultaneous checks (default: 10).
 * @param {Function} [callback]           Optional per-proxy callback (host, port, ok, statusCode, err).
 * @returns {Promise<Array<{host, port, ok, statusCode, err}>>}  Resolves with results for all proxies.
 */
async function checkProxiesFromFile(file, options, callback) {
  const concurrency = options.concurrency != null ? options.concurrency : 10;
  const proxies = [];

  await readProxiesFromFile(file, (host, port, type, username, password) => {
    proxies.push({
      host,
      port,
      type: options.type || type,
      username: options.username != null ? options.username : username,
      password: options.password != null ? options.password : password,
    });
  });

  const results = [];
  // Process in chunks to honour the concurrency limit
  for (let i = 0; i < proxies.length; i += concurrency) {
    const chunk = proxies.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(({ host, port, type, username, password }) =>
        checkProxy(
          host,
          port,
          { ...options, type, username, password },
          callback,
        ),
      ),
    );
    results.push(...chunkResults);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  checkProxy,
  checkProxiesFromFile,
  readProxiesFromFile,
  buildProxyUrl,
};
