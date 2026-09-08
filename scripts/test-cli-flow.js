const base = 'http://localhost:3000';

(async () => {
  console.log('--- SCENE 1: HEALTH & CONNECTIVITY CHECK ---');
  try {
    const healthRes = await fetch(`${base}/api/health`);
    const health = await healthRes.json();
    console.log('Health Check:', health.ok ? 'OK (200)' : 'FAILED');

    const statusRes = await fetch(`${base}/api/status`);
    const status = await statusRes.json();
    console.log('Gemini AI configured:', status.gemini.configured);
    console.log('Gemini AI model:', status.gemini.model);
    console.log('Voice session support available:', status.gemini.voiceAvailable);
    console.log('Auth configured:', status.auth.configured);
  } catch (err) {
    console.error('Connectivity Check Failed:', err.message);
  }
})();
