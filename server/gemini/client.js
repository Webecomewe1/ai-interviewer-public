const { GoogleGenAI } = require('@google/genai');
const config = require('../config');

let client = null;

function getClient() {
  if (!client) {
    if (!config.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return client;
}

function getModel() {
  return config.gemini.model;
}

function getLiveModel() {
  return config.gemini.liveModel || config.gemini.model;
}

let cachedLiveModel = null;

async function resolveLiveModel() {
  if (config.gemini.liveModel) return config.gemini.liveModel;
  if (cachedLiveModel !== null) return cachedLiveModel;

  if (!apiKey()) {
    cachedLiveModel = null;
    return null;
  }

  try {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models?key=' +
      encodeURIComponent(apiKey());
    const res = await fetch(url);
    if (!res.ok) {
      cachedLiveModel = null;
      return null;
    }
    const data = await res.json();
    const names = (data.models || [])
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    const preferred = names.find((n) => /native-audio-latest|native-audio/i.test(n));
    const genericLive = names.find((n) => /live/i.test(n));
    cachedLiveModel = preferred || genericLive || null;
    return cachedLiveModel;
  } catch (e) {
    cachedLiveModel = null;
    return null;
  }
}

function apiKey() {
  return config.gemini.apiKey;
}

function isConfigured() {
  return Boolean(config.gemini.apiKey);
}

async function verifyKey() {
  const result = await getClient().models.get({ model: getModel() });
  return Boolean(result && result.model);
}

async function generateText({ prompt, systemInstruction, temperature = 0.7 }) {
  const request = {
    model: getModel(),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (systemInstruction) {
    request.config = request.config || {};
    request.config.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  request.config = request.config || {};
  request.config.temperature = temperature;

  const response = await getClient().models.generateContent(request);
  const text = response && response.text;
  return typeof text === 'function' ? text() : (text || '');
}

async function generateJson({ prompt, systemInstruction, schema, temperature = 0.6 }) {
  const request = {
    model: getModel(),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature,
      responseMimeType: 'application/json',
    },
  };
  if (systemInstruction) {
    request.config.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (schema) {
    request.config.responseSchema = schema;
  }

  const response = await getClient().models.generateContent(request);
  if (response && response.parsed) {
    return response.parsed;
  }
  const text = response && response.text;
  const value = typeof text === 'function' ? text() : (text || '');
  if (!value) throw new Error('Empty Gemini response');
  return JSON.parse(value);
}

module.exports = {
  getClient,
  getModel,
  getLiveModel,
  resolveLiveModel,
  isConfigured,
  verifyKey,
  generateText,
  generateJson,
};