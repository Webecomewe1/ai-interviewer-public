class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / this.targetRate;
    this.inBuffer = [];
    this.chunkSize = Math.round(this.targetRate * 0.04);
  }

  process(inputs) {
    const channel = inputs[0];
    if (!channel || !channel[0]) return true;

    for (let i = 0; i < channel[0].length; i++) {
      this.inBuffer.push(channel[0][i]);
    }

    if (this.inBuffer.length >= this.ratio + 1) {
      const out = new Float32Array(this.chunkSize);
      let written = 0;
      while (written < this.chunkSize && this.inBuffer.length - this.ratio * written > this.ratio) {
        const pos = this.ratio * written;
        const i = Math.floor(pos);
        const f = pos - i;
        const a = this.inBuffer[i];
        const b = this.inBuffer[i + 1] || 0;
        out[written++] = a + (b - a) * f;
      }
      this.inBuffer = this.inBuffer.slice(Math.floor(this.ratio * written));
      this.port.postMessage(out.subarray(0, written));
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);