// Every case runs twice, once on express and once on fulmine, and the two have to answer the same
// thing. That is the whole compatibility claim of this package, so it is a test rather than a
// sentence in the readme, and it doubles as a second net under Fulmine itself.

import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import fulmine from 'fulmine.js';
import compression from 'compression';
import { request as httpRequest } from 'node:http';
import { ssrCaching } from '../dist/esm/index.js';
import { both } from './helpers.mjs';

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
      // the validator has to come from a hit: a miss is the handler's own response, and these
      // servers have their etag turned off, so there is nothing on it to send back
      await (await get('/page')).text();
      const hit = await get('/page');
      await hit.text();
      const etag = hit.headers.get('etag');
      const conditional = await get('/page', { headers: { 'if-none-match': etag } });
      return {
        etagWasReal: /^W\/"[0-9a-f]+-/.test(etag ?? ''),
        status: conditional.status,
        body: await conditional.text(),
        mark: conditional.headers.get('x-ssr-cache'),
        etagEchoed: conditional.headers.get('etag') === etag,
      };
    },
    // spelled out rather than left to the two servers agreeing, because they agree just as
    // happily on a 200 with the whole page in it, which is the thing this is meant to catch
    expect: { etagWasReal: true, status: 304, body: '', mark: 'HIT', etagEchoed: true },
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

// The page below says who it was rendered for, so a leak is visible in the body rather than
// inferred from a counter.
const whoami = (req, res) => {
  rendered++;
  res.setHeader('content-type', 'text/html;charset=UTF-8');
  res.end(
    `<html><body>${req.headers.authorization ?? req.headers.cookie ?? 'anonymous'}</body></html>`,
  );
};

both(
  'a request carrying Authorization is neither served from the cache nor stored into it',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get('/dashboard', whoami);
    },
    async run({ get, cache }) {
      rendered = 0;
      // alice signs in first, so hers is the render that would fill an empty cache
      const alice = await get('/dashboard', { headers: { authorization: 'Bearer alice' } });
      const aliceBody = await alice.text();
      const storedForAlice = cache.stats().entries;
      // bob asks anonymously: he must get his own page, not hers
      const bob = await get('/dashboard');
      const bobBody = await bob.text();
      // and now that a page IS cached, alice must still not be handed it
      const again = await get('/dashboard', { headers: { authorization: 'Bearer alice' } });
      return {
        rendered,
        aliceMark: alice.headers.get('x-ssr-cache'),
        aliceBody,
        storedForAlice,
        bobMark: bob.headers.get('x-ssr-cache'),
        bobBody,
        againMark: again.headers.get('x-ssr-cache'),
        againBody: await again.text(),
      };
    },
    expect: {
      rendered: 3,
      aliceMark: 'BYPASS',
      aliceBody: '<html><body>Bearer alice</body></html>',
      storedForAlice: 0,
      bobMark: 'MISS',
      bobBody: '<html><body>anonymous</body></html>',
      againMark: 'BYPASS',
      againBody: '<html><body>Bearer alice</body></html>',
    },
  },
);

both(
  'cacheAuthenticated opts back in, for an application whose token changes nothing',
  { ttl: 60_000, cacheAuthenticated: true },
  {
    setup(app) {
      app.get('/dashboard', whoami);
    },
    async run({ get, cache }) {
      rendered = 0;
      const first = await get('/dashboard', { headers: { authorization: 'Bearer alice' } });
      await first.text();
      const second = await get('/dashboard', { headers: { authorization: 'Bearer bob' } });
      return {
        rendered,
        secondMark: second.headers.get('x-ssr-cache'),
        secondBody: await second.text(),
        entries: cache.stats().entries,
      };
    },
    // bob reading alice's page is exactly what this option buys, and why it is not the default
    expect: {
      rendered: 1,
      secondMark: 'HIT',
      secondBody: '<html><body>Bearer alice</body></html>',
      entries: 1,
    },
  },
);

both(
  'bypassCookies names the session cookie, and only that one',
  { ttl: 60_000, bypassCookies: ['session', /^connect\.sid$/] },
  {
    setup(app) {
      app.get('/page', whoami);
    },
    async run({ get, cache }) {
      rendered = 0;
      const analytics = await get('/page', { headers: { cookie: 'ga=1; theme=dark' } });
      await analytics.text();
      const session = await get('/page', { headers: { cookie: 'ga=1; session=alice' } });
      const connect = await get('/page', { headers: { cookie: 'connect.sid=s%3Aabc' } });
      // a name that merely contains one of ours is somebody else's cookie
      const lookalike = await get('/page', { headers: { cookie: 'sessionless=1' } });
      return {
        rendered,
        analyticsMark: analytics.headers.get('x-ssr-cache'),
        sessionMark: session.headers.get('x-ssr-cache'),
        sessionBody: await session.text(),
        connectMark: connect.headers.get('x-ssr-cache'),
        lookalikeMark: lookalike.headers.get('x-ssr-cache'),
        entries: cache.stats().entries,
      };
    },
    expect: {
      rendered: 3,
      analyticsMark: 'MISS',
      sessionMark: 'BYPASS',
      sessionBody: '<html><body>ga=1; session=alice</body></html>',
      connectMark: 'BYPASS',
      lookalikeMark: 'HIT',
      entries: 1,
    },
  },
);

both(
  'a Vary the cache does not key on is a refusal, and Accept-Encoding is not one',
  { ttl: 60_000 },
  {
    setup(app) {
      app.get(
        '/personal',
        page((req, res) => res.setHeader('vary', 'Accept-Encoding, Cookie')),
      );
      app.get(
        '/negotiated',
        page((req, res) => res.setHeader('vary', 'Accept-Encoding')),
      );
    },
    async run({ get, cache }) {
      rendered = 0;
      await (await get('/personal')).text();
      const personalAgain = await get('/personal');
      await personalAgain.text();
      await (await get('/negotiated')).text();
      const negotiatedAgain = await get('/negotiated');
      await negotiatedAgain.text();
      return {
        rendered,
        personalMark: personalAgain.headers.get('x-ssr-cache'),
        negotiatedMark: negotiatedAgain.headers.get('x-ssr-cache'),
        keys: cache.keys(),
      };
    },
    expect: {
      rendered: 3,
      personalMark: 'MISS',
      negotiatedMark: 'HIT',
      keys: ['GET /negotiated'],
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

// --- 103 Early Hints ---------------------------------------------------------------------------
// These do not run through `both()`: the whole point is that the two servers differ here, because
// one can send an informational response and the other has no API for it.

import { earlyHintLinksFrom } from '../dist/esm/index.js';

test('the links are read out of the page, and only the ones a 103 can carry', () => {
  const page = `<!doctype html><html><head>
    <link rel="preconnect" href="https://api.example">
    <link rel="stylesheet" href="styles-ABC.css" media="print" onload="this.media='all'">
    <link rel="stylesheet" href="styles-ABC.css">
    <link rel="modulepreload" href="chunk-ABC.js">
    <link rel="icon" href="favicon.ico">
    </head><body><script src="main-ABC.js" type="module"></script></body></html>`;

  assert.deepStrictEqual(earlyHintLinksFrom(page), [
    '<https://api.example>; rel=preconnect',
    // the deferred copy is skipped, the plain one is not
    '</styles-ABC.css>; rel=preload; as=style',
    // modulepreload is meaningless in a 103, so it is said in the way that is not
    '</chunk-ABC.js>; rel=preload; as=script; crossorigin',
    // crossorigin, or the browser cannot match the preload to the module fetch and downloads twice
    '</main-ABC.js>; rel=preload; as=script; crossorigin',
  ]);
});

test('a page that declares nothing produces nothing', () => {
  assert.deepStrictEqual(earlyHintLinksFrom('<html><body><h1>hi</h1></body></html>'), []);
});

test('nothing is announced until a page has been seen, then every miss carries it', async () => {
  const app = express();
  app.set('etag', false);
  const cache = ssrCaching({ ttl: 60_000, earlyHints: 'always' });
  app.use(cache);
  app.get('/:page', (req, res) => {
    res.setHeader('content-type', 'text/html;charset=UTF-8');
    res.end('<html><head><link rel="stylesheet" href="s.css"></head><body>page</body></html>');
  });

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  const hintsFor = (path) =>
    new Promise((resolve) => {
      const req = httpRequest({ port, path }, (res) => {
        res.resume();
        res.once('end', () => resolve(seen));
      });
      let seen = null;
      req.on('information', (info) => (seen = info.headers.link));
      req.end();
    });

  // the first miss has nothing to announce yet: no page has ever been stored
  assert.strictEqual(await hintsFor('/one'), null);
  // the second is a different page, so another miss, and by now the links are known
  assert.strictEqual(await hintsFor('/two'), '</s.css>; rel=preload; as=style');
  assert.strictEqual(cache.stats().hinted, 1);

  // a hit gains nothing from a hint, and gets none
  assert.strictEqual(await hintsFor('/two'), null);
  assert.strictEqual(cache.stats().hinted, 1);

  server.close();
});

test('nothing is sent over HTTP/1.1 unless it is asked for, and never on a server without the API', async () => {
  // true, rather than 'always', means only an HTTP/2 request gets one, and this one is HTTP/1.1
  const app = express();
  app.set('etag', false);
  const cache = ssrCaching({ ttl: 60_000, earlyHints: true });
  app.use(cache);
  app.get('/:page', (req, res) => {
    res.setHeader('content-type', 'text/html;charset=UTF-8');
    res.end('<html><head><link rel="stylesheet" href="s.css"></head><body>page</body></html>');
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  await fetch(`http://localhost:${port}/one`).then((r) => r.text());
  await fetch(`http://localhost:${port}/two`).then((r) => r.text());
  assert.strictEqual(cache.stats().hinted, 0);
  server.close();

  // and on fulmine, which has no writeEarlyHints at all, asking for it changes nothing
  const app2 = fulmine();
  app2.set('etag', false);
  const cache2 = ssrCaching({ ttl: 60_000, earlyHints: 'always' });
  app2.use(cache2);
  app2.get('/:page', (req, res) => {
    res.setHeader('content-type', 'text/html;charset=UTF-8');
    res.end('<html><head><link rel="stylesheet" href="s.css"></head><body>page</body></html>');
  });
  const server2 = app2.listen(0, async () => {
    const port2 = (server2.address ? server2 : app2).address().port;
    await fetch(`http://localhost:${port2}/one`).then((r) => r.text());
    const second = await fetch(`http://localhost:${port2}/two`);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(cache2.stats().hinted, 0);
    app2.close ? app2.close() : server2.close();
  });
  await new Promise((r) => setTimeout(r, 400));
});
