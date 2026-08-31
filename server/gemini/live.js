const { Modality } = require('@google/genai');
const geminiClient = require('./client');
const config = require('../config');

class LiveVoice {
  constructor() {
    this.session = null;
    this.queue = [];
    this.connectError = null;
    this.onOpen = null;
    this.onError = null;
    this.onClose = null;
  }

  async connect({ systemInstruction, onMessage }) {
    const client = geminiClient.getClient();
    const liveModel = await geminiClient.resolveLiveModel();
    if (!liveModel) {
      throw new Error('No live-capable Gemini model is available for voice.');
    }
    try {
      this.session = await client.live.connect({
        model: liveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          inputAudioTranscription: { languageCodes: ['en-US'] },
          outputAudioTranscription: { languageCodes: ['en-US'] },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: config.gemini.liveEndSensitivity,
              silenceDurationMs: config.gemini.liveSilenceMs,
            },
          },
        },
        callbacks: {
          onopen: () => this.onOpen && this.onOpen(),
          onmessage: onMessage,
          onerror: (e) => this.onError && this.onError(e),
          onclose: (e) => this.onClose && this.onClose(e),
        },
      });
      this.flush();
      return this.session;
    } catch (err) {
      this.connectError = err;
      this.queue = [];
      throw err;
    }
  }

  _send(run) {
    if (this.session) {
      run(this.session);
      return;
    }
    if (this.connectError) throw this.connectError;
    this.queue.push(run);
  }

  flush() {
    if (!this.session) return;
    const pending = this.queue;
    this.queue = [];
    for (const run of pending) {
      run(this.session);
    }
  }

  sendAudio(dataBase64, sampleRate = 16000) {
    this._send((s) =>
      s.sendRealtimeInput({
        audio: { data: dataBase64, mimeType: `audio/pcm;rate=${sampleRate}` },
      })
    );
  }

  sendAudioStreamEnd() {
    this._send((s) => s.sendRealtimeInput({ audioStreamEnd: true }));
  }

  sendText(text) {
    this._send((s) =>
      s.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
      })
    );
  }

  sendBegin(text = 'You may begin the interview now.') {
    this._send((s) =>
      s.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
      })
    );
  }

  close() {
    this.queue = [];
    try {
      if (this.session) this.session.close();
    } catch (e) {
      /* ignore */
    }
    this.session = null;
  }
}

module.exports = LiveVoice;