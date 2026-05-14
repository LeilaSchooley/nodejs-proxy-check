# proxy-checker

`proxy-checker` is a small Node.js module for verifying whether proxy servers are working.

It supports:

- HTTP and HTTPS proxies
- SOCKS4 and SOCKS5 proxies
- proxy authentication with username/password
- request timeouts
- concurrent batch checks from a file

## Install

```bash
npm install proxy-checker
```

## Usage

### Single proxy check

```js
const { checkProxy } = require('./index');

checkProxy('1.2.3.4', 8080, {
  url: 'https://httpbin.org/ip',
  type: 'http',
  timeout: 5000,
  username: 'user',
  password: 'pass',
})
  .then(result => console.log(result))
  .catch(console.error);
```

### Batch check from a file

```js
const { checkProxiesFromFile } = require('./index');

checkProxiesFromFile('proxies.txt', {
  url: 'https://httpbin.org/ip',
  timeout: 8000,
  concurrency: 10,
})
  .then(results => console.log(results))
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

Example:

```text
1.2.3.4:8080
5.6.7.8:1080:socks5
10.0.0.1:3128:myuser:mypass
11.22.33.44:8080:http:myuser:mypass
```

Lines starting with `#` are ignored as comments.

## Result shape

Each check returns an object with:

- `host`
- `port`
- `ok` (boolean)
- `statusCode`
- `err`

A `407` status means the proxy requires authentication.

## Example script

Run the included `example.js` script to quickly test a single proxy and a file list:

```bash
node example.js
```
