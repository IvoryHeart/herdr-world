import { chimeDevice } from "../../chimes/chimeCenter";
import { playEffect } from "../../chimes/player";

/**
 * The bin's sounds, synthesised like the chimes and following this device's
 * sound setting: a rustle and lid thump on drop, a crunch and falling tone on
 * close, a rising blip when an agent comes back, and a double buzz on refusal.
 */
export type BinSound = "drop" | "close" | "back" | "refuse";

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

function tone(
  ctx: AudioContext,
  out: AudioNode,
  from: number,
  to: number,
  duration: number,
  gain: number,
  when = 0,
  type: OscillatorType = "sine",
) {
  const oscillator = ctx.createOscillator();
  const level = ctx.createGain();
  const start = ctx.currentTime + when;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
  level.gain.setValueAtTime(gain, start);
  level.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(level).connect(out);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

const SOUNDS: Record<BinSound, (ctx: AudioContext, out: AudioNode) => void> = {
  drop(ctx, out) {
    noise(ctx, out, 0.18, 2400, 1.2, 0.35);
    tone(ctx, out, 140, 70, 0.18, 0.5, 0.12);
  },
  close(ctx, out) {
    noise(ctx, out, 0.35, 600, 0.8, 0.55);
    noise(ctx, out, 0.25, 1800, 2, 0.25, 0.08);
    tone(ctx, out, 520, 130, 0.5, 0.18, 0.15, "triangle");
  },
  back(ctx, out) {
    tone(ctx, out, 330, 660, 0.15, 0.15);
  },
  refuse(ctx, out) {
    tone(ctx, out, 200, 180, 0.12, 0.2, 0, "square");
    tone(ctx, out, 200, 180, 0.12, 0.2, 0.16, "square");
  },
};

export function playBinSound(sound: BinSound) {
  const device = chimeDevice();
  if (!device.on) return;
  try {
    playEffect(SOUNDS[sound], device.volume);
  } catch {
    // Audio is optional.
  }
}
