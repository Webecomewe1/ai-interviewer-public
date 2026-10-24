'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
function stub(relative, exports) {
  const filename = require.resolve(path.resolve(__dirname, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
let requests = [];
let reservations = 0;
const config = { gemini: { apiKey: 'test-only-not-a-real-key', model: 'test-model', liveModel: '' }, limits: { aiCallsPerDay: 2 } };
stub('../backend/config', config);
stub('../backend/security/quotas', { DAY: 86400000, consumeQuota: async (scope, key, limit) => {
  assert.equal(scope, 'provider-calls-day');
  assert.equal(key, 'all');
  if (++reservations > limit) throw Object.assign(new Error('Daily limit'), { status: 429, code: 'QUOTA_EXCEEDED' });
} });
const sdkFilename = createRequire(require.resolve('../backend/gemini/client')).resolve('@google/genai');
require.cache[sdkFilename] = { id: sdkFilename, filename: sdkFilename, loaded: true, exports: {
  GoogleGenAI: class { constructor() { this.models = { generateContent: async request => { requests.push(request); return { text: '{}', parsed: { ok: true } }; } }; } }
} };
const client = require('../backend/gemini/client');

test('text and JSON generation share a cap enforced before provider invocation', async () => {
  await client.generateText({ prompt: 'test' });
  await client.generateJson({ prompt: 'test' });
  await assert.rejects(client.generateJson({ prompt: 'blocked' }), error => error.status === 429);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.config.maxOutputTokens, 2048);
    assert.equal(request.config.httpOptions.timeout, 60000);
  }
});

test('concurrent and repeated status discovery failures produce only one upstream request', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false }; };
  try {
    await Promise.all(Array.from({ length: 10 }, () => client.resolveLiveModel()));
    await client.resolveLiveModel();
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('oversized provider input is rejected before reserving quota or invoking Gemini', async () => {
  const before = reservations;
  await assert.rejects(client.generateJson({ prompt: 'x'.repeat(160 * 1024 + 1) }), error => error.status === 413);
  assert.equal(reservations, before);
  assert.equal(requests.length, 2);
});
