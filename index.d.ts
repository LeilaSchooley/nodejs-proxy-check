declare type ProxyType =
  | 'http'
  | 'https'
  | 'socks4'
  | 'socks5'
  | 'socks4a'
  | 'socks5h';

interface ProxyCheckOptions {
  url: string;
  type?: ProxyType;
  username?: string;
  password?: string;
  timeout?: number;
  maxBodyLength?: number;
  parseJson?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number }) => void;
  concurrency?: number;
  encoding?: string;
  maxLineLength?: number;
  onParseError?: (error: { lineNo: number; rawLine: string; reason: string }) => void;
  regex?: RegExp;
}

interface ProxyCheckResult {
  host: string;
  port: string | number;
  type: ProxyType;
  ok: boolean;
  statusCode: number;
  err: any;
  durationMs: number;
  proxyUrlRedacted: string;
  body?: string;
  bodyJson?: unknown;
  bodyJsonError?: Error;
  bodyTruncated?: boolean;
}

declare function checkProxy(
  host: string,
  port: number | string,
  options: ProxyCheckOptions,
  callback?: (
    host: string,
    port: number | string,
    ok: boolean,
    statusCode: number,
    err: any,
    result?: ProxyCheckResult,
  ) => void,
): Promise<ProxyCheckResult>;

declare function checkProxiesFromFile(
  file: string,
  options: ProxyCheckOptions,
  callback?: (
    host: string,
    port: number | string,
    ok: boolean,
    statusCode: number,
    err: any,
    result?: ProxyCheckResult,
  ) => void,
): Promise<ProxyCheckResult[]>;

declare function readProxiesFromFile(
  file: string,
  callback: (
    host: string,
    port: string,
    type: ProxyType,
    username?: string,
    password?: string,
  ) => void,
  options?: {
    encoding?: string;
    maxLineLength?: number;
    onParseError?: (error: { lineNo: number; rawLine: string; reason: string }) => void;
  },
): Promise<void>;

declare function buildProxyUrl(
  host: string,
  port: number | string,
  type?: ProxyType,
  username?: string,
  password?: string,
): string;

declare function parseJsonBody(body: string): unknown;

declare const proxyCheckerModern: {
  checkProxy: typeof checkProxy;
  checkProxiesFromFile: typeof checkProxiesFromFile;
  readProxiesFromFile: typeof readProxiesFromFile;
  buildProxyUrl: typeof buildProxyUrl;
  parseJsonBody: typeof parseJsonBody;
};

export = proxyCheckerModern;
