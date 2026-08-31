const WebSocket = require('ws');
const fs = require('fs');

const base = 'http://localhost:3000';

(async () => {
  const res = await fetch(base + '/api/interview/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position: 'IT Generalist Intern',
      interviewType: 'mixed',
      difficulty: 'intermediate',
      questionCount: 1,
      mode: 'voice',
    }),
  });
  const data = await res.json();
  console.log('interview:', data.interviewId);
  const ws = new WebSocket('ws://localhost:3000/live/' + data.interviewId);

  // Decode candidate.wav (16-bit PCM, 16kHz mono) then re-chunk as base64
  const wav = fs.readFileSync('C:/Users/shiro/AppData/Local/Temp/opencode/candidate.wav');
  const chunkSize = wav.length - 44;
  const pcm = Buffer.alloc(chunkSize);
  wav.copy(pcm, 0, 44, 44 + chunkSize); // starting from offset we assume data chunk right after header
  // The header may include metadata chunks; find 'data' chunk properly
  let offset = 12;
  let dataStart = -1;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') { dataStart = offset + 8; break; }
    offset += 8 + size + (size % 2);
  }
  console.log('pcm samples:', Math.floor(pcm.length / 2), 'dataStart:', dataStart, 'wavLen:', wav.length);

  let sent = 0;
  let startedStreaming = false;
  const CHUNK = 640 * 2; // 40ms of 16kHz mono 16bit
  const sendNext = () => {
    if (dataStart < 0 || dataStart + CHUNK > wav.length) {
      console.log('sent all audio bytes:', sent);
      return;
    }
    const part = wav.slice(dataStart, dataStart + CHUNK);
    dataStart += CHUNK;
    sent += part.length;
    ws.send(JSON.stringify({ type: 'audio', data: part.toString('base64'), sampleRate: 16000 }));
    if (dataStart + CHUNK > wav.length) {
      setTimeout(sendNext, 40);
    } else {
      setTimeout(sendNext, 40);
    }
  };
  const startStreaming = () => {
    if (startedStreaming) return;
    startedStreaming = true;
    console.log('— streaming speech...');
    sendNext();
  };

  const timer = setTimeout(() => {
    console.log('done, audio sent:', sent);
    fetch(base + '/api/interview/' + data.interviewId)
      .then((r) => r.json())
      .then((s) => {
        console.log('SUMMARY: status=' + s.status +
          ' questions=' + s.questions.length +
          ' transcript=' + s.transcript.length);
        s.transcript.forEach((t) =>
          console.log('  [' + t.role + '] ' + t.text.slice(0, 100)));
      })
      .finally(() => process.exit(0));
  }, 30000);

  ws.on('open', () => console.log('ws open'));
  ws.on('error', (e) => console.log('ws error:', e.message));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'ready') {
      console.log('READY — will start sending speech after AI speaks (waiting for turnComplete)');
    } else if (msg.type === 'candidateText') {
      console.log('CANDIDATE', msg.final ? 'FINAL' : '   partial:', JSON.stringify(msg.text));
    } else if (msg.type === 'turnComplete') {
      console.log('turnComplete q#' + msg.questionNumber);
      if (msg.questionNumber === 1) startStreaming();
    } else if (msg.type === 'modelText') {
      if (msg.final) console.log('MODEL:', msg.text.slice(0, 80));
    } else if (msg.type === 'audio') {
      // ignore
    } else {
      console.log('MSG', msg.type, JSON.stringify(msg).slice(0, 160));
    }
  });
})();