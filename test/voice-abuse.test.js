'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { WebSocket } = require('../backend/node_modules/ws');

function stub(relative, exports) {
  const filename = require.resolve(path.resolve(__dirname, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const config = { webUrl: 'http://localhost:5173', limits: { voiceSessionsPerDay: 4, globalVoiceSessionsPerDay: 50, voiceMaxMinutes: 15 } };
const sessions = new Map();
let quotaFailure = false;
let connects = 0;
let audioSends = 0;
let closes = 0;
let holdConnection = false;
let finishConnection;
stub('../backend/config', config);
stub('../backend/interview/engine', { getSession: async id => sessions.get(id) });
stub('../backend/auth/token', { verifyToken(token) { if (token !== 'owner') throw new Error('Invalid'); return { sub: 'owner' }; } });
stub('../backend/models/User', { findById() { return { select() { return { lean: async () => ({ emailVerified: true }) }; } }; } });
stub('../backend/security/quotas', { HOUR: 3600000, DAY: 86400000, consumeQuota: async scope => {
  if (quotaFailure && scope === 'voice-account-day') { const error = new Error('Daily voice limit'); Object.assign(error, { status: 429, code: 'QUOTA_EXCEEDED', retryAfter: 300 }); throw error; }
} });
class FakeVoice {
  async connect() { connects++; if (holdConnection) await new Promise(resolve => { finishConnection = resolve; }); }
  close() { closes++; }
  sendAudio() { audioSends++; }
  sendText() {}
  sendAudioStreamEnd() {}
}
stub('../backend/gemini/live', FakeVoice);
const { initLiveServer } = require('../backend/live/manager');
function session(owner = 'owner') {
  return { userId: owner, startedAt: null, status: 'in_progress', config: { mode: 'voice', questionCount: 5 }, transcript: [], questions: [], answers: [], _persist: async () => {} };
}
async function withServer(run) {
  sessions.clear(); quotaFailure = false; holdConnection = false;
  sessions.set('mine', session()); sessions.set('second', session()); sessions.set('theirs', session('other'));
  const server = http.createServer();
  const wss = initLiveServer(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}`;
  try { await run(url); } finally {
    if (finishConnection) { finishConnection(); finishConnection = null; }
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
}
function rejected(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('unexpected-response', (request, response) => { response.resume(); request.destroy(); resolve(response); });
    ws.on('error', () => {});
    ws.on('open', () => { ws.terminate(); reject(new Error('Unexpected successful upgrade')); });
  });
}
function opened(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('error', reject);
    ws.on('open', () => resolve(ws));
  });
}

test('voice upgrade rejects invalid auth, foreign origins, and another account session', async () => {
  const before = connects;
  await withServer(async url => {
    assert.equal((await rejected(url + '/live/mine?token=invalid')).statusCode, 401);
    assert.equal((await rejected(url + '/live/mine?token=owner', { origin: 'https://untrusted.example' })).statusCode, 403);
    assert.equal((await rejected(url + '/live/theirs?token=owner')).statusCode, 404);
  });
  assert.equal(connects, before);
});

test('daily voice cap rejects the upgrade before connecting the AI provider', async () => {
  const before = connects;
  await withServer(async url => {
    quotaFailure = true;
    const response = await rejected(url + '/live/mine?token=owner');
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '300');
  });
  assert.equal(connects, before);
});

test('only one pending voice connection per account; pre-ready audio is not queued', async () => {
  const before = connects;
  const beforeAudio = audioSends;
  await withServer(async url => {
    holdConnection = true;
    const first = await opened(url + '/live/mine?token=owner');
    first.send(JSON.stringify({ type: 'audio', sampleRate: 16000, data: 'AAAA' }));
    assert.equal((await rejected(url + '/live/second?token=owner')).statusCode, 409);
    assert.equal(connects, before + 1);
    assert.equal(audioSends, beforeAudio);
    first.close();
  });
});

test('invalid audio closes the socket and stops upstream streaming', async () => {
  const before = closes;
  await withServer(async url => {
    const ws = await opened(url + '/live/mine?token=owner');
    const closed = new Promise(resolve => ws.once('close', code => resolve(code)));
    ws.send(JSON.stringify({ type: 'audio', sampleRate: 999999, data: 'AAAA' }));
    assert.equal(await closed, 1008);
  });
  assert.ok(closes > before);
});

test('maximum session duration stops upstream streaming and closes the connection', async () => {
  const original = config.limits.voiceMaxMinutes;
  const before = closes;
  try {
    config.limits.voiceMaxMinutes = 0.001;
    await withServer(async url => {
      const ws = await opened(url + '/live/mine?token=owner');
      assert.equal(await new Promise(resolve => ws.once('close', code => resolve(code))), 1008);
    });
  } finally { config.limits.voiceMaxMinutes = original; }
  assert.ok(closes > before);
});
