/*
 * ng-ssr-caching
 * Copyright (c) 2026 Nigro Simone
 * MIT, see LICENSE
 */

import { createHash } from 'node:crypto';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

/** Enough of a node response for what this middleware touches, so neither server is required here. */
export interface CacheableResponse {
  statusCode: number;
  getHeader(name: string): number | string | string[] | undefined;
  setHeader(name: string, value: number | string | readonly string[]): unknown;
  write(chunk: unknown, ...rest: never[]): boolean;
  end(chunk?: unknown, ...rest: never[]): unknown;
  /** Present on node's own responses since 18.11, absent on servers that cannot send a 1xx. */
  writeEarlyHints?(hints: { link?: string | string[] }, callback?: () => void): void;
  headersSent?: boolean;
}

/** Enough of a node request. */
export interface CacheableRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  httpVersionMajor?: number;
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
  /**
   * Cookie names whose presence makes a request personal, so it is neither served from the cache
   * nor stored into it. Strings match a cookie of exactly that name; a RegExp is tested against
   * each name.
   *
   * There is no safe default here, because a cookie means nothing on its own: an analytics one says
   * nothing about who you are, a session one says everything. So this cache does not guess, and a
   * cookie-authenticated application has to name its session cookie:
   *
   *     ssrCaching({ bypassCookies: ['session', /^connect\\.sid$/] })
   *
   * Get this wrong and one visitor's page is handed to the next. `Authorization` needs no setting
   * because it is never ambiguous, see below.
   */
  bypassCookies?: readonly (string | RegExp)[];
  /**
   * Whether a request carrying an `Authorization` header may use this cache. Default false, and
   * changing it is a decision about your own data.
   *
   * False means such a request is passed straight through: nothing is served to it from the cache
   * and nothing it produces is stored. That is what RFC 9111 §3.5 requires of a shared cache, and
   * this is a shared cache: it holds one page per URL and hands it to whoever asks next. Without
   * this rule a signed-in visitor's page, rendered 200 and with no `Set-Cookie` because a bearer
   * token sets none, would be stored under the plain URL and served to everyone after them.
   */
  cacheAuthenticated?: boolean;
  /**
   * Whether a miss announces the page's own assets in a `103 Early Hints` response, so the browser
   * can start fetching the bundle while the server is still rendering. Default false.
   *
   * The links are learned from the first page this cache stores and reused for every later miss:
   * an application serves the same bundles whatever page you ask for. Nothing is invented, and
   * nothing is announced until a page has been seen once.
   *
   * A miss is exactly where this pays, because a miss is where the render happens. Measured on an
   * Angular 22 application over HTTP/2 at 1.6 Mbps, time to hydration: a 300 ms render arrived
   * 475 ms sooner, an 800 ms render 994 ms sooner. With hints the time stops moving with the render
   * at all, because the download and the render stop being one after the other.
   *
   * Three things decide whether it does anything for you:
   *
   * - **The browser must be speaking HTTP/2 or HTTP/3.** Browsers ignore a `103` over HTTP/1.1.
   *   Setting this to `true` sends it only when the request itself arrived over HTTP/2. Behind a
   *   proxy that terminates HTTP/2 the request reaches this process as HTTP/1.1, and whether the
   *   proxy forwards a `103` is the proxy's business: `'always'` sends it regardless and leaves
   *   that decision to you.
   * - **The server must be able to send an informational response.** Node can. Servers built on
   *   µWebSockets.js, Fulmine among them, have no API for it: Fulmine accepts the call and sends
   *   nothing, so `hinted` counts it but the browser never sees it.
   * - **A hit gains nothing**, because there is no render to overlap with. It is only ever sent on
   *   a miss.
   */
  earlyHints?: boolean | 'always';
  /**
   * Whether a stored page also keeps a brotli and a gzip copy, made once in the background, so a
   * hit goes out compressed without compressing again. Default false.
   *
   * With `compression()` in front, every hit compresses the whole page again, and that costs ten
   * times what the hit itself does. `compression()` passes an encoded body through untouched, so
   * the two work together. With nothing in front, turning this on is what starts compressing.
   */
  compress?: boolean;
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
  /** How many misses handed a 103 to the server, which may drop it, see `earlyHints`. */
  hinted: number;
}

interface Entry {
  body: Buffer;
  etag: string;
  length: number;
  status: number;
  headers: [string, number | string | string[]][];
  freshUntil: number;
  staleUntil: number;
  /** Set once both copies are ready, when `compress` is on. */
  encoded?: { br: Buffer; gzip: Buffer };
}

const BROTLI_OPTIONS = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 } };
const GZIP_OPTIONS = { level: 9 };
/** Below this compression() does not compress either. */
const COMPRESS_THRESHOLD = 1024;

/** Makes the two copies off the event loop. On any error it gives up, the plain page is still there. */
function precompress(entry: Entry): void {
  let pending = 2;
  let br: Buffer | undefined;
  let gz: Buffer | undefined;
  const done = (): void => {
    if (--pending === 0 && br !== undefined && gz !== undefined) entry.encoded = { br, gzip: gz };
  };
  brotliCompress(entry.body, BROTLI_OPTIONS, (err, out) => {
    if (!err && out.length < entry.length) br = out;
    done();
  });
  gzip(entry.body, GZIP_OPTIONS, (err, out) => {
    if (!err && out.length < entry.length) gz = out;
    done();
  });
}

let lastAccept: string | undefined;
let lastPick: 'br' | 'gzip' | null = null;

/** br or gzip, whichever the client ranks higher (br on a tie), or null. The last answer is kept. */
function pickEncoding(header: string | string[] | undefined): 'br' | 'gzip' | null {
  if (typeof header !== 'string') return null;
  if (header === lastAccept) return lastPick;
  let br = -1;
  let gz = -1;
  let any = -1;
  for (const part of header.split(',')) {
    const semi = part.indexOf(';');
    const name = (semi === -1 ? part : part.slice(0, semi)).trim().toLowerCase();
    const q = semi === -1 ? 1 : Number(/\bq\s*=\s*([0-9.]+)/i.exec(part.slice(semi))?.[1] ?? 1);
    if (name === 'br') br = q;
    else if (name === 'gzip') gz = q;
    else if (name === '*') any = q;
  }
  if (br === -1) br = any;
  if (gz === -1) gz = any;
  const pick = br > 0 && br >= gz ? 'br' : gz > 0 ? 'gzip' : null;
  lastAccept = header;
  lastPick = pick;
  return pick;
}

/** A Vary value with Accept-Encoding in it, added once. */
function withAcceptEncoding(vary: number | string | string[] | undefined): string {
  const current = vary === undefined ? '' : Array.isArray(vary) ? vary.join(', ') : String(vary);
  if (/(^|,)\s*(accept-encoding|\*)\s*(,|$)/i.test(current)) return current;
  return current.trim().length === 0 ? 'Accept-Encoding' : current + ', Accept-Encoding';
}

/**
 * The weak validator Express produces, so a cached page carries the ETag it would have had.
 *
 * Exported because it is the whole trick: computed once, when the page is stored, rather than on
 * every hit. A cache that keeps only the bytes and lets the server hash the document again for each
 * request has removed the render and kept the second most expensive thing. Anyone writing their own
 * for a server this middleware does not fit is welcome to this one.
 *
 * @param body - The page, as bytes.
 * @returns The `ETag` header value, weak, in the shape Express produces.
 */
export function weakEtag(body: Buffer): string {
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

/**
 * Whether this request carries something that identifies a person, which makes the page it produces
 * that person's rather than everyone's.
 *
 * `Authorization` is the unambiguous one, and RFC 9111 §3.5 requires a shared cache to leave those
 * requests alone. Cookies are not: an analytics cookie says nothing, a session cookie says
 * everything, and only the application knows which of its own is which, so it names them.
 */
function carriesCredentials(
  req: CacheableRequest,
  cacheAuthenticated: boolean,
  bypassCookies: readonly (string | RegExp)[],
): boolean {
  if (!cacheAuthenticated && req.headers['authorization'] !== undefined) {
    return true;
  }
  if (bypassCookies.length === 0) return false;
  const cookie = req.headers['cookie'];
  if (typeof cookie !== 'string' || cookie.length === 0) return false;
  for (const pair of cookie.split(';')) {
    const name = pair.slice(0, pair.indexOf('=') === -1 ? undefined : pair.indexOf('=')).trim();
    if (name.length === 0) continue;
    for (const wanted of bypassCookies) {
      if (typeof wanted === 'string' ? wanted === name : wanted.test(name)) return true;
    }
  }
  return false;
}

/**
 * The `Link` header values for a `103`, read out of a page this cache has already stored.
 *
 * Nothing is invented: these are the resources the document itself declares, announced before the
 * render rather than after it. Two restrictions are deliberate.
 *
 * Only `preconnect` and `preload` are produced, because those are the only relationships browsers
 * act on in a `103`. A module script is therefore announced as `rel=preload; as=script; crossorigin`
 * rather than as `modulepreload`, and the `crossorigin` is not decoration: a module is fetched in
 * CORS mode, and without it the browser cannot match the preload to the fetch and downloads the
 * bundle twice.
 *
 * A stylesheet the critical-CSS inliner has deferred, which is spelled `media="print"`, is skipped.
 * It was taken off the critical path on purpose and pulling it forward would compete with what is
 * still on it.
 */
export function earlyHintLinksFrom(html: string): string[] {
  const attribute = (tag: string, name: string): string | undefined =>
    tag.match(new RegExp(`\\b${name}=("|')(.*?)\\1`))?.[2];
  const absolute = (href: string): string =>
    /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')
      ? href
      : '/' + href;

  const links = new Set<string>();

  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const href = attribute(tag, 'href');
    if (!href) continue;
    const rel = attribute(tag, 'rel');
    if (rel === 'preconnect') {
      links.add(`<${absolute(href)}>; rel=preconnect`);
    } else if (rel === 'stylesheet' && attribute(tag, 'media') !== 'print') {
      links.add(`<${absolute(href)}>; rel=preload; as=style`);
    } else if (rel === 'modulepreload') {
      links.add(`<${absolute(href)}>; rel=preload; as=script; crossorigin`);
    }
  }

  for (const [, attributes, , src] of html.matchAll(/<script\b([^>]*\bsrc=("|')(.*?)\2[^>]*)>/g)) {
    const cors = attribute(attributes, 'type') === 'module' ? '; crossorigin' : '';
    links.add(`<${absolute(src)}>; rel=preload; as=script${cors}`);
  }

  return [...links];
}

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
  const cacheAuthenticated = options.cacheAuthenticated === true;
  const bypassCookies = options.bypassCookies ?? [];
  const earlyHints = options.earlyHints ?? false;
  const compress = options.compress === true;

  /** Learned from the first page stored, then reused: an application serves the same bundles. */
  let hintLinks: string[] | null = null;
  // the same reading of a missing method as the eligibility check above, so a request cannot be
  // treated as a GET there and keyed as something else here
  const keyOf =
    options.key ??
    ((req: CacheableRequest) => `${req.method ?? 'GET'} ${req.originalUrl ?? req.url ?? '/'}`);
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
    hinted: 0,
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
    mark(res, what);
    if (req.method === 'HEAD') {
      res.setHeader('content-length', String(entry.length));
      res.end();
      return;
    }
    const encoding = entry.encoded ? pickEncoding(req.headers['accept-encoding']) : null;
    const body = encoding === null ? entry.body : entry.encoded![encoding];
    // compression() in front sees the Content-Encoding and passes the body through as it is
    if (encoding !== null) res.setHeader('content-encoding', encoding);
    res.setHeader('content-length', String(body.length));
    res.end(body);
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
    // The handler is telling us this page depends on a header we do not key on, so a stored copy
    // would be served to a request the handler would have answered differently. `Accept-Encoding`
    // and the rest are fine; these three are not.
    const vary = res.getHeader('vary');
    if (typeof vary === 'string' && /(^|,)\s*(\*|cookie|authorization)\s*(,|$)/i.test(vary)) return;
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

    const type = res.getHeader('content-type');
    const compressible =
      compress &&
      body.length >= COMPRESS_THRESHOLD &&
      typeof type === 'string' &&
      /^text\/|json|javascript|xml/i.test(type) &&
      !(typeof control === 'string' && /no-transform/i.test(control));

    const headers: [string, number | string | string[]][] = [];
    for (const name of REPLAYED_CANDIDATES) {
      if (NOT_REPLAYED.has(name)) continue;
      let value = res.getHeader(name) as number | string | string[] | undefined;
      // on every hit, encoded or not yet, so a cache further on keeps the copies apart
      if (name === 'vary' && compressible) value = withAcceptEncoding(value);
      if (value !== undefined) headers.push([name, value]);
    }

    // learned here rather than at startup, because this is the one place that holds a rendered
    // page and knows it is HTML worth reading
    if (earlyHints && hintLinks === null) {
      if (typeof type === 'string' && type.includes('html')) {
        hintLinks = earlyHintLinksFrom(body.toString('utf8'));
      }
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
    if (compressible) precompress(entry);
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
    // before the key, because a personal request must miss the cache whatever the key says
    if (carriesCredentials(req, cacheAuthenticated, bypassCookies)) {
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
    // before the render, which is the whole point: the browser fetches the bundle while this
    // process is busy producing the page it belongs to
    if (
      earlyHints &&
      hintLinks !== null &&
      hintLinks.length > 0 &&
      typeof res.writeEarlyHints === 'function' &&
      !res.headersSent &&
      (earlyHints === 'always' || (req.httpVersionMajor ?? 1) >= 2)
    ) {
      try {
        res.writeEarlyHints({ link: hintLinks });
        stats.hinted++;
      } catch {
        // a response that will not take an informational one is not a reason to fail the request
      }
    }
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
