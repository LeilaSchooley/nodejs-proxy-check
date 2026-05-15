# proxy-checker-modern

`proxy-checker-modern` is a small Node.js module for verifying whether proxy servers are working.

It supports:

- HTTP and HTTPS proxies
- SOCKS4 and SOCKS5 proxies, including `socks5h` and `socks4a` aliases
- proxy authentication with username/password
- bounded response bodies to avoid large allocations
- optional JSON extraction for JSON endpoints
- request timeouts with a safe maximum
- concurrent batch checks with progress callbacks
- abort signals and parse diagnostics for proxy lists

## Install

```bash
npm install proxy-checker-modern
```

## Usage

### Single proxy check

```js
const {
  checkProxy,
} = require('proxy-checker-modern');

checkProxy('1.2.3.4', 8080, {
  url: 'https://httpbin.org/ip',
  type: 'http',
  timeout: 5000,
  maxBodyLength: 16 * 1024,
  parseJson: true,
  username: 'user',
  password: 'pass',
})
  .then((result) => console.log(result))
  .catch(console.error);
```

### Batch check from a file

```js
const {
  checkProxiesFromFile,
} = require('proxy-checker-modern');

checkProxiesFromFile(
  'proxies.txt',
  {
    url: 'https://httpbin.org/ip',
    timeout: 8000,
    concurrency: 10,
    parseJson: true,
    onProgress: ({ done, total }) => {
      console.log(`Checked ${done}/${total}`);
    },
  },
)
  .then((results) => console.log(results))
  .catch(console.error);
```

## Proxy file format

Each proxy should be on its own line. Supported formats:

```text
host:port
host:port:type
host:port:username:password
host:port:type:username:password
```

Where `type` is one of:

- `http`
- `https`
- `socks4`
- `socks5`
- `socks4a`
- `socks5h`

Example:

```text
1.2.3.4:8080
5.6.7.8:1080:socks5
10.0.0.1:3128:myuser:mypass
11.22.33.44:8080:http:myuser:mypass
```

Lines starting with `#` are ignored as comments.

## Options

`checkProxy()` and `checkProxiesFromFile()` accept the same core options:

- `url`: Target URL to request through the proxy.
- `type`: Proxy type. Defaults to `http`.
- `username`: Proxy auth username.
- `password`: Proxy auth password.
- `timeout`: Request timeout in milliseconds.
- `maxBodyLength`: Maximum body length to keep on success (default `16384`).
- `parseJson`: If true, the response body is parsed as JSON into `bodyJson`.
- `regex`: Optional regex that must match the response body for success.
- `concurrency`: Maximum concurrent checks in `checkProxiesFromFile()`.
- `abortSignal`: Optional `AbortSignal` to cancel in-flight checks.
- `onProgress`: Optional progress callback for batch checks.
- `encoding`: Optional file encoding for `readProxiesFromFile()`.
- `maxLineLength`: Optional maximum line length for proxy files.
- `onParseError`: Optional callback for malformed proxy lines.

### Safe defaults

- Timeout is capped at `60000` ms to avoid accidental multi-minute hangs.
- HTTP status codes do not throw; the result object always contains `statusCode` and `err`.

## Result shape

Each result is a stable object with:

- `host`
- `port`
- `type`
- `ok` (boolean)
- `statusCode`
- `err`
- `durationMs`
- `proxyUrlRedacted`
- `body` (only set when `ok === true`)
- `bodyJson` (only set when `parseJson === true` and JSON parsing succeeds)
- `bodyJsonError` (only set when JSON parsing fails)
- `bodyTruncated` (true if the body was clipped to `maxBodyLength`)

A `407` status means the proxy requires authentication.

## Example script

Run the included `example.js` script to test a proxy and a proxy file:

```bash
node example.js
```
