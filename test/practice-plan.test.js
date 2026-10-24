'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/public/js/results.js'), 'utf8');

// A small DOM boundary lets us exercise the actual results controller and
// storage/navigation outcome without an account, credentials, or an AI call.
async function render(summary, savedDraft) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      children: [], textContent: '', innerHTML: '', style: {},
      classList: {
        add: function (...values) { values.forEach(value => classes.add(value)); },
        remove: function (...values) { values.forEach(value => classes.delete(value)); },
        toggle: function (value, force) { if (force) classes.add(value); else classes.delete(value); },
        contains: value => classes.has(value)
      },
      addEventListener() {}, setAttribute() {},
      appendChild(child) { this.children.push(child); },
      insertBefore(child) { this.children.unshift(child); },
      replaceChildren() { this.children = []; }
    };
  }
  const storage = new Map([['ai-interviewer:setup', JSON.stringify(savedDraft || {})]]);
  const context = {
    document: {
      title: '',
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element
    },
    window: {
      Auth: { isLoggedIn: () => true },
      UI: {
        api: async () => summary, loadSession: () => null,
        saveSession() {}, upsertHistory() {}, clearSession() {}, flash() {}, toast() {},
        formatDuration: () => '1m', titleCase: value => value
      }
    },
    location: { search: '?id=test-session', href: '' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URLSearchParams, console
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, storage, context };
}
const base = {
  interviewId: 'test-session', position: 'Custom Position', customPosition: 'Data Analyst',
  difficulty: 'advanced', interviewType: 'mixed', questionCount: 10,
  status: 'completed', transcript: [], questionTiming: [],
  evaluation: { overall: 7, technical: 8, problemSolving: 7, communication: 4, clarity: 6, confidence: 7, adaptability: 8, suggestions: [] }
};

test('lowest communication score prepares a short behavioral session and preserves role/context', async function () {
  const result = await render(base, { resume: 'My project summary', jobDescription: 'Analytics role' });
  assert.match(result.elements.get('practice-focus').textContent, /communication \(4\/10\)/);
  assert.equal(result.elements.get('practice-tasks').children.length, 3);
  result.elements.get('practice-focus-btn').onclick();
  const draft = JSON.parse(result.storage.get('ai-interviewer:setup'));
  assert.equal(draft.interviewType, 'behavioral');
  assert.equal(draft.questionCount, '5');
  assert.equal(draft.customPosition, 'Data Analyst');
  assert.equal(draft.difficulty, 'advanced');
  assert.equal(draft.resume, 'My project summary');
  assert.equal(draft.jobDescription, 'Analytics role');
  assert.equal(result.context.location.href, 'index.html#setup-form');
});

test('a low technical score selects technical practice', async function () {
  const result = await render({ ...base, evaluation: { ...base.evaluation, technical: 2 } });
  result.elements.get('practice-focus-btn').onclick();
  assert.equal(JSON.parse(result.storage.get('ai-interviewer:setup')).interviewType, 'technical');
});

test('missing evaluation hides the scored practice plan', async function () {
  const result = await render({ ...base, evaluation: null });
  assert.equal(result.elements.get('next-practice').classList.contains('hidden'), true);
});
