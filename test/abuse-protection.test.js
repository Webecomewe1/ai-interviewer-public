'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const express = require('../backend/node_modules/express');
const rateLimit = require('../backend/node_modules/express-rate-limit');
const mongoose = require('../backend/node_modules/mongoose');

function stub(relative, exports) {
  const filename = require.resolve(path.resolve(__dirname, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub('../backend/config', { mongoUri: '', limits: { startsPerHour: 2, accountRequestsPerDay: 200 } });
stub('../backend/db', { mongoose });
const quotas = require('../backend/security/quotas');
const { VoiceGuard } = require('../backend/security/voiceGuard');

test('shared fixed-window quotas reject concurrent excess, isolate identities, and reset', async function () {
  let clock = 100;
  const buckets = new Map();
  const increment = async id => { const count = (buckets.get(id) || 0) + 1; buckets.set(id, count); return count; };
  // Two consumers represent workers sharing the same atomic persistence store.
  const worker1 = quotas.createQuotaConsumer(increment, () => clock);
  const worker2 = quotas.createQuotaConsumer(increment, () => clock);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? worker1 : worker2)('daily', 'user-a', 3, 1000)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 17);
  await worker1('daily', 'user-b', 3, 1000);
  assert.ok([...buckets.keys()].every(key => !key.includes('user-a') && !key.includes('user-b')));
  clock = 1000;
  assert.equal((await worker2('daily', 'user-a', 3, 1000)).remaining, 2);
});

test('production quota storage failure blocks work rather than allowing unlimited calls', async function () {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(quotas.consumeQuota('test', 'user', 3, 1000), error => error.status === 503 && error.code === 'QUOTA_UNAVAILABLE');
  } finally {
    if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original;
  }
});

test('voice frames, message bursts, text pace and total audio are bounded', function () {
  let time = 0;
  const guard = new VoiceGuard(1, () => time);
  assert.equal(guard.acceptFrame(Buffer.alloc(64 * 1024 + 1)), false);
  const burst = new VoiceGuard(1, () => time);
  for (let i = 0; i < 100; i++) assert.equal(burst.acceptFrame(Buffer.from('{}')), true);
  assert.equal(burst.acceptFrame(Buffer.from('{}')), false);
  time = 1000;
  assert.equal(burst.acceptFrame(Buffer.from('{}')), true);
  assert.equal(guard.acceptMessage({ type: 'audio', sampleRate: 48000, data: 'AAAA' }), false);
  assert.equal(guard.acceptMessage({ type: 'audio', sampleRate: 16000, data: '!invalid!' }), false);
  assert.equal(guard.acceptMessage({ type: 'text', text: 'My answer' }), true);
  assert.equal(guard.acceptMessage({ type: 'text', text: 'Another answer' }), false);
  assert.equal(guard.acceptMessage({ type: 'audio', sampleRate: 16000, data: Buffer.alloc(16000 * 2 * 60).toString('base64') }), true);
  assert.equal(guard.acceptMessage({ type: 'audio', sampleRate: 16000, data: 'AAAA' }), false);
});

test('proxy trust is opt-in and production rejects default signing secrets', function () {
  const source = fs.readFileSync(path.join(__dirname, '../backend/config.js'), 'utf8');
  function load(env) {
    const context = { module: { exports: {} }, __dirname, process: { env }, require(name) { return name === 'dotenv' ? { config() {} } : require(name); } };
    vm.runInNewContext(source, context);
    return context.module.exports;
  }
  assert.equal(load({}).trustProxy, false);
  assert.deepEqual(Array.from(load({ TRUST_PROXY: 'loopback,10.0.0.0/8' }).trustProxy), ['loopback', '10.0.0.0/8']);
  assert.throws(() => load({ TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  assert.throws(() => load({ TRUST_PROXY: '1' }), /TRUST_PROXY/);
  assert.throws(() => load({ NODE_ENV: 'production' }), /JWT_SECRET/);
});

const sessions = new Map();
let providerCalls = 0;
let answerEntered;
let releaseAnswer;
function session(id = 'mine', userId = 'owner') {
  return {
    id, userId, startedAt: 1, status: 'in_progress', config: { questionCount: 5 },
    summary: () => ({ interviewId: id, status: 'in_progress' }),
    start: async () => { providerCalls++; return { opening: 'Welcome', question: 'Test question' }; },
    hint: async () => { providerCalls++; return { hint: 'Test hint' }; },
    rating: async () => { throw new quotas.QuotaError('Daily cap reached', 429, 123); },
    answer: async () => { providerCalls++; answerEntered(); await new Promise(resolve => { releaseAnswer = resolve; }); return { kind: 'question' }; },
    evaluate: async () => { providerCalls++; }, _persist: async () => {}
  };
}
const requestBuckets = new Map();
const consume = quotas.createQuotaConsumer(async id => { const count = (requestBuckets.get(id) || 0) + 1; requestBuckets.set(id, count); return count; });
stub('../backend/security/quotas', {
  accountDailyLimit: async (req, res, next) => {
    try { await consume('test-day', req.user.id, req.user.id === 'quota-test' ? 2 : 200, quotas.DAY); next(); } catch (error) { next(error); }
  },
  accountStartLimit: async (req, res, next) => {
    try { await consume('test-start', req.user.id, 2, quotas.HOUR); next(); } catch (error) { next(error); }
  }
});
stub('../backend/interview/engine', {
  RequestError: class RequestError extends Error {}, validateConfig: body => body,
  getSession: async id => sessions.get(id),
  createSession: async (config, options) => session('created', options.userId)
});
const router = require('../backend/routes/interview');

async function withServer(handler) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: req.headers['x-test-user'] || 'owner' }; next(); });
  app.use('/api/interview', router);
  app.use((error, req, res, next) => { res.set('Retry-After', String(error.retryAfter || 60)); res.status(error.status || 500).json({ error: error.message }); });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await handler(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('REST ownership rejects every session endpoint before any provider work', async function () {
  sessions.set('theirs', session('theirs', 'someone-else'));
  const before = providerCalls;
  await withServer(async base => {
    for (const [method, suffix] of [['GET', ''], ['GET', '/rating'], ['POST', '/hint'], ['POST', '/answer'], ['POST', '/text-start'], ['POST', '/finalize']]) {
      const response = await fetch(base + '/api/interview/theirs' + suffix, { method });
      assert.equal(response.status, 404);
    }
  });
  assert.equal(providerCalls, before);
});

test('daily account quota and provider cap responses return 429 with Retry-After', async function () {
  sessions.set('mine', session());
  await withServer(async base => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + '/api/interview/mine', { headers: { 'x-test-user': 'quota-test' } });
      assert.equal(response.status, i === 2 ? 429 : 404);
    }
    const response = await fetch(base + '/api/interview/mine/rating');
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '123');
    assert.equal(sessions.get('mine')._httpBusy, false);
  });
});

test('concurrent operations cannot overlap on one session', async function () {
  sessions.set('mine', session());
  await withServer(async base => {
    const entered = new Promise(resolve => { answerEntered = resolve; });
    const first = fetch(base + '/api/interview/mine/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"answer":"test"}' });
    await entered;
    const response = await fetch(base + '/api/interview/mine/hint', { method: 'POST' });
    assert.equal(response.status, 409);
    releaseAnswer();
    assert.equal((await first).status, 200);
    assert.equal(sessions.get('mine')._httpBusy, false);
  });
});

test('account start quota blocks the third start', async function () {
  await withServer(async base => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + '/api/interview/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'starter' }, body: '{"mode":"voice"}' });
      assert.equal(response.status, i === 2 ? 429 : 200);
    }
  });
});

test('burst rejection does not leave a session locked', async function () {
  sessions.set('burst', session('burst', 'burst-user'));
  await withServer(async base => {
    for (let i = 0; i < 31; i++) {
      const response = await fetch(base + '/api/interview/burst', { headers: { 'x-test-user': 'burst-user' } });
      assert.equal(response.status, i === 30 ? 429 : 200);
    }
    assert.equal(sessions.get('burst')._httpBusy, false);
  });
});

test('spoofed forwarding headers cannot reset the direct-host IP limiter', async function () {
  const app = express();
  app.set('trust proxy', false);
  app.use(rateLimit({ limit: 2, windowMs: 60000, validate: { xForwardedForHeader: false } }));
  app.get('/', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { headers: { 'x-forwarded-for': '198.51.100.' + i } });
      assert.equal(response.status, i === 2 ? 429 : 200);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
