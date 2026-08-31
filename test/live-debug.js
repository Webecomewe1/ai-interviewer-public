const { GoogleGenAI, Modality } = require('@google/genai');
const config = require('../server/config');

(async () => {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const model = process.argv[2] || 'gemini-live-2.5-flash-preview';
  console.log('Using model:', model);

  let opened = false;
  let setupDone = null;
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: 'You are a friendly voice assistant. Reply briefly.' }] },
      inputAudioTranscription: { languageCodes: ['en-US'] },
      outputAudioTranscription: { languageCodes: ['en-US'] },
    },
    callbacks: {
      onopen: () => { opened = true; console.log('-> live socket OPEN'); },
      onmessage: (e) => {
        const t = Object.keys(e).filter((k) => e[k] !== undefined && e[k] !== null);
        if (e.setupComplete) { setupDone = true; console.log('-> setupComplete'); }
        if (e.serverContent) {
          const sc = e.serverContent;
          if (sc.turnComplete) console.log('-> turnComplete');
          if (sc.outputTranscription) {
            console.log('OUTPUT-T:', JSON.stringify(sc.outputTranscription));
          }
          if (sc.inputTranscription) {
            console.log('INPUT-T:', JSON.stringify(sc.inputTranscription));
          }
        }
        console.log('<- message kinds:', t.join(','));
      },
      onerror: (err) => console.log('-> onerror:', err && err.message || err),
      onclose: (e) => console.log('-> onclose code=' + e.code + ' reason=' + (e.reason ? e.reason.toString() : '') + ' clean=' + e.wasClean),
    },
  });

  console.log('session connected; sending TEXT kick...');
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Please begin speaking now.' }] }] });

  setTimeout(() => {
    console.log('closing test');
    try { session.close(); } catch (e) {}
    process.exit(0);
  }, 20000);
})();