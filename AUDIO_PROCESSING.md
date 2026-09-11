# Audio Processing

This document describes audio recording, encoding, streaming, and playback for voice interviews in the AI Interviewer.

## Overview

Voice interviews use a **real-time audio pipeline**:

1. **Recording** - Browser captures microphone input via Web Audio API
2. **Resampling** - AudioWorklet resamples from browser default to 16000 Hz
3. **Encoding** - PCM float samples encoded to 16-bit signed integers, then base64
4. **Streaming** - Base64 chunks sent via WebSocket to backend
5. **Backend processing** - Gemini Live API receives PCM audio at 16000 Hz (from client)
6. **Response audio** - Gemini generates audio responses at 24000 Hz
7. **Decoding** - Browser receives base64-encoded PCM at 24000 Hz
8. **Playback** - AudioBuffer created and played via Web Audio API

**Browser support**: Chrome 66+, Edge 79+, Firefox 76+ (AudioWorklet required)

## Frontend Audio Recording

### Architecture

**File**: `frontend/public/js/audio.js`

**Main class**: `VoiceSession`

**Key dependencies**:
- `AudioContext` - Web Audio API interface
- `AudioWorklet` - Real-time audio processing (runs in separate thread)
- `MediaStream` - Microphone input stream
- `WebSocket` - Real-time communication with backend

### Connection Flow

```javascript
const session = new VoiceSession({
  // Callbacks for lifecycle events
  onState: (state) => {},
  onLevel: (rms) => {},  // Volume level
  onError: (error) => {}
});

// 1. Request microphone permission and connect
await session.connect(interviewId);
// - Requests getUserMedia
// - Creates AudioContext
// - Loads AudioWorklet module (pcm.js)
// - Opens WebSocket connection
// - State changes to 'connecting' → 'active'

// 2. User speaks (start holding microphone button)
session.hold();
// - Sets holding flag to true
// - Audio chunks sent via WebSocket

// 3. User releases button
session.release();
// - Sets holding flag to false
// - Stops sending audio

// 4. Complete interview
await session.close();
// - Closes WebSocket
// - Stops microphone stream
// - Clears playback queue
```

### Microphone Setup

**Requested permissions**:
```javascript
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,      // Remove echo
    noiseSuppression: true,        // Reduce background noise
    autoGainControl: true,         // Normalize volume
  }
})
```

**Error handling**:
- Permission denied: Show "Microphone access required"
- Permission revoked: Show "Microphone disconnected"
- Not supported: Fallback to text mode

### AudioWorklet for Resampling

**File**: `frontend/public/worklets/pcm.js`

**Purpose**: Resample audio from browser's native sample rate (typically 48000 Hz) to 16000 Hz

**Implementation**:
```javascript
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Target rate: 16000 Hz
    this.targetRate = options.processorOptions.targetRate || 16000;
    // Ratio for resampling
    this.ratio = sampleRate / this.targetRate;  // e.g., 48000/16000 = 3
    this.inBuffer = [];
    // Chunk size: 16000 * 0.04 = 640 samples (40ms window)
    this.chunkSize = Math.round(this.targetRate * 0.04);
  }

  process(inputs) {
    const channel = inputs[0];  // Mono audio input
    
    // Buffer incoming samples
    for (let i = 0; i < channel[0].length; i++) {
      this.inBuffer.push(channel[0][i]);
    }
    
    // Output resampled chunks (linear interpolation)
    if (this.inBuffer.length >= this.ratio + 1) {
      const out = new Float32Array(this.chunkSize);
      let written = 0;
      
      while (written < this.chunkSize && ...) {
        const pos = this.ratio * written;
        const i = Math.floor(pos);
        const f = pos - i;
        const a = this.inBuffer[i];
        const b = this.inBuffer[i + 1] || 0;
        // Linear interpolation
        out[written++] = a + (b - a) * f;
      }
      
      // Post resampled chunk to main thread
      this.port.postMessage(out.subarray(0, written));
    }
    
    return true;  // Keep processing
  }
}

registerProcessor('pcm-processor', PCMProcessor);
```

**Parameters**:
- Input: Microphone audio stream (mono, variable sample rate)
- Output: 40ms chunks of 16000 Hz PCM (640 samples per chunk)
- Resampling method: Linear interpolation
- Latency: ~40ms (chunk window size)

### Audio Chunk Processing

**In `VoiceSession.prototype._onPcm(chunk)`**:

1. **Volume level calculation**:
```javascript
const sum = chunk.reduce((s, v) => s + v * v, 0);
const rms = Math.sqrt(sum / chunk.length);
// RMS used for audio visualization
emit('level', rms);
```

2. **Encoding to PCM 16-bit**:
```javascript
function _toBase64(chunk) {
  const len = chunk.length;
  const ab = new ArrayBuffer(len * 2);  // 2 bytes per sample
  const view = new DataView(ab);
  
  // Convert float32 (-1.0 to 1.0) to int16 (-32768 to 32767)
  for (let i = 0; i < len; i++) {
    const sample = Math.max(-1, Math.min(1, chunk[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, int16, true);  // true = little-endian
  }
  
  // Encode to base64
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let j = 0; j < bytes.length; j += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
  }
  return btoa(binary);
}
```

3. **WebSocket transmission**:
```javascript
ws.send(JSON.stringify({
  type: 'audio',
  data: base64EncodedPCM,
  sampleRate: 16000
}));
```

**Performance**:
- Chunk size: 640 samples × 2 bytes = 1,280 bytes raw
- After base64 encoding: ~1,707 bytes (~33% overhead)
- Transmitted every 40ms → ~40 KB/s bandwidth
- Typical interview (5 min): ~12 MB of audio data

## Backend Audio Streaming

**File**: `backend/gemini/live.js`

### Receiving and Forwarding Audio

**From WebSocket (client)**:
```javascript
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'audio') {
    // msg.data = base64 PCM
    // msg.sampleRate = 16000
    const pcmBase64 = msg.data;
    
    // Send to Gemini Live API
    liveVoice.sendAudio(pcmBase64, msg.sampleRate);
  }
});
```

### Configuration

**File**: `backend/config.js` (Gemini Live settings):
```javascript
gemini: {
  liveEndSensitivity: 'END_SENSITIVITY_DEFAULT',  // Silence detection
  liveSilenceMs: 1000,                             // Silence duration threshold
}
```

**Gemini Live API setup** (in `live.js`):
```javascript
const session = await client.live.connect({
  model: 'gemini-2.0-flash-exp',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    
    // Input audio transcription (for logging/debugging)
    inputAudioTranscription: { languageCodes: ['en-US'] },
    
    // Output audio transcription (receives both audio + text)
    outputAudioTranscription: { languageCodes: ['en-US'] },
    
    // Automatic activity detection (silence = end of turn)
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: 'END_SENSITIVITY_DEFAULT',
        silenceDurationMs: 1000
      }
    }
  }
});
```

### Receiving Audio Responses

**From Gemini Live API**:
```javascript
session.onmessage = (event) => {
  if (event.serverContent) {
    for (const part of event.serverContent.turnComplete) {
      if (part.audio && part.audio.data) {
        // Audio response from Gemini
        // - data: base64-encoded PCM
        // - mimeType: 'audio/pcm;rate=24000'
        
        ws.send(JSON.stringify({
          type: 'audio',
          data: part.audio.data,
          mimeType: part.audio.mimeType
        }));
      }
    }
  }
};
```

**Audio format from Gemini**:
- Encoding: 16-bit signed PCM
- Sample rate: 24000 Hz (higher quality than input)
- Channels: Mono
- Mime type: `audio/pcm;rate=24000`

## Frontend Audio Playback

### Receiving and Queuing

**WebSocket message handler** (in `audio.js`):
```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'audio') {
    // Buffer audio chunks until turn complete
    this._bufferAudio(msg.data, msg.mimeType);
    // mimeType contains sample rate: 'audio/pcm;rate=24000'
  }
  
  if (msg.type === 'turnComplete') {
    // Flush all buffered audio and start playback
    this._flushBuffer();
  }
};
```

### Audio Decoding and Creation

**In `_playAudio(dataB64, mimeType)`**:

1. **Parse sample rate from MIME type**:
```javascript
const rateMatch = mimeType.match(/rate=(\d+)/);
const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
```

2. **Decode base64 to bytes**:
```javascript
const binary = atob(dataB64);  // base64 → binary string
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) {
  bytes[i] = binary.charCodeAt(i);
}
```

3. **Convert PCM to AudioBuffer**:
```javascript
const frameCount = bytes.length / 2;  // 2 bytes per sample
const buffer = audioCtx.createBuffer(1, frameCount, sampleRate);
// Mono (1 channel) at 24000 Hz

const data = buffer.getChannelData(0);
const view = new DataView(bytes.buffer);

// Convert int16 to float32 (-1.0 to 1.0)
for (let j = 0; j < frameCount; j++) {
  const int16 = view.getInt16(j * 2, true);  // true = little-endian
  data[j] = int16 / 32768;
}
```

4. **Queue for playback**:
```javascript
const source = audioCtx.createBufferSource();
source.buffer = buffer;
source.connect(audioCtx.destination);
playQueue.push(source);

if (!playing) {
  _startNext();  // Start playback if not already playing
}
```

### Sequential Playback

**In `_startNext()`**:
```javascript
function _startNext() {
  const src = playQueue[0];
  if (!src) {
    playing = false;
    emit('aiSpeaking', false);
    return;
  }
  
  playing = true;
  emit('aiSpeaking', true);
  
  // Play audio chunk
  src.start(0);
  
  // When finished, start next chunk
  src.onended = () => {
    playQueue.shift();
    _startNext();
  };
}
```

**Behavior**:
- Audio chunks queued as they arrive
- Played in order (FIFO)
- Next chunk starts immediately after previous ends
- `aiSpeaking` event signals to UI when audio is playing

## Audio Pipeline Timing

### End-to-end Latency

| Stage | Latency | Notes |
|-------|---------|-------|
| Microphone capture | 20-40ms | OS buffer + browser processing |
| AudioWorklet resampling | 40ms | Chunk window (40ms @ 16kHz) |
| WebSocket transmission | 50-200ms | Network + compression |
| Gemini API processing | 200-800ms | Speech recognition + generation |
| Audio response transmission | 100-500ms | Network roundtrip |
| Client playback | Immediate | Queued and played sequentially |
| **Total** | **500-1600ms** | Typical: ~800ms for natural conversation |

### Buffering Strategy

**Client recording**:
- Continuous 40ms chunks
- Sent immediately when `holding === true`
- Reduces latency vs. waiting for silence

**Server processing**:
- Gemini handles silence detection automatically
- `silenceDurationMs: 1000` triggers end-of-turn
- Parallel question generation during candidate answer

**Client playback**:
- All audio chunks for a turn buffered until `turnComplete`
- Prevents interruption mid-sentence
- ~200-500ms pre-buffering before playback starts

## Error Handling

### Recording Errors

```javascript
session.on('error', (error) => {
  if (error.name === 'NotAllowedError') {
    // Microphone permission denied
    show('Microphone permission required');
  } else if (error.name === 'NotFoundError') {
    // No microphone found
    show('No microphone detected');
  } else {
    // AudioWorklet or WebSocket error
    show('Audio error: ' + error.message);
    fallbackToTextMode();
  }
});
```

### WebSocket Disconnection

```javascript
ws.onclose = () => {
  if (state === 'active' || state === 'connecting') {
    state = 'ended';
    emit('wsClosed', {});
    // Show "Connection lost - switching to text mode"
    fallbackToTextMode();
  }
};
```

### AudioWorklet Unsupported

```javascript
try {
  await audioCtx.audioWorklet.addModule('pcm.js');
} catch (err) {
  console.error('AudioWorklet not supported');
  // Fallback: Use ScriptProcessor (deprecated) or text mode
  fallbackToTextMode();
}
```

## Browser Compatibility

| Browser | Version | AudioWorklet | getUserMedia | Web Audio | Status |
|---------|---------|--------------|--------------|-----------|--------|
| Chrome | 66+ | ✓ | ✓ | ✓ | Full support |
| Edge | 79+ | ✓ | ✓ | ✓ | Full support |
| Firefox | 76+ | ✓ | ✓ | ✓ | Full support |
| Safari | 14+ | ✗ | ✓ | ✓ | Text mode only |

**Safari note**: No AudioWorklet support → Voice mode unavailable. User automatically switches to text mode.

## Performance Optimization

### Chunk Size Tuning

Current: 40ms chunks at 16000 Hz = 640 samples

```
Bandwidth: 640 samples × 2 bytes × 25 chunks/sec = 32 KB/s
Latency: 40ms per chunk
Quality: 16-bit @ 16kHz = telephone quality (sufficient for speech recognition)
```

Trade-offs:
- Smaller chunks (20ms): Lower latency, higher overhead
- Larger chunks (100ms): Lower overhead, higher latency
- Higher sample rate (24000 Hz): Better quality, more bandwidth

### Memory Usage

- AudioBuffer (5 second response): ~480 KB (24000 Hz × 5s × 2 bytes)
- PlayQueue (typical): ~2-5 buffers = 1-2 MB
- WebSocket buffer: ~100-500 KB
- **Total during interview**: 10-50 MB

## Testing Audio

### Debug Console Commands

```javascript
// Check audio context state
console.log(session.audioCtx.state);  // 'running', 'suspended', etc.

// Monitor volume level
session.on('level', (rms) => console.log('RMS:', rms));

// Check WebSocket connection
console.log('WS state:', session.ws.readyState);
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED

// Check playback queue
console.log('Playing:', session.playing, 'Queue:', session.playQueue.length);
```

### Manual Testing

**Microphone test**:
1. Open DevTools → Application → Sensors
2. Emulate specific microphone (or use real one)
3. Speak near microphone
4. Check `session.on('level')` increases when speaking

**Playback test**:
1. Start voice interview
2. Answer a question
3. Listen for AI response audio
4. Verify playback queue drains (playQueue.length → 0)

**Network test**:
1. Open DevTools → Network
2. Filter by WebSocket: `wss://` or `ws://`
3. Check message frequency (~25 messages/sec = 40ms chunks)
4. Monitor frame sizes (1.7-2 KB per chunk)

---

**See also**:
- [WEBSOCKET.md](./WEBSOCKET.md) - Real-time message protocol
- [FRONTEND.md](./FRONTEND.md#audioja---audio-recording-and-playback) - Audio.js module
- [BACKEND.md](./BACKEND.md#websocket-live-voice-handling) - Server-side audio handling
