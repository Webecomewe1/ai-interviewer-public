#!/usr/bin/env node
/**
 * Generates a short two-tone "ding dong" closing chime as raw PCM16LE mono at 24 kHz.
 * Output: backend/assets/interview-complete.pcm
 *
 * Two descending notes: A5 (880 Hz) → E5 (659.25 Hz), each 0.35 s,
 * with a 10 ms fade in/out per note to avoid clicks, then 0.7 s silence.
 * Total ≈ 1.4 s → ~67 KB at 24 kHz / 16-bit mono.
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 24000;
const AMPLITUDE = 0.5;
const FADE_SAMPLES = Math.round(SAMPLE_RATE * 0.010); // 10 ms fade
const TONE_A = 880;       // A5
const TONE_B = 659.25;    // E5
const TONE_DURATION = 0.35; // seconds each
const SILENCE_DURATION = 0.7;

const toneSamples = Math.round(SAMPLE_RATE * TONE_DURATION);
const silenceSamples = Math.round(SAMPLE_RATE * SILENCE_DURATION);
const totalSamples = toneSamples * 2 + silenceSamples;
const buf = Buffer.alloc(totalSamples * 2); // 2 bytes per sample

function fadeEnvelope(sampleIndex, totalLen) {
  if (sampleIndex < FADE_SAMPLES) return sampleIndex / FADE_SAMPLES;
  if (sampleIndex >= totalLen - FADE_SAMPLES) return (totalLen - sampleIndex) / FADE_SAMPLES;
  return 1.0;
}

let offset = 0;
for (let i = 0; i < totalSamples; i++) {
  let value = 0;
  if (i < toneSamples) {
    value = Math.sin(2 * Math.PI * TONE_A * i / SAMPLE_RATE) * fadeEnvelope(i, toneSamples);
  } else if (i < toneSamples * 2) {
    const j = i - toneSamples;
    value = Math.sin(2 * Math.PI * TONE_B * j / SAMPLE_RATE) * fadeEnvelope(j, toneSamples);
  }
  // silence otherwise — value stays 0
  const sample = Math.round(value * AMPLITUDE * 32767);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset);
  offset += 2;
}

const outPath = path.join(__dirname, '..', 'backend', 'assets', 'interview-complete.pcm');
fs.writeFileSync(outPath, buf);
const durationMs = Math.round((totalSamples / SAMPLE_RATE) * 1000);
console.log(`Wrote ${buf.length} bytes (${durationMs} ms) → ${outPath}`);
