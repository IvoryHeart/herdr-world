import { chimeDevice } from "../../chimes/chimeCenter";
import { playEffect } from "../../chimes/player";

/**
 * The bin's one sound, synthesised like the chimes and following this
 * device's sound setting: a crunch and falling tone when an agent closes.
 */

function noise(
  ctx: AudioContext,
  out: AudioNode,
  duration: number,
  frequency: number,
  q: number,
  gain: number,
  when = 0,
) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1)
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const level = ctx.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = q;
  level.gain.value = gain;
  source.connect(filter).connect(level).connect(out);
  source.start(ctx.currentTime + when);
}

function close(ctx: AudioContext, out: AudioNode) {
  noise(ctx, out, 0.35, 600, 0.8, 0.55);
  noise(ctx, out, 0.25, 1800, 2, 0.25, 0.08);
  const oscillator = ctx.createOscillator();
  const level = ctx.createGain();
  const start = ctx.currentTime + 0.15;
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(520, start);
  oscillator.frequency.exponentialRampToValueAtTime(130, start + 0.5);
  level.gain.setValueAtTime(0.18, start);
  level.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
  oscillator.connect(level).connect(out);
  oscillator.start(start);
  oscillator.stop(start + 0.5);
}

export function playBinCloseSound() {
  const device = chimeDevice();
  if (!device.on) return;
  try {
    playEffect(close, device.volume);
  } catch {
    // Audio is optional.
  }
}
