// Every case runs twice, once on express and once on fulmine, and the two have to answer the same
// thing. That is the whole compatibility claim of this package, so it is a test rather than a
// sentence in the readme, and it doubles as a second net under Fulmine itself.

import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import fulmine from 'fulmine.js';
import compression from 'compression';
import { ssrCaching } from '../dist/esm/index.js';

const SERVERS = [
  ['express', express],
  ['fulmine', fulmine],
];

/**
 * Starts an app on a free port and answers a fetch bound to it, plus the cache's own handle.
 *
 * @param {(app: any, cache: any) => void} setup
 * @param {object} [options] passed to ssrCaching
 */
function serve(factory, setup, options, wireBefore) {
  return new Promise((resolve) => {
    const app = factory();
    app.set('etag', false);
    const cache = ssrCaching(options);
    if (wireBefore) wireBefore(app);
    app.use(cache);
    setup(app, cache);
    const server = app.listen(0, () => {
      const port = (server.address ? server : app).address().port;
      resolve({
        cache,
        get: (path, init) => fetch(`http://localhost:${port}${path}`, init),
        close: () => (app.close ? app.close() : server.close()),
      });
    });
  });
}

/** Runs the same body against both servers and asserts they agreed. */
function both(name, options, body) {
  test(name, async () => {
    const seen = [];
    for (const [label, factory] of SERVERS) {
      const ctx = await serve(factory, body.setup, options, body.wireBefore);
      try {
        seen.push([label, await body.run(ctx)]);
      } finally {
        ctx.close();
      }
    }
    const [[, a], [, b]] = seen;
    assert.deepStrictEqual(
      b,
      a,
      `express and fulmine disagreed:\n${JSON.stringify(seen, null, 1)}`,
    );
  });
}

let rendered = 0;
const page = (extra) => (req, res) => {
  rendered++;
  if (extra) extra(req, res);
  res.setHeader('content-type', 'text/html;charset=UTF-8');
  res.end(`<html><body>rendered ${req.url}</body></html>`);
};

both(
  'a second request is served from the cache and the handler runs once',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get }) {
      rendered = 0;
      const first = await get('/page');
      const firstBody = await first.text();
      const second = await get('/page');
      const secondBody = await second.text();
      return {
        rendered,
        firstMark: first.headers.get('x-ssr-cache'),
        secondMark: second.headers.get('x-ssr-cache'),
        sameBody: firstBody === secondBody,
        body: secondBody,
        contentType: second.headers.get('content-type'),
        contentLength: second.headers.get('content-length'),
        etagPresent: /^W\/"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/.test(second.headers.get('etag') ?? ''),
      };
    },
  },
);

both(
  'a hit revalidates to 304 when the client already has it',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get }) {
      const first = await get('/page');
      const etag = first.headers.get('etag');
      const conditional = await get('/page', { headers: { 'if-none-match': etag } });
      return {
        status: conditional.status,
        body: await conditional.text(),
        mark: conditional.headers.get('x-ssr-cache'),
        etagEchoed: conditional.headers.get('etag') === etag,
      };
    },
  },
);

both(
  'a response that sets a cookie is never stored',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get(
        '/page',
        page((req, res) => res.setHeader('set-cookie', 'sid=abc; Path=/')),
      );
    },
    async run({ get, cache }) {
      rendered = 0;
      await get('/page');
      await get('/page');
      return { rendered, entries: cache.stats().entries, stored: cache.stats().stored };
    },
  },
);

both(
  'no-store and a non-200 are refused too',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get(
        '/private',
        page((req, res) => res.setHeader('cache-control', 'no-store')),
      );
      app.get('/missing', (req, res) => {
        rendered++;
        res.status(404).setHeader('content-type', 'text/html');
        res.end('<html>gone</html>');
      });
    },
    async run({ get, cache }) {
      rendered = 0;
      await get('/private');
      await get('/private');
      await get('/missing');
      await get('/missing');
      return { rendered, entries: cache.stats().entries };
    },
  },
);

both(
  'a key of null bypasses, which is where a logged-in visitor belongs',
  { ttl: 60_000, key: (req) => (req.headers.authorization ? null : `GET ${req.url}`) },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get, cache }) {
      rendered = 0;
      const anonymous = await get('/page');
      const authed = await get('/page', { headers: { authorization: 'Bearer x' } });
      return {
        rendered,
        anonymousMark: anonymous.headers.get('x-ssr-cache'),
        authedMark: authed.headers.get('x-ssr-cache'),
        entries: cache.stats().entries,
      };
    },
  },
);

both(
  'a body written in many chunks is reassembled and served whole',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/streamed', (req, res) => {
        rendered++;
        res.setHeader('content-type', 'text/html;charset=UTF-8');
        res.write('<html><body>');
        for (let i = 0; i < 20; i++) res.write(`<p>chunk ${i}</p>`);
        res.end('</body></html>');
      });
    },
    async run({ get }) {
      rendered = 0;
      const first = await get('/streamed');
      const firstBody = await first.text();
      const second = await get('/streamed');
      const secondBody = await second.text();
      return {
        rendered,
        same: firstBody === secondBody,
        length: secondBody.length,
        declared: second.headers.get('content-length'),
        mark: second.headers.get('x-ssr-cache'),
      };
    },
  },
);

both(
  'a page bigger than maxBodyBytes is served and not remembered',
  { ttl: 60_000, maxBodyBytes: 1024 },
  {
    setup(app) {
      app.get('/big', (req, res) => {
        rendered++;
        res.setHeader('content-type', 'text/html');
        res.end('x'.repeat(4096));
      });
    },
    async run({ get, cache }) {
      rendered = 0;
      const first = await get('/big');
      const body = await first.text();
      await get('/big');
      return { rendered, bodyLength: body.length, entries: cache.stats().entries };
    },
  },
);

both(
  'a stale page is served while the ttl has passed but the window has not',
  { ttl: 20, staleWhileRevalidate: 60_000 },
  {
    setup(app) {
      app.get('/page', page());
    },
    async run({ get }) {
      await get('/page');
      await new Promise((r) => setTimeout(r, 60));
      const stale = await get('/page');
      return { mark: stale.headers.get('x-ssr-cache'), body: await stale.text() };
    },
  },
);

both(
  'POST is never cached and never captured',
  { ttl: 60_000 },
  {
    setup(app) {
      app.post('/page', (req, res) => {
        rendered++;
        res.setHeader('content-type', 'text/html');
        res.end('<html>posted</html>');
      });
    },
    async run({ get, cache }) {
      rendered = 0;
      await get('/page', { method: 'POST' });
      await get('/page', { method: 'POST' });
      return { rendered, entries: cache.stats().entries };
    },
  },
);

both(
  'purge drops what it is told to drop',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/a', page());
      app.get('/b', page());
    },
    async run({ get, cache }) {
      await get('/a');
      await get('/b');
      const before = cache.stats().entries;
      const dropped = cache.purge('GET /a');
      const afterOne = cache.keys();
      const droppedAll = cache.purge();
      return { before, dropped, afterOne, droppedAll, after: cache.stats().entries };
    },
  },
);

both(
  'the least recently served page is the one evicted',
  { ttl: 60_000, maxEntries: 2 },
  {
    setup(app) {
      app.get('/a', page());
      app.get('/b', page());
      app.get('/c', page());
    },
    async run({ get, cache }) {
      await get('/a');
      await get('/b');
      await get('/a'); // touched, so /b is now the least recently served
      await get('/c');
      return { keys: cache.keys(), evicted: cache.stats().evicted };
    },
  },
);

// Compression, both ways round. Response wrappers nest in reverse registration order, so one of
// these two wirings has the cache seeing the page before it is compressed and the other has it
// seeing gzip. The second one used to store those bytes and replay them as HTML, which reached the
// client as 63 characters of rubbish; now it refuses, so a mistake costs the cache and never the
// page.
both(
  'compression registered first: the page is cached and served correctly',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/compressed', page());
    },
    wireBefore: (app) => app.use(compression({ threshold: 0 })),
    async run({ get, cache }) {
      const opts = { headers: { 'accept-encoding': 'gzip' } };
      const first = await get('/compressed', opts);
      const firstBody = await first.text();
      const second = await get('/compressed', opts);
      const secondBody = await second.text();
      return {
        firstOk: firstBody.includes('rendered'),
        secondOk: secondBody.includes('rendered'),
        same: firstBody === secondBody,
        mark: second.headers.get('x-ssr-cache'),
        stored: cache.stats().stored,
      };
    },
  },
);

both(
  'compression registered after: nothing is cached, and the page is still correct',
  { ttl: 60_000 },
  {
    setup(app) {
      app.use(compression({ threshold: 0 }));
      app.get('/compressed', page());
    },
    async run({ get, cache }) {
      const opts = { headers: { 'accept-encoding': 'gzip' } };
      const first = await get('/compressed', opts);
      const firstBody = await first.text();
      const second = await get('/compressed', opts);
      const secondBody = await second.text();
      return {
        firstOk: firstBody.includes('rendered'),
        secondOk: secondBody.includes('rendered'),
        same: firstBody === secondBody,
        stored: cache.stats().stored,
      };
    },
  },
);
