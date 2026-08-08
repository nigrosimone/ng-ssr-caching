// The readme says this package is written for Angular and that nothing in it is Angular. That is a
// claim about other people's servers and other people's renderers, so it is tested here rather than
// asserted there: a bare node:http server, fastify through middie, and a real React streamed
// render with the cache in front of it.

import test from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import Fastify from 'fastify';
import middie from '@fastify/middie';
import { createElement as h, Suspense } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { ssrCaching } from '../dist/esm/index.js';

/**
 * Waits for a server to be listening and answers a fetch bound to its port. The shutdown is
 * registered on the test itself, so a failed assertion closes the server too: fetch keeps its
 * sockets alive, and a server still holding one keeps the whole run from ending.
 */
async function listening(server, t) {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { get: (path, init) => fetch(`http://localhost:${port}${path}`, init) };
}

// --- a server with no framework at all ----------------------------------------------------------

test('a bare node:http server, calling the middleware itself', async (t) => {
  // this is the snippet in the readme, run rather than read
  const cache = ssrCaching({ ttl: 60_000 });
  let rendered = 0;

  const server = createServer((req, res) => {
    cache(req, res, () => {
      rendered++;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<html><body>rendered ${req.url}</body></html>`);
    });
  });

  const { get } = await listening(server, t);
  const first = await get('/page');
  const firstBody = await first.text();
  const second = await get('/page');
  const secondBody = await second.text();

  assert.strictEqual(rendered, 1, 'the second request never reached the render');
  assert.strictEqual(first.headers.get('x-ssr-cache'), 'MISS');
  assert.strictEqual(second.headers.get('x-ssr-cache'), 'HIT');
  assert.strictEqual(secondBody, firstBody);
  assert.strictEqual(second.headers.get('content-length'), String(Buffer.byteLength(firstBody)));

  // and the validator it computed at store time is one the client can come back with
  const conditional = await get('/page', {
    headers: { 'if-none-match': second.headers.get('etag') },
  });
  assert.strictEqual(conditional.status, 304);
  assert.strictEqual(await conditional.text(), '');
});

// --- fastify -------------------------------------------------------------------------------------

test('fastify, through @fastify/middie', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  await app.register(middie);
  const cache = ssrCaching({ ttl: 60_000 });
  let rendered = 0;

  app.use(cache);
  app.get('/page', (req, reply) => {
    rendered++;
    reply.type('text/html; charset=utf-8').send('<html><body>fastify rendered this</body></html>');
  });

  await app.listen({ port: 0 });
  const { port } = app.server.address();
  const get = (path, init) => fetch(`http://localhost:${port}${path}`, init);

  const first = await get('/page');
  const firstBody = await first.text();
  const second = await get('/page');
  const secondBody = await second.text();

  assert.strictEqual(rendered, 1);
  assert.strictEqual(first.headers.get('x-ssr-cache'), 'MISS');
  assert.strictEqual(second.headers.get('x-ssr-cache'), 'HIT');
  assert.strictEqual(secondBody, firstBody);
  assert.strictEqual(secondBody, '<html><body>fastify rendered this</body></html>');
  assert.strictEqual(cache.stats().hit, 1);
});

// --- react ---------------------------------------------------------------------------------------

/** A value that is not there yet, in the shape a server render suspends on. */
function pending(value, ms) {
  let status = 'pending';
  const promise = new Promise((resolve) =>
    setTimeout(() => {
      status = 'ready';
      resolve();
    }, ms),
  );
  return () => {
    if (status === 'pending') throw promise;
    return value;
  };
}

const BOUNDARIES = 40;

test('React renderToPipeableStream: one render for two requests, byte for byte', async (t) => {
  let rendered = 0;
  const cache = ssrCaching({ ttl: 60_000 });

  const server = createServer((req, res) => {
    cache(req, res, () => {
      rendered++;
      // forty boundaries that resolve at forty different moments, so the page reaches the response
      // as many separate writes rather than one. That is the case worth testing: a cache that only
      // understands res.end() would store the shell and lose the rest.
      const rows = Array.from({ length: BOUNDARIES }, (_, i) => {
        const read = pending(`row ${i}`, 1 + (i % 7));
        const Row = () => h('li', null, read());
        return h(Suspense, { key: i, fallback: h('li', null, 'loading') }, h(Row, null));
      });
      const app = h('html', null, h('body', null, h('ul', null, rows)));

      const { pipe } = renderToPipeableStream(app, {
        onShellReady() {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          pipe(res);
        },
      });
    });
  });

  const { get } = await listening(server, t);

  const first = await get('/');
  const firstBody = await first.text();
  const second = await get('/');
  const secondBody = await second.text();

  assert.strictEqual(rendered, 1, 'the second visitor did not pay for a render');
  assert.strictEqual(first.headers.get('x-ssr-cache'), 'MISS');
  assert.strictEqual(second.headers.get('x-ssr-cache'), 'HIT');
  assert.strictEqual(secondBody, firstBody, 'the streamed page came back whole');

  // every boundary resolved, and every one of them is in the cached copy. The fallbacks are in
  // there too, because that is what a streamed page is: the shell, and then the pieces that
  // replace it, all in one document by the time the response ends.
  for (let i = 0; i < BOUNDARIES; i++) {
    assert.ok(secondBody.includes(`row ${i}`), `row ${i} survived the round trip`);
  }
  // the writes really were many, or there would be nothing here to have gone wrong
  assert.ok(secondBody.length > 4000, `the page is ${secondBody.length} bytes`);

  // the streamed response had no Content-Length of its own; the cached one does, because the
  // length was settled when the page was stored
  assert.strictEqual(first.headers.get('content-length'), null);
  assert.strictEqual(second.headers.get('content-length'), String(Buffer.byteLength(firstBody)));

  const conditional = await get('/', { headers: { 'if-none-match': second.headers.get('etag') } });
  assert.strictEqual(conditional.status, 304);
  assert.strictEqual(cache.stats().notModified, 1);
});

test('React data in the page is cached with it, which is the thing to be careful about', async (t) => {
  // React has no TransferState by name, but every SSR app writes its data into the document the
  // same way, and this cache keeps the document. So the ttl is a decision about the data.
  let rendered = 0;
  const cache = ssrCaching({ ttl: 60_000 });
  let temperature = 12;

  const server = createServer((req, res) => {
    cache(req, res, () => {
      rendered++;
      const state = { temperature };
      const { pipe } = renderToPipeableStream(
        h(
          'html',
          null,
          h('body', null, [
            h('p', { key: 'p' }, `${state.temperature} degrees`),
            h('script', {
              key: 's',
              dangerouslySetInnerHTML: {
                __html: `window.__STATE__=${JSON.stringify(state)}`,
              },
            }),
          ]),
        ),
        {
          onShellReady() {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            pipe(res);
          },
        },
      );
    });
  });

  const { get } = await listening(server, t);
  const first = await get('/');
  assert.ok((await first.text()).includes('window.__STATE__={"temperature":12}'));

  // the weather changes, and the cached page does not
  temperature = 27;
  const second = await get('/');
  const secondBody = await second.text();
  assert.strictEqual(rendered, 1);
  assert.strictEqual(second.headers.get('x-ssr-cache'), 'HIT');
  assert.ok(secondBody.includes('window.__STATE__={"temperature":12}'), 'the old data came back');
  assert.ok(!secondBody.includes('27 degrees'));

  // which is what purge is for, when something happened that the ttl does not know about
  assert.strictEqual(cache.purge('GET /'), 1);
  const third = await get('/');
  assert.strictEqual(third.headers.get('x-ssr-cache'), 'MISS');
  assert.ok((await third.text()).includes('27 degrees'));
  assert.strictEqual(rendered, 2);
});
