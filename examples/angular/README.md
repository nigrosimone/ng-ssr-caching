# Angular SSR, cached

The weather app from [lissy93/framework-benchmarks](https://github.com/lissy93/framework-benchmarks/tree/main/apps/angular) (MIT),
with SSR added, served by Express and kept by `ng-ssr-caching`.

**[Open it on StackBlitz](https://stackblitz.com/github/nigrosimone/ng-ssr-caching/tree/main/examples/angular)**, or here:

```bash
npm install
npm start
```

Then load the page twice and watch the `x-ssr-cache` header go from `MISS` to `HIT`. `/api/cache`
reports what the cache has been doing.

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

## Why `dist/` is committed

So that opening this starts a server rather than a build. What runs is the production output and the
production server, which is the only version worth showing: a dev server would put its own
per-request transform between you and the render, and the render is the thing being cached.

The cost is that the build output can drift from the sources beside it. Run `npm run build` after
changing anything under `src/`.
