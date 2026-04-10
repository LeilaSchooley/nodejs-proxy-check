'use strict';

const fs = require('fs');
const readline = require('readline');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ---------------------------------------------------------------------------
// Proxy type detection
// ---------------------------------------------------------------------------

/**
 * Returns the proxy URL string for a given host, port and type.
 * Supported types: 'http' (default), 'https', 'socks4', 'socks5'.
 */
function buildProxyUrl(host, port, type = 'http') {
  const scheme = type.toLowerCase();
  return `${scheme}://${host}:${port}`;
}

/**
 * Builds the appropriate axios httpsAgent / httpAgent for the proxy type.
 */
function buildAgent(proxyUrl, type) {
  const t = (type || 'http').toLowerCase();
  if (t === 'socks4' || t === 'socks5') {
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
 * Lines starting with # are treated as comments and ignored.
 *
 * @param {string}   file     Path to the proxy list file.
 * @param {Function} callback Called for every valid proxy with (host, port, type).
 * @returns {Promise<void>}   Resolves once the file has been fully read.
 */
function readProxiesFromFile(file, callback) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split(':');
      const host = parts[0];
      const port = parts[1];
      const type = parts[2] || 'http';
      if (host && port) callback(host, port, type);
    });

    rl.on('close', resolve);
    rl.on('error', reject);
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
 * @param {number}  [options.timeout]  Request timeout in milliseconds (default: 10 000).
 * @param {Function} [callback]        Optional Node-style callback (host, port, ok, statusCode, err).
 * @returns {Promise<{host, port, ok, statusCode, err}>}
 */
function checkProxy(host, port, options, callback) {
  const type    = (options.type    || 'http').toLowerCase();
  const timeout = options.timeout  != null ? options.timeout : 10_000;

  const proxyUrl = buildProxyUrl(host, port, type);
  const agents   = buildAgent(proxyUrl, type);

  const promise = axios
    .get(options.url, {
      ...agents,
      timeout,
      validateStatus: () => true, // never throw on HTTP error status
      responseType: 'text',
    })
    .then((res) => {
      let ok = true;
      let err = null;

      if (res.status !== 200) {
        ok  = false;
        err = `HTTP ${res.status}`;
      } else if (!res.data || (options.regex && !options.regex.test(res.data))) {
        ok  = false;
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

  await readProxiesFromFile(file, (host, port, type) => {
    proxies.push({ host, port, type: options.type || type });
  });

  const results = [];
  // Process in chunks to honour the concurrency limit
  for (let i = 0; i < proxies.length; i += concurrency) {
    const chunk = proxies.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(({ host, port, type }) =>
        checkProxy(host, port, { ...options, type }, callback)
      )
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

