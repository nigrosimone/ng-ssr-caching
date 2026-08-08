// What every test file here needs: a server on a free port, and the rule that a case is only
// believed when express and fulmine answer the same thing.

import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import fulmine from 'fulmine.js';
import { ssrCaching } from '../dist/esm/index.js';

export const SERVERS = [
  ['express', express],
  ['fulmine', fulmine],
];

/**
 * Starts an app on a free port and answers a fetch bound to it, plus the cache's own handle.
 *
 * @param {() => any} factory express or fulmine
 * @param {(app: any, cache: any) => void} setup wires the routes behind the cache
 * @param {object} [options] passed to ssrCaching
 * @param {(app: any) => void} [wireBefore] anything that has to be registered ahead of the cache
 */
export function serve(factory, setup, options, wireBefore) {
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
        port,
        get: (path, init) => fetch(`http://localhost:${port}${path}`, init),
        close: () => (app.close ? app.close() : server.close()),
      });
    });
  });
}

/**
 * Runs the same body against both servers and asserts they agreed. Pass `expect` when agreeing is
 * not enough on its own, because two servers can be wrong in the same way, and on anything about
 * who gets to see a page they must not be.
 */
export function both(name, options, body) {
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
    if (body.expect) assert.deepStrictEqual(a, body.expect);
  });
}

/**
 * A counter and a handler that bumps it, so "did this render again?" is a number rather than a
 * guess. Each test file gets its own, because `node --test` gives each file its own process.
 */
export function renderer() {
  const counter = { rendered: 0 };
  const page = (extra) => (req, res) => {
    counter.rendered++;
    if (extra) extra(req, res);
    res.setHeader('content-type', 'text/html;charset=UTF-8');
    res.end(`<html><body>rendered ${req.url}</body></html>`);
  };
  return { counter, page, reset: () => (counter.rendered = 0) };
}
