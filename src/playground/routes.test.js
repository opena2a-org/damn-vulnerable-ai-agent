/**
 * Playground routes: a request stream that fails is logged (issue #124).
 *
 * Drives handlePlaygroundRoutes with an in-memory request, so nothing
 * listens on a port and nothing reaches a provider.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { handlePlaygroundRoutes } from './routes.js';

/** A POST request whose body stream sends `chunk` and then fails with `error`. */
function failingRequest(pathname, chunk, error) {
  const req = new PassThrough();
  req.method = 'POST';
  req.url = pathname;
  setImmediate(() => {
    req.write(chunk);
    setImmediate(() => req.destroy(error));
  });
  return req;
}

function recordingResponse() {
  return {
    status: null,
    body: '',
    writeHead(status) { this.status = status; },
    end(body = '') { this.body += body; },
  };
}

test('a request stream error is answered 400 and logged once by class, without the body', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));
  const disconnect = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
  const routes = ['/playground/test', '/playground/apply-recommendations', '/playground/test-connection'];
  for (const pathname of routes) {
    logged.length = 0;
    const req = failingRequest(pathname, '{"systemPrompt": "BODY-TEXT sk-FAKE-1234', disconnect);
    const res = recordingResponse();
    assert.equal(await handlePlaygroundRoutes(req, res, pathname), true);
    assert.equal(res.status, 400, pathname);
    assert.equal(JSON.parse(res.body).error, 'Request body could not be read');
    assert.equal(logged.length, 1, `${pathname}: ${logged.join('\n')}`);
    const [line] = logged;
    assert.match(line, /errorClass=Error code=ECONNRESET/, line);
    for (const text of ['BODY-TEXT', 'sk-FAKE', 'systemPrompt', 'aborted']) {
      assert.ok(!line.includes(text), `${text} logged: ${line}`);
    }
  }
});

test('malformed JSON and an oversized body are not logged as stream errors', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));
  const req = new PassThrough();
  req.method = 'POST';
  req.url = '/playground/test';
  req.end('{"systemPrompt": ');
  const res = recordingResponse();
  await handlePlaygroundRoutes(req, res, '/playground/test');
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).error, 'Request body is not valid JSON');
  assert.deepEqual(logged, []);
});
