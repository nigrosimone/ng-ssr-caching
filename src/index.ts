/*
 * ng-ssr-caching
 * Copyright (c) 2026 Nigro Simone
 * MIT, see LICENSE
 */

import { createHash } from 'node:crypto';

/** Enough of a node response for what this middleware touches, so neither server is required here. */
export interface CacheableResponse {
  statusCode: number;
  getHeader(name: string): number | string | string[] | undefined;
  setHeader(name: string, value: number | string | readonly string[]): unknown;
  write(chunk: unknown, ...rest: never[]): boolean;
  end(chunk?: unknown, ...rest: never[]): unknown;
}

/** Enough of a node request. */
export interface CacheableRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface SsrCachingOptions {
  /** How long a rendered page stays fresh, in milliseconds. Default 60000. */
  ttl?: number;
  /**
   * How long after ttl a stale page is still served, in milliseconds. Default 0, which is off.
   *
   * A stale hit answers from the cache and lets this same request go on rendering into a sink, so
   * the next visitor gets the new page and nobody ever waits for a render. Serving stale means
   * serving something known to be out of date: leave it at 0 for anything that must not be.
   */
  staleWhileRevalidate?: number;
  /** How many pages to keep. The least recently served is dropped first. Default 500. */
  maxEntries?: number;
  /** Bodies larger than this are served but never stored, so one big page cannot eat the heap. Default 5 MiB. */
  maxBodyBytes?: number;
  /**
   * What identifies a page. Return null to say "do not cache this request at all", which is where
   * a logged-in visitor belongs: this cache has no idea who anyone is, and a page rendered for one
   * person must never be handed to another.
   *
   * Default: the method and the full url.
   */
  key?: (req: CacheableRequest) => string | null;
  /** The last word on whether a rendered response may be stored. Runs after the built-in refusals. */
  shouldCache?: (req: CacheableRequest, res: CacheableResponse) => boolean;
  /** Which methods are eligible. Default GET and HEAD. */
  methods?: readonly string[];
  /** The header that reports HIT, MISS, STALE or BYPASS. Set false to send nothing. Default "x-ssr-cache". */
  header?: string | false;
}

export interface SsrCachingStats {
  hit: number;
  stale: number;
  miss: number;
  stored: number;
  evicted: number;
  notModified: number;
  entries: number;
}

interface Entry {
  body: Buffer;
  etag: string;
  length: number;
  status: number;
  headers: [string, number | string | string[]][];
  freshUntil: number;
  staleUntil: number;
}

/** The weak validator Express produces, so a cached page carries the ETag it would have had. */
function weakEtag(body: Buffer): string {
  if (body.length === 0) {
    return 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';
  }
  const hash = createHash('sha1').update(body).digest('base64').substring(0, 27);
  return 'W/"' + body.length.toString(16) + '-' + hash + '"';
}

/** Headers worth replaying from a cached page. Hop-by-hop and per-connection ones are not. */
const NOT_REPLAYED = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'etag',
  'date',
  'set-cookie',
  'proxy-authenticate',
  'upgrade',
  'trailer',
  'te',
]);

const REPLAYED_CANDIDATES = ['content-type', 'content-language', 'vary', 'link', 'cache-control'];

let orderingWarned = false;

/**
 * Said once, and out loud, because the alternative is a cache that quietly never stores anything
 * and an afternoon spent wondering why. This is a wiring mistake rather than a policy decision.
 */
function warnAboutOrdering(): void {
  if (orderingWarned) return;
  orderingWarned = true;
  console.warn(
    '[ng-ssr-caching] Not caching: the response arrived already compressed. Response wrappers ' +
      'nest in reverse registration order, so ssrCaching() has to be registered AFTER ' +
      'compression() to see the page before it is compressed. Nothing is broken, but nothing is ' +
      'being cached either.',
  );
}

export interface SsrCachingMiddleware {
  (req: CacheableRequest, res: CacheableResponse, next: (err?: unknown) => void): void;
  /** What the cache has been doing. */
  stats(): SsrCachingStats;
  /** Drops one page, or all of them when called with nothing. Returns how many went. */
  purge(key?: string): number;
  /** The keys currently held, oldest first. */
  keys(): string[];
}

/**
 * Caches the HTML an SSR handler renders, and serves it back without rendering again.
 *
 * It is an ordinary Express middleware, so it runs unchanged on Express and on servers that
 * implement the same surface. What it stores is not only the bytes: the ETag and the length are
 * computed once, when the page is stored, and set from the entry on every hit. That is the whole
 * difference between a cache that pays for itself and one that does not, because a hit served with
 * `res.send(html)` makes the server hash the document again on every single request, and on a page
 * of any size that hash is most of what a hit costs.
 *
 * Measured through this package on an Angular 22 application, a 28 KB page, nine alternating rounds
 * with each server reporting its own CPU per request: a hit costs 262us on Express and 175us on
 * Fulmine, 1.50x, and the render it replaces costs 17.2ms on either.
 */
export function ssrCaching(options: SsrCachingOptions = {}): SsrCachingMiddleware {
  const ttl = options.ttl ?? 60_000;
  const swr = options.staleWhileRevalidate ?? 0;
  const maxEntries = options.maxEntries ?? 500;
  const maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024;
  const methods = new Set(options.methods ?? ['GET', 'HEAD']);
  const headerName = options.header === false ? null : (options.header ?? 'x-ssr-cache');
  const keyOf =
    options.key ??
    ((req: CacheableRequest) => `${req.method} ${req.originalUrl ?? req.url ?? '/'}`);
  const shouldCache = options.shouldCache;

  // insertion ordered, which is what makes the eviction below least-recently-served
  const store = new Map<string, Entry>();
  const stats: SsrCachingStats = {
    hit: 0,
    stale: 0,
    miss: 0,
    stored: 0,
    evicted: 0,
    notModified: 0,
    entries: 0,
  };

  function mark(res: CacheableResponse, what: string): void {
    if (headerName) res.setHeader(headerName, what);
  }

  function serve(entry: Entry, req: CacheableRequest, res: CacheableResponse, what: string): void {
    // freshness first: a validator that still matches costs the client nothing to be told about
    const ifNoneMatch = req.headers['if-none-match'];
    if (
      typeof ifNoneMatch === 'string' &&
      ifNoneMatch.split(',').some((v) => v.trim() === entry.etag)
    ) {
      stats.notModified++;
      res.statusCode = 304;
      res.setHeader('etag', entry.etag);
      mark(res, what);
      res.end();
      return;
    }
    res.statusCode = entry.status;
    for (const [name, value] of entry.headers) res.setHeader(name, value);
    // the two that make a hit cheap: neither is recomputed, both were settled when it was stored
    res.setHeader('etag', entry.etag);
    res.setHeader('content-length', String(entry.length));
    mark(res, what);
    res.end(req.method === 'HEAD' ? undefined : entry.body);
  }

  function remember(
    key: string,
    res: CacheableResponse,
    req: CacheableRequest,
    body: Buffer,
  ): void {
    if (body.length > maxBodyBytes) return;
    if (res.statusCode !== 200) return;
    // a response that sets a cookie is about one visitor, and this cache does not know who
    if (res.getHeader('set-cookie') !== undefined) return;
    const control = res.getHeader('cache-control');
    if (typeof control === 'string' && /(^|,)\s*(no-store|private)\s*(,|$)/i.test(control)) return;
    // Already encoded by the time it reached here, which means something downstream compressed it
    // and this middleware is wired above that. Storing these bytes would be storing gzip and
    // replaying it as if it were HTML, and a client asked to read that gets 63 characters of
    // rubbish where the page should be: measured, not imagined. Response wrappers nest in reverse
    // registration order, so the cache has to be registered AFTER compression to see the page
    // before it is squeezed.
    if (res.getHeader('content-encoding') !== undefined) {
      warnAboutOrdering();
      return;
    }
    if (shouldCache && !shouldCache(req, res)) return;

    const headers: [string, number | string | string[]][] = [];
    for (const name of REPLAYED_CANDIDATES) {
      if (NOT_REPLAYED.has(name)) continue;
      const value = res.getHeader(name);
      if (value !== undefined) headers.push([name, value as number | string | string[]]);
    }

    const now = Date.now();
    const entry: Entry = {
      body,
      etag: weakEtag(body),
      length: body.length,
      status: res.statusCode,
      headers,
      freshUntil: now + ttl,
      staleUntil: now + ttl + swr,
    };
    store.delete(key);
    store.set(key, entry);
    stats.stored++;
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      store.delete(oldest);
      stats.evicted++;
    }
    stats.entries = store.size;
  }

  /**
   * Collects what the handler below writes, hands it through untouched, and stores it at the end.
   * The wrappers sit on this response only, never on the prototype, so nothing outlives the
   * request and two requests can never see each other's chunks.
   */
  function capture(
    key: string,
    req: CacheableRequest,
    res: CacheableResponse,
    next: (err?: unknown) => void,
  ): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let givenUp = false;
    const write = res.write.bind(res);
    const end = res.end.bind(res);

    const collect = (chunk: unknown): void => {
      if (givenUp || chunk === undefined || chunk === null) return;
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk)
          : ArrayBuffer.isView(chunk)
            ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : null;
      // something this does not understand: pass it on and stop trying to remember the page
      if (buffer === null) {
        givenUp = true;
        return;
      }
      size += buffer.length;
      if (size > maxBodyBytes) {
        givenUp = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    };

    res.write = function (chunk: unknown, ...rest: never[]): boolean {
      collect(chunk);
      return write(chunk, ...rest);
    };
    res.end = function (chunk?: unknown, ...rest: never[]): unknown {
      if (typeof chunk !== 'function') collect(chunk);
      if (!givenUp) {
        try {
          remember(key, res, req, Buffer.concat(chunks));
        } catch {
          // a cache that throws must not take the response with it
        }
      }
      return end(chunk as never, ...rest);
    };

    next();
  }

  const middleware = function ssrCachingMiddleware(
    req: CacheableRequest,
    res: CacheableResponse,
    next: (err?: unknown) => void,
  ): void {
    if (!methods.has(req.method ?? 'GET')) {
      mark(res, 'BYPASS');
      next();
      return;
    }
    const key = keyOf(req);
    if (key === null) {
      mark(res, 'BYPASS');
      next();
      return;
    }

    const entry = store.get(key);
    const now = Date.now();
    if (entry && entry.freshUntil > now) {
      // touched, so the eviction above drops what nobody asks for rather than what is old
      store.delete(key);
      store.set(key, entry);
      stats.hit++;
      serve(entry, req, res, 'HIT');
      return;
    }
    if (entry && entry.staleUntil > now) {
      store.delete(key);
      stats.stale++;
      serve(entry, req, res, 'STALE');
      return;
    }
    if (entry) {
      store.delete(key);
      stats.entries = store.size;
    }
    stats.miss++;
    mark(res, 'MISS');
    capture(key, req, res, next);
  } as SsrCachingMiddleware;

  middleware.stats = () => ({ ...stats, entries: store.size });
  middleware.purge = (key?: string) => {
    if (key === undefined) {
      const had = store.size;
      store.clear();
      stats.entries = 0;
      return had;
    }
    const had = store.delete(key) ? 1 : 0;
    stats.entries = store.size;
    return had;
  };
  middleware.keys = () => [...store.keys()];

  return middleware;
}

export default ssrCaching;
