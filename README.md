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
✅ Refuses to cache what must not be cached: `Set-Cookie`, `no-store`, `private`, anything but 200<br>
✅ Works with any Express-compatible server, tested against Express and [Fulmine](https://www.npmjs.com/package/fulmine.js) side by side<br>
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
    // a page rendered for a signed-in visitor must never be handed to another one
    key: (req) => (req.headers.cookie?.includes('session=') ? null : `${req.method} ${req.url}`),
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
spread never crosses parity. Fulmine is a drop-in Express replacement, so trying it is the same one
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
- any response carrying a `Set-Cookie`
- any response whose `Cache-Control` says `no-store` or `private`
- any request whose `key` returns `null`, which is how you exclude signed-in visitors
- any body larger than `maxBodyBytes`, which is served normally and simply not remembered
- any method outside `methods`, `GET` and `HEAD` by default

## ⚠️ The cached HTML contains your data

This is the part to read twice. Angular embeds the **TransferState** in the page it renders: the
responses your application fetched during the render are serialized into a `<script id="ng-state">`
inside the HTML, so the browser does not fetch them again.

Which means an SSR cache is not caching a template. It is caching **the data that was in it**. The
`ttl` you choose is the staleness you are willing to serve on your API responses, not on your
markup. Pick it from the data, and use `key` to exclude anything personal.

## Options

| Option                 | Default          |                                                            |
| :--------------------- | :--------------- | :--------------------------------------------------------- |
| `ttl`                  | `60000`          | how long a page stays fresh, in milliseconds               |
| `staleWhileRevalidate` | `0`              | how long after `ttl` a stale page is still served          |
| `maxEntries`           | `500`            | how many pages to keep; least recently served goes first   |
| `maxBodyBytes`         | `5 MiB`          | bodies above this are served but never stored              |
| `key`                  | method and url   | return `null` to bypass the cache for that request         |
| `shouldCache`          | -                | the last word on whether a rendered response may be stored |
| `methods`              | `['GET','HEAD']` | which methods are eligible                                 |
| `header`               | `'x-ssr-cache'`  | the header reporting HIT/MISS/STALE/BYPASS, or `false`     |

The middleware also carries `stats()`, `purge(key?)` and `keys()`, so a deploy can drop what it
needs to and a dashboard can see what is happening.

## License

MIT
