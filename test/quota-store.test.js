'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Schema } = require('../backend/node_modules/mongoose');
const counts = new Map();
let failure;
let duplicateOnce = false;
let lastOptions;
let registeredSchema;
const model = {
  findOneAndUpdate(query, update, options) {
    lastOptions = options;
    return { lean: async () => {
      if (failure) throw failure;
      if (duplicateOnce) { duplicateOnce = false; throw Object.assign(new Error('Race'), { code: 11000 }); }
      const count = (counts.get(query._id) || 0) + update.$inc.count;
      counts.set(query._id, count);
      return { count };
    } };
  }
};
function stub(relative, exports) {
  const filename = require.resolve(path.resolve(__dirname, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub('../backend/config', { mongoUri: 'test-fixture' });
stub('../backend/db', { mongoose: { Schema, models: {}, model(name, schema) { registeredSchema = schema; return model; }, connection: { readyState: 1 } } });
const { consumeQuota } = require('../backend/security/quotas');

test('Mongo-backed reservations use atomic increments, bounded waits and TTL expiry', async () => {
  await consumeQuota('persistent', 'owner', 2, 60000);
  await consumeQuota('persistent', 'owner', 2, 60000);
  await assert.rejects(consumeQuota('persistent', 'owner', 2, 60000), error => error.status === 429);
  assert.equal(lastOptions.upsert, true);
  assert.equal(lastOptions.new, true);
  assert.equal(lastOptions.maxTimeMS, 3000);
  assert.equal(registeredSchema.options.bufferCommands, false);
  assert.ok(registeredSchema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
});

test('a competing first insert is retried atomically without opening the quota', async () => {
  duplicateOnce = true;
  await consumeQuota('race', 'owner', 1, 60000);
  assert.equal(lastOptions.upsert, undefined);
  await assert.rejects(consumeQuota('race', 'owner', 1, 60000), error => error.status === 429);
});

test('Mongo write failures return unavailable instead of bypassing the quota', async () => {
  failure = new Error('Simulated database outage');
  try {
    await assert.rejects(consumeQuota('outage', 'owner', 1, 60000), error => error.status === 503 && error.code === 'QUOTA_UNAVAILABLE');
  } finally { failure = null; }
});
