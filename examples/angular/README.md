# Angular SSR, cached

The weather app from [lissy93/framework-benchmarks](https://github.com/lissy93/framework-benchmarks/tree/main/apps/angular) (MIT),
with SSR added, served by Express and kept by `ng-ssr-caching`.

**[Open it on StackBlitz](https://stackblitz.com/github/nigrosimone/ng-ssr-caching/tree/main/examples/angular)**, or here:

```bash
npm install
npm run dev
```

Then load the page twice and watch the `x-ssr-cache` header go from `MISS` to `HIT`. `/api/cache`
reports what the cache has been doing.

## Why `ng serve` is enough

Since Angular 17.2 the dev server runs your own `src/server.ts` through the handler
`createNodeRequestHandler` exports, so the middleware you register there is the middleware that
answers. No production build to wait through, which is what lets this open in one click.

## The part worth reading

`src/server.ts` is what the schematic generates, plus two lines:

```ts
const cache = ssrCaching({ ttl: 30_000, earlyHints: true });
app.use(cache);
```

The `ttl` is short on purpose. Angular embeds the **TransferState** in the page it renders, so what
is cached is not a template but the data that was in it. The number comes from how stale the weather
may be, not from how stable the markup is.

`earlyHints` does nothing here and that is expected: browsers only act on a `103` over HTTP/2, and
the dev server speaks HTTP/1.1. `stats().hinted` stays at zero, which is the honest way to see it.
