'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Replace service boundaries before loading the engine. These tests never load
// credentials, call Gemini, or connect to a database.
const calls = { reads: 0, writes: 0, prompts: [] };
let loadedDoc;
let nextError;
let nextResult;
function stub(relative, exports) {
  const filename = require.resolve(path.resolve(__dirname, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub('../backend/gemini/client', {
  generateJson: async function (request) {
    if (nextError) { const error = nextError; nextError = null; throw error; }
    if (nextResult) { const result = nextResult; nextResult = null; return result; }
    calls.prompts.push(request.prompt + '\n' + request.systemInstruction);
    return { opening: 'Welcome', question: 'Describe your project.' };
  }
});
stub('../backend/cache/questionBank', {
  findCachedQuestion: async function () { calls.reads++; return { text: 'Generic role question', source: 'cache' }; },
  saveGeneratedQuestion: async function () { calls.writes++; }
});
stub('../backend/interview/store', {
  createSessionDoc: async function () { return null; },
  upsertSession: async function () { return null; },
  loadSessionDoc: async function () { return loadedDoc; }
});
const { validateConfig, createSession, getSession } = require('../backend/interview/engine');
const base = { position: 'Web Developer', interviewType: 'mixed', difficulty: 'intermediate', questionCount: 5 };

test('context reaches generated prompts and bypasses shared question reads/writes', async function () {
  for (const field of ['resume', 'jobDescription', 'companyInfo']) {
    const marker = 'Private context for ' + field;
    const session = await createSession(validateConfig({ ...base, [field]: marker }));
    const readsBefore = calls.reads;
    const writesBefore = calls.writes;
    await session.start();
    assert.equal(calls.reads, readsBefore);
    assert.equal(calls.writes, writesBefore);
    assert.ok(calls.prompts.at(-1).includes(marker));
    assert.equal(session.questions[0].source, 'generated');
  }
});

test('generic sessions still use the role question cache', async function () {
  const session = await createSession(validateConfig(base));
  const readsBefore = calls.reads;
  await session.start();
  assert.equal(calls.reads, readsBefore + 1);
  assert.equal(session.questions[0].text, 'Generic role question');
});

test('loading a persisted session restores personalization for subsequent prompts', async function () {
  loadedDoc = {
    _id: 'persisted-context-test', mode: 'text',
    config: { ...base, resume: 'Project history', jobDescription: 'Role requirements', companyInfo: 'Team context' },
    status: 'in_progress', questions: [], answers: [], transcript: []
  };
  const session = await getSession(loadedDoc._id);
  assert.equal(session.config.resume, 'Project history');
  assert.equal(session.config.jobDescription, 'Role requirements');
  assert.equal(session.config.companyInfo, 'Team context');
  const readsBefore = calls.reads;
  await session.start();
  assert.equal(calls.reads, readsBefore);
  assert.ok(calls.prompts.at(-1).includes('Role requirements'));
});

test('custom roles require a nonblank role name', function () {
  assert.throws(function () { validateConfig({ ...base, position: 'Custom Position', customPosition: '   ' }); }, /Enter the role/);
  assert.equal(validateConfig({ ...base, position: 'Custom Position', customPosition: 'Product Designer' }).customPosition, 'Product Designer');
});

test('evaluation preserves quota errors without fabricated scores and permits retry', async function () {
  const session = await createSession(validateConfig(base));
  nextError = Object.assign(new Error('Daily quota reached'), { status: 429, code: 'QUOTA_EXCEEDED' });
  await assert.rejects(session.rating(), error => error.code === 'QUOTA_EXCEEDED');
  assert.equal(session.evaluation, null);
  assert.equal(session.evaluationPromise, null);
  nextResult = { technical: 8, problemSolving: 8, communication: 8, clarity: 8, confidence: 8, adaptability: 8, note: 'Test evaluation', suggestions: ['Add an example.'] };
  assert.equal((await session.evaluate()).overall, 8);
});
