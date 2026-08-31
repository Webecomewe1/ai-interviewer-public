const WebSocket = require('ws');
const base = process.env.BASE || 'http://localhost:3000';

(async () => {
  const res = await fetch(base + '/api/interview/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position: 'IT Generalist Intern',
      interviewType: 'mixed',
      difficulty: 'intermediate',
      questionCount: 2,
      mode: 'voice',
    }),
  });
  const data = await res.json();
  console.log('interview:', data.interviewId);
  const ws = new WebSocket('ws://localhost:3000/live/' + data.interviewId);

  const got = { ready: 0, audioChunks: 0, audioBase64Bytes: 0, finalModelText: null, turnComplete: 0 };

  const timer = setTimeout(() => {
    console.log('RESULT:', JSON.stringify(got));
    try { ws.close(); } catch (e) {}
    process.exit(0);
  }, 50000);

  ws.on('open', () => console.log('ws open'));
  ws.on('error', (e) => console.log('ws error:', e.message));
  ws.on('close', (code, reason) => console.log('ws closed', code, reason.toString()));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case 'ready': got.ready++; console.log('READY (session started, live connected)'); break;
      case 'audio':
        got.audioChunks++;
        got.audioBase64Bytes += msg.data.length;
        break;
      case 'modelText':
        if (msg.final) { got.finalModelText = msg.text; console.log('MODEL FINAL TEXT:', msg.text); }
        break;
      case 'candidateText':
        console.log('candidateText:', msg.final ? '(final) ' : '(interim) ', msg.text);
        break;
      case 'turnComplete':
        got.turnComplete++;
        console.log('TURN COMPLETE  q#' + msg.questionNumber);
        break;
      case 'complete':
        console.log('******** INTERVIEW COMPLETE ********');
        break;
      case 'error':
        console.log('SERVER ERROR:', msg.message);
        break;
      case 'closed':
        console.log('SERVER CLOSED:', msg.reason);
        break;
      default:
        console.log('MSG:', msg.type, JSON.stringify(msg).slice(0, 180));
    }
  });
})();