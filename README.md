# NgSsrCaching [![NPM version](https://img.shields.io/npm/v/ng-ssr-caching.svg)](https://www.npmjs.com/package/ng-ssr-caching)

Cache for server-side rendered pages in Angular SSR.

## Description

Angular renders a page on every request and ships nothing to cache it with. `NgSsrCaching` is an
Express middleware that keeps the rendered HTML and serves it back without rendering again, so the
second visitor to a page pays for bytes instead of for a render.

It is the server-side sibling of [`ng-http-caching`](https://www.npmjs.com/package/ng-http-caching):
that one keeps the HTTP responses your application asks for in the browser, this one keeps the page
your server produced from them.

## Features

✅ Caches rendered pages, keyed by URL<br>
✅ ETag and Content-Length computed once, at store time, not on every hit<br>
✅ Answers `304 Not Modified` to a client that already has the page<br>
✅ TTL, with optional stale-while-revalidate<br>
✅ Bounded, least-recently-served eviction, and a body-size ceiling<br>
✅ Refuses to cache what must not be cached: `Authorization`, `Set-Cookie`, `no-store`, `private`, anything but 200<br>
✅ Optional `103 Early Hints` on a miss, so the browser fetches the bundle while the server renders<br>
✅ Works with any Express-compatible server, tested against Express and [Fulmine](https://www.npmjs.com/package/fulmine.js) side by side<br>
✅ Angular is what it is written for, but nothing in it is Angular: React SSR, Fastify and bare node work too<br>
✅ No dependencies<br>

## Get Started

_Step 1_: install `ng-ssr-caching`

```bash
npm i ng-ssr-caching
```

_Step 2_: add it to the `server.ts` that `ng add @angular/ssr` generated, in front of the Angular
handler:

```ts
import { ssrCaching } from 'ng-ssr-caching';

app.use(
  ssrCaching({
    ttl: 60_000,
    // if your application signs people in with a cookie, name it here: see below
    bypassCookies: ['session'],
  }),
);

// the Angular handler the schematic wrote, unchanged
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});
```

### If you use `compression()`, register it first

```ts
app.use(compression()); // first
app.use(ssrCaching()); // second
```

Response wrappers nest in reverse registration order, so the middleware registered **last** is the
one that sees the body **first**. Registered after `compression()`, this cache sees the page as
Angular rendered it. Registered before it, it would see gzip, and storing that would mean replaying
compressed bytes as if they were HTML.

It refuses to store an already-encoded response rather than doing that, and says so once on the
console, because a cache that silently never fills is an afternoon of wondering why.

That is the whole integration. Every response carries an `x-ssr-cache` header saying `HIT`, `MISS`,
`STALE` or `BYPASS`, so you can see what it is doing before you trust it.

## ⚡ Telling the browser what to fetch, before the page exists

A miss is expensive because the server has to render. While it does, the browser sits idle: it
asked for a document and will not learn that the page needs `main-*.js` until the document arrives,
which is after the render has finished. The two happen one after the other when they could happen
at once.

`103 Early Hints` fixes that, and this middleware is in the right place to send it: on a miss it
runs **before** the render, and it already knows what the page declares, because it read that from
the first page it stored.

```ts
ssrCaching({ earlyHints: true });
```

Measured on an Angular 22 application over HTTP/2 at 1.6 Mbps, time to hydration, seven alternating
rounds:

| server render time | with hints | without | sooner by |
| :----------------- | ---------: | ------: | --------: |
| 50 ms              |    1451 ms | 1692 ms |    241 ms |
| 300 ms             |    1466 ms | 1941 ms |    475 ms |
| 800 ms             |    1464 ms | 2458 ms |    994 ms |

The shape is the point. **With hints the time stops moving with the render**, because the bundle
downloads while the page is being made. Without them the render is added to the total. So the
slower your render, the more this is worth, up to what it costs to fetch the assets.

Three things decide whether it does anything for you, and it is better to know now than to wonder
later:

- **The browser must be speaking HTTP/2 or HTTP/3.** Browsers ignore a `103` over HTTP/1.1.
  `earlyHints: true` therefore sends it only when the request itself arrived over HTTP/2. Behind a
  proxy that terminates HTTP/2 the request reaches your process as HTTP/1.1, and whether the proxy
  forwards a `103` is the proxy's business, so `earlyHints: 'always'` sends it regardless and leaves
  that judgement to you.
- **The server must be able to send an informational response.** Node can, since 18.11. Servers
  built on µWebSockets.js, including [Fulmine](https://www.npmjs.com/package/fulmine.js), have no
  API for it, and there this option does nothing at all. `stats().hinted` says how many actually
  went out, which is the honest way to find out.
- **A hit gains nothing.** There is no render to overlap with, so a `103` is only ever sent on a
  miss. That is also exactly where it is worth having.

Nothing is invented: the announced resources are the ones the document itself declares. Only
`preconnect` and `preload` are used, because those are the only relationships browsers act on in a
`103`, and a module script is announced with `crossorigin` because a module is fetched in CORS mode
and without it the browser downloads the bundle twice.

## 🔒 Who is allowed to see a cached page

This cache holds one page per URL and hands it to whoever asks for it next. That makes it a
**shared** cache, and a shared cache has one rule it cannot be wrong about: a page rendered for a
particular person must not be handed to the next person.

Two things say the request is personal, and this package treats them differently because they are
different.

**`Authorization` is handled for you.** A request carrying that header is passed straight through:
nothing is served to it from the cache, and nothing it produces is stored. RFC 9111 §3.5 requires
exactly this of a shared cache, and the header is never ambiguous. If your bearer token genuinely
changes nothing about the page, `cacheAuthenticated: true` opts back in, and that is a decision about
your own data.

**Cookies you have to name yourself**, because a cookie means nothing on its own. An analytics
cookie says nothing about who you are, a session cookie says everything, and only you know which of
yours is which, so this package does not guess:

```ts
ssrCaching({ bypassCookies: ['session', /^connect\.sid$/] });
```

A string matches a cookie of exactly that name, a RegExp is tested against each name. Exactly, so
`session` does not accidentally match `sessionless`. If your application signs people in with a
cookie and you leave this empty, one visitor's page will be served to the next one.

Note that this is about the **request**. A `Set-Cookie` on the way out is refused separately and
always: a response that hands out a session is about one visitor by definition.

## What it is worth

Measured on an Angular 22 application, a 28 KB page, on the machine this was written on:

|                              |            |
| :--------------------------- | ---------: |
| render, no cache             |    17.2 ms |
| the same page from the cache | **1.9 ms** |

The render is the same JavaScript whatever server you run, so this part of the win is yours on
Express and on anything else. What the server underneath changes is how cheap the hit itself is:

|                                                                  | CPU per request |           |
| :--------------------------------------------------------------- | --------------: | --------: |
| cache hit on Express                                             |          262 µs |           |
| cache hit on [Fulmine](https://www.npmjs.com/package/fulmine.js) |          175 µs | **1.50x** |
| a static asset on Express                                        |          411 µs |           |
| a static asset on Fulmine                                        |          131 µs | **3.14x** |

Nine alternating rounds, each server reporting its own `process.cpuUsage()`, and the per-round
spread never crosses parity. [Fulmine](https://www.npmjs.com/package/fulmine.js) is a drop-in Express replacement, so trying it is the same one
line this package is.

### Why the ETag matters more than it looks

A cache that keeps only the bytes and serves them with `res.send(html)` makes the server hash the
whole document again on every single hit, because that is how an ETag is produced. On a page of any
size that hash is most of what a hit costs, and a cache written that way measures level with no
cache at all on the serving side.

This package computes the ETag and the length once, when the page is stored, and sets them from the
entry. That is the difference between the numbers above and no difference at all, and it is also
what lets a returning visitor be answered with an empty `304`.

## What it refuses to cache

Silently, and on purpose:

- anything that is not a `200`
- any request carrying an `Authorization` header, which is also never served one
- any request carrying one of your `bypassCookies`, likewise
- any response carrying a `Set-Cookie`
- any response whose `Cache-Control` says `no-store` or `private`
- any request whose `key` returns `null`, which is the escape hatch for everything else
- any body larger than `maxBodyBytes`, which is served normally and simply not remembered
- any method outside `methods`, `GET` and `HEAD` by default

## ⚠️ The cached HTML contains your data

This is the part to read twice. Angular embeds the **TransferState** in the page it renders: the
responses your application fetched during the render are serialized into a `<script id="ng-state">`
inside the HTML, so the browser does not fetch them again.

Which means an SSR cache is not caching a template. It is caching **the data that was in it**. The
`ttl` you choose is the staleness you are willing to serve on your API responses, not on your
markup. Pick it from the data, and read the section above about who gets to see it.

## Options

| Option                 | Default          |                                                            |
| :--------------------- | :--------------- | :--------------------------------------------------------- |
| `ttl`                  | `60000`          | how long a page stays fresh, in milliseconds               |
| `staleWhileRevalidate` | `0`              | how long after `ttl` a stale page is still served          |
| `maxEntries`           | `500`            | how many pages to keep; least recently served goes first   |
| `maxBodyBytes`         | `5 MiB`          | bodies above this are served but never stored              |
| `earlyHints`           | `false`          | announce the page's assets in a `103` on a miss            |
| `key`                  | method and url   | return `null` to bypass the cache for that request         |
| `bypassCookies`        | `[]`             | cookie names that make a request personal, matched exactly |
| `cacheAuthenticated`   | `false`          | let requests with `Authorization` use the cache            |
| `shouldCache`          | -                | the last word on whether a rendered response may be stored |
| `methods`              | `['GET','HEAD']` | which methods are eligible                                 |
| `header`               | `'x-ssr-cache'`  | the header reporting HIT/MISS/STALE/BYPASS, or `false`     |

The middleware also carries `stats()`, `purge(key?)` and `keys()`, so a deploy can drop what it
needs to and a dashboard can see what is happening.

## It is written for Angular, and nothing in it is Angular

This package exists for Angular SSR and the documentation above is written for it. The code is not:
it caches an HTML response, and it has no dependencies and no idea what produced the page. So it
works elsewhere, and the cases below are tested rather than assumed.

**React SSR**, including `renderToPipeableStream`. A streamed render arrives as many `write()` calls
and is stored as the whole page, so the second visitor gets it in one piece, with the ETag and the
`304` that come with it. Measured on a 40-boundary render: one render for two requests, identical
bytes, `MISS` then `HIT`.

Everything in [who is allowed to see a cached page](#-who-is-allowed-to-see-a-cached-page) applies
unchanged, and the warning about the cached HTML containing your data applies harder: React
serializes its own data into the document exactly as Angular serializes the TransferState.

**Any server with the Express middleware shape.** Fastify through
[`@fastify/middie`](https://github.com/fastify/middie), and a bare `node:http` server by calling it
yourself:

```js
import { createServer } from 'node:http';
import { ssrCaching } from 'ng-ssr-caching';

const cache = ssrCaching({ ttl: 60_000 });

createServer((req, res) => {
  cache(req, res, () => {
    // your render
  });
}).listen(3000);
```

**And two pieces on their own**, for a server this middleware does not fit:

- `weakEtag(body)` gives the validator Express would have produced. It is the whole trick of this
  package: computed once at store time rather than on every hit.
- `earlyHintLinksFrom(html)` reads a rendered page and returns the `Link` values a `103` can carry.

## License

MIT
