"use strict";

const fs = require("fs");
const readline = require("readline");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 60_000;
const DEFAULT_MAX_BODY_LENGTH = 16 * 1024;
const DEFAULT_ENCODING = "utf8";
const DEFAULT_MAX_LINE_LENGTH = 4096;

const PROXY_TYPES = new Set(["http", "https", "socks4", "socks5"]);
const PROXY_TYPE_ALIASES = {
  socks5h: "socks5",
  socks4a: "socks4",
};

function normalizeProxyType(type = "http") {
  const rawType = String(type || "http").toLowerCase();
  const normalized = PROXY_TYPE_ALIASES[rawType] || rawType;
  if (!PROXY_TYPES.has(normalized)) {
    throw new Error(
      `Unsupported proxy type "${type}". Supported types: http, https, socks4, socks5, socks4a, socks5h.`,
    );
  }
  return normalized;
}

function buildProxyUrl(host, port, type = "http", username, password) {
  const scheme = normalizeProxyType(type);
  let auth = "";
  if (username != null && password != null) {
    auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  }
  return `${scheme}://${auth}${host}:${port}`;
}

function buildProxyUrlRedacted(host, port, type = "http", username) {
  const scheme = normalizeProxyType(type);
  const auth = username != null ? "***:***@" : "";
  return `${scheme}://${auth}${host}:${port}`;
}

function buildAgent(proxyUrl, type) {
  const t = normalizeProxyType(type);
  if (t === "socks4" || t === "socks5") {
    const agent = new SocksProxyAgent(proxyUrl);
    return { httpAgent: agent, httpsAgent: agent };
  }
  const agent = new HttpsProxyAgent(proxyUrl);
  return { httpAgent: agent, httpsAgent: agent };
}

function parseJsonBody(body) {
  return JSON.parse(body);
}

function parseProxyLine(line) {
  const parts = line.split(":");
  const host = parts[0];
  const port = parts[1];
  if (!host || !port) return null;

  let type = "http";
  let username;
  let password;
  let rest = parts.slice(2);

  if (rest.length > 0) {
    const first = rest[0].toLowerCase();
    const last = rest[rest.length - 1].toLowerCase();
    if (PROXY_TYPE_ALIASES[first] || PROXY_TYPES.has(first)) {
      type = PROXY_TYPE_ALIASES[first] || first;
      rest = rest.slice(1);
    } else if (PROXY_TYPE_ALIASES[last] || PROXY_TYPES.has(last)) {
      type = PROXY_TYPE_ALIASES[last] || last;
      rest = rest.slice(0, -1);
    }

    if (rest.length >= 2) {
      username = rest[0];
      password = rest.slice(1).join(":");
    } else if (rest.length === 1) {
      username = rest[0];
    }
  }

  return { host, port, type, username, password };
}

/**
 * Reads proxies from a file and invokes the callback for each proxy found.
 * @param {string} file - The file to read proxies from.
 * @param {function} callback - The callback to invoke for each proxy. Receives host, port, type, username, password.
 * @param {Object} [options] - Options for reading proxies.
 * @param {string} [options.encoding=utf8] - The encoding to use when reading the file.
 * @param {number} [options.maxLineLength=4096] - The maximum length of a line in the file.
 * @param {function} [options.onParseError] - Callback invoked when a line cannot be parsed. Receives an object with lineNo, rawLine, and reason.
 * @returns {Promise<void>}
 */
function readProxiesFromFile(file, callback, options = {}) {
  return new Promise((resolve, reject) => {
    const encoding = options.encoding || DEFAULT_ENCODING;
    const maxLineLength = options.maxLineLength || DEFAULT_MAX_LINE_LENGTH;
    const onParseError = typeof options.onParseError === "function" ? options.onParseError : null;

    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding }),
      crlfDelay: Infinity,
    });

    let lineNo = 0;
    rl.on("line", (line) => {
      lineNo += 1;
      if (line.length > maxLineLength) {
        if (onParseError) {
          onParseError({ lineNo, rawLine: line, reason: "line too long" });
        }
        return;
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const parsed = parseProxyLine(trimmed);
      if (!parsed) {
        if (onParseError) {
          onParseError({ lineNo, rawLine: line, reason: "invalid proxy line" });
        }
        return;
      }

      callback(parsed.host, parsed.port, parsed.type, parsed.username, parsed.password);
    });

    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

/**
 * Checks a single proxy by attempting to access a URL through the proxy.
 * @param {string} host - The proxy host.
 * @param {number} port - The proxy port.
 * @param {Object} options - Options for the proxy check.
 * @param {string} options.url - The URL to access through the proxy.
 * @param {string} [options.type] - The proxy type (http, https, socks4, socks5).
 * @param {string} [options.username] - The proxy authentication username.
 * @param {string} [options.password] - The proxy authentication password.
 * @param {number} [options.timeout=10000] - The timeout for the request in milliseconds.
 * @param {number} [options.maxBodyLength=16384] - The maximum length of the response body.
 * @param {boolean} [options.parseJson=false] - Whether to parse the response body as JSON.
 * @param {RegExp} [options.regex] - A regular expression that the response body must match.
 * @param {AbortSignal} [options.abortSignal] - An abort signal to cancel the request.
 * @param {function} [callback] - A callback function that is called with the result of the check.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the result of the proxy check.
 */
function checkProxy(host, port, options = {}, callback) {
  const type = normalizeProxyType(options.type);
  const timeout = Math.min(options.timeout != null ? options.timeout : DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const username = options.username;
  const password = options.password;
  const maxBodyLength = options.maxBodyLength != null ? options.maxBodyLength : DEFAULT_MAX_BODY_LENGTH;
  const parseJson = options.parseJson === true;
  const proxyUrl = buildProxyUrl(host, port, type, username, password);
  const proxyUrlRedacted = buildProxyUrlRedacted(host, port, type, username);
  const startTime = Date.now();

  return axios
    .get(options.url, {
      ...buildAgent(proxyUrl, type),
      timeout,
      validateStatus: () => true,
      responseType: "text",
      signal: options.abortSignal,
    })
    .then((res) => {
      const durationMs = Date.now() - startTime;
      let ok = true;
      let err = null;

      if (res.status !== 200) {
        ok = false;
        err = `HTTP ${res.status}`;
      } else if (!res.data || (options.regex && !options.regex.test(res.data))) {
        ok = false;
        err = `Body doesn't match the regex ${options.regex}.`;
      }

      const result = {
        host,
        port,
        type,
        ok,
        statusCode: res.status,
        err,
        durationMs,
        proxyUrlRedacted,
      };

      if (ok) {
        const body = typeof res.data === "string" ? res.data.slice(0, maxBodyLength) : String(res.data);
        result.body = body;
        if (parseJson) {
          try {
            result.bodyJson = parseJsonBody(body);
          } catch (jsonErr) {
            result.bodyJsonError = jsonErr;
          }
        }
        if (typeof res.data === "string" && res.data.length > maxBodyLength) {
          result.bodyTruncated = true;
        }
      }

      if (callback) callback(host, port, ok, res.status, err, result);
      return result;
    })
    .catch((axiosErr) => {
      const durationMs = Date.now() - startTime;
      const result = {
        host,
        port,
        type,
        ok: false,
        statusCode: -1,
        err: axiosErr,
        durationMs,
        proxyUrlRedacted,
      };
      if (callback) callback(host, port, false, -1, axiosErr, result);
      return result;
    });
}

/**
 * Checks multiple proxies from a file by attempting to access a URL through each proxy.
 * @param {string} file - The file to read proxies from.
 * @param {Object} options - Options for the proxy checks.
 * @param {string} options.url - The URL to access through the proxies.
 * @param {number} [options.concurrency=10] - The number of proxies to check concurrently.
 * @param {string} [options.type] - The proxy type (http, https, socks4, socks5). If not specified, the type from the file is used.
 * @param {string} [options.username] - The proxy authentication username. If not specified, the username from the file is used.
 * @param {string} [options.password] - The proxy authentication password. If not specified, the password from the file is used.
 * @param {number} [options.timeout=10000] - The timeout for each request in milliseconds.
 * @param {number} [options.maxBodyLength=16384] - The maximum length of the response body.
 * @param {boolean} [options.parseJson=false] - Whether to parse the response body as JSON.
 * @param {RegExp} [options.regex] - A regular expression that the response body must match.
 * @param {AbortSignal} [options.abortSignal] - An abort signal to cancel the requests.
 * @param {function} [options.onProgress] - A callback function that is called with the progress of the checks. Receives an object with `done` and `total` properties.
 * @param {function} [callback] - A callback function that is called with the result of each proxy check.
 * @returns {Promise<Object[]>} - A promise that resolves to an array of objects containing the results of the proxy checks.
 */
async function checkProxiesFromFile(file, options = {}, callback) {
  const concurrency = options.concurrency != null ? options.concurrency : 10;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const abortSignal = options.abortSignal;
  const proxies = [];

  await readProxiesFromFile(file, (host, port, type, username, password) => {
    proxies.push({
      host,
      port,
      type: options.type || type,
      username: options.username != null ? options.username : username,
      password: options.password != null ? options.password : password,
    });
  }, options);

  const total = proxies.length;
  const results = [];

  for (let i = 0; i < proxies.length; i += concurrency) {
    if (abortSignal?.aborted) break;

    const chunk = proxies.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(({ host, port, type, username, password }) =>
        checkProxy(
          host,
          port,
          {
            ...options,
            type,
            username,
            password,
          },
          callback,
        ),
      ),
    );

    results.push(...chunkResults);
    if (onProgress) onProgress({ done: results.length, total });
  }

  return results;
}

module.exports = {
  checkProxy,
  checkProxiesFromFile,
  readProxiesFromFile,
  buildProxyUrl,
  parseJsonBody,
};
