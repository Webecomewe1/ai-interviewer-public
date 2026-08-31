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
  const id = data.interviewId;
  console.log('interview:', id);
  const ws = new WebSocket('ws://localhost:3000/live/' + id);

  const log = { ready: false, turnComplete: 0, audioChunks: 0, gotComplete: false, forced: false };
  let answered = 0;

  const timer = setTimeout(() => {
    console.log('RESULT:', JSON.stringify(log));
    try { ws.close(); } catch (e) {}
    process.exit(0);
  }, 120000);

  ws.on('open', () => console.log('ws open'));
  ws.on('error', (e) => console.log('ws error:', e.message));
  ws.on('close', (c, r) => console.log('ws closed', c, r.toString()));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case 'ready': log.ready = true; console.log('READY'); break;
      case 'audio': log.audioChunks++; break;
      case 'modelText':
        if (msg.final) console.log('MODEL (final):', msg.text.slice(0, 120));
        break;
      case 'turnComplete':
        log.turnComplete++;
        console.log('TURN COMPLETE q#' + msg.questionNumber);
        if (log.turnComplete < 4) {
          answered++;
          ws.send(JSON.stringify({
            type: 'text',
            text: 'Answer number ' + answered + ': I would investigate the problem by checking DNS settings, verifying the network path, and confirming the DHCP lease is valid. Experience with end-user support and ticketing systems has helped me troubleshoot issues like this methodically.',
          }));
        }
        break;
      case 'forcedClosing':
        log.forced = true;
        console.log('FORCED closing requested');
        break;
      case 'complete':
        log.gotComplete = true;
        console.log('******** COMPLETE received ********');
        fetch(base + '/api/interview/' + id)
          .then((r) => r.json())
          .then((s) => {
            console.log('SUMMARY: status=' + s.status +
              ' questions=' + s.questions.length +
              ' transcript=' + s.transcript.length +
              ' roles=' + s.transcript.slice(0, 6).map((t) => t.role).join(','));
            s.transcript.slice(0, 6).forEach((t) =>
              console.log('  [' + t.role + '] ' + t.text.slice(0, 90)));
          });
        break;
      case 'error':
        console.log('SERVER ERROR:', msg.message);
        break;
      case 'closed':
        console.log('SERVER CLOSED:', msg.reason);
        break;
    }
  });
})();