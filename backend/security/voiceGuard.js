// Bounds are independent of HTTP middleware: WebSocket frames bypass Express.
class VoiceGuard {
  constructor(maxMinutes, now = Date.now) {
    this.now = now;
    this.windowStart = now();
    this.messages = 0;
    this.bytes = 0;
    this.audioBytes = 0;
    this.maxAudioBytes = maxMinutes * 60 * 16000 * 2;
    this.lastTextAt = -Infinity;
  }

  acceptFrame(raw) {
    const time = this.now();
    if (time - this.windowStart >= 1000) {
      this.windowStart = time;
      this.messages = 0;
      this.bytes = 0;
    }
    this.messages++;
    this.bytes += raw.length;
    return raw.length <= 64 * 1024 && this.messages <= 100 && this.bytes <= 128 * 1024;
  }

  acceptMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'audio') {
      if (message.sampleRate !== 16000 || typeof message.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data) || !message.data.length) return false;
      this.audioBytes += Buffer.byteLength(message.data, 'base64');
      return this.audioBytes <= this.maxAudioBytes;
    }
    if (message.type === 'text') {
      const time = this.now();
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 2000 || time - this.lastTextAt < 2000) return false;
      this.lastTextAt = time;
      return true;
    }
    return ['ping', 'audioEnd', 'assessmentChoice'].includes(message.type);
  }
}

module.exports = { VoiceGuard };
