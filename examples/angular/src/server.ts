// Angular SSR on Express, with the page cache in front of the render.
//
// Everything here is what `ng add @angular/ssr` generates, except the two lines that add the cache.
// Angular's dev server runs this file through the handler exported at the bottom, so `ng serve` is
// enough: no production build to wait for, which is what makes this open in one click.
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { ssrCaching } from 'ng-ssr-caching';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// --- the whole integration ----------------------------------------------------------------------
const cache = ssrCaching({
  // short on purpose: this page carries live weather, and caching rendered HTML means caching the
  // data inside it. The number comes from how stale the weather may be, not from how stable the
  // markup is.
  ttl: 30_000,
  // announced on a miss, so the browser fetches the bundle while this server renders. Browsers only
  // act on a 103 over HTTP/2, so on a plain dev server this does nothing and says so in stats()
  earlyHints: true,
});
// Registered before the cache, or it would be cached itself and count as a miss of its own.
/** What the cache has been doing, so the page can be checked without opening devtools. */
app.get('/api/cache', (req, res) => res.json(cache.stats()));

app.use(cache);
// ------------------------------------------------------------------------------------------------

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/** The Angular handler the schematic writes, unchanged. */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = Number(process.env['PORT']) || 4000;
  app.listen(port, () => {
    console.log(`\n  ready on http://localhost:${port}`);
    console.log('  reload the page and watch the x-ssr-cache header go from MISS to HIT\n');
  });
}

export const reqHandler = createNodeRequestHandler(app);
