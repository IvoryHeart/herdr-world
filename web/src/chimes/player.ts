import type { Motif, Timbre } from "../../../shared/chimes";
export const CHIME_AUDIO_STATE_EVENT = "herdr-world:chime-audio-state";

/**
 * World's chimes, synthesised with Web Audio: no sound files. A timbre is a
 * few sine-like partials with an envelope; a motif is how its notes are
 * played (two rising notes, one falling note, a soft double knock).
 *
 * Browsers start audio only after a user gesture. The first tap or key on
 * the page unlocks it; until then `ready()` is false and World leaves the
 * sound to the OS notification. An unlocked context keeps playing in a
 * background tab on desktop browsers; a phone may suspend it, and then
 * `ready()` is false again.
 */

type Voice = {
  wave: OscillatorType;
  /** Frequency ratio and gain of each partial. */
  partials: [number, number][];
  attack: number;
  decay: number;
  /** The root note, in Hz. */
  base: number;
};

const VOICES: Record<Timbre, Voice> = {
  bell: {
    wave: "sine",
    partials: [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.18],
    ],
    attack: 0.003,
    decay: 1.6,
    base: 880,
  },
  marimba: {
    wave: "sine",
    partials: [
      [1, 1],
      [4, 0.25],
    ],
    attack: 0.002,
    decay: 0.5,
    base: 523.25,
  },
  glass: {
    wave: "sine",
    partials: [
      [1, 1],
      [2.32, 0.3],
      [4.25, 0.12],
    ],
    attack: 0.01,
    decay: 1.2,
    base: 1046.5,
  },
  kalimba: {
    wave: "triangle",
    partials: [
      [1, 1],
      [5.4, 0.1],
    ],
    attack: 0.002,
    decay: 0.7,
    base: 659.25,
  },
  pluck: {
    wave: "triangle",
    partials: [
      [1, 1],
      [2, 0.3],
      [3, 0.12],
    ],
    attack: 0.002,
    decay: 0.35,
    base: 392,
  },
  flute: {
    wave: "sine",
    partials: [
      [1, 1],
      [2, 0.08],
    ],
    attack: 0.06,
    decay: 0.6,
    base: 783.99,
  },
  woodblock: {
    wave: "sine",
    partials: [
      [1, 1],
      [2.5, 0.4],
    ],
    attack: 0.001,
    decay: 0.12,
    base: 1200,
  },
  celesta: {
    wave: "sine",
    partials: [
      [1, 1],
      [3, 0.2],
      [4.1, 0.1],
    ],
    attack: 0.002,
    decay: 0.9,
    base: 1318.5,
  },
};

/** One note: every partial of the voice, from `at`, optionally gliding. */
function note(
  context: AudioContext,
  output: AudioNode,
  voice: Voice,
  options: {
    at: number;
    frequency: number;
    gain: number;
    decay?: number;
    glideTo?: number;
  },
) {
  const decay = options.decay ?? voice.decay;
  for (const [ratio, level] of voice.partials) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = voice.wave;
    oscillator.frequency.setValueAtTime(options.frequency * ratio, options.at);
    if (options.glideTo)
      oscillator.frequency.exponentialRampToValueAtTime(
        options.glideTo * ratio,
        options.at + decay * 0.6,
      );
    envelope.gain.setValueAtTime(0.0001, options.at);
    envelope.gain.linearRampToValueAtTime(
      options.gain * level,
      options.at + voice.attack,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, options.at + decay);
    oscillator.connect(envelope).connect(output);
    oscillator.start(options.at);
    oscillator.stop(options.at + decay + 0.05);
  }
}

/** Schedule a motif in a timbre on `output`, starting now. */
export function scheduleChime(
  context: AudioContext,
  output: AudioNode,
  timbre: Timbre,
  motif: Motif,
) {
  const voice = VOICES[timbre];
  const at = context.currentTime + 0.01;
  const root = voice.base;
  if (motif === "needs_you") {
    note(context, output, voice, { at, frequency: root, gain: 0.5 });
    note(context, output, voice, {
      at: at + 0.16,
      frequency: root * 1.5,
      gain: 0.5,
    });
  } else if (motif === "finished") {
    note(context, output, voice, {
      at,
      frequency: root * 1.335,
      glideTo: root,
      gain: 0.45,
    });
  } else {
    const knock = Math.min(voice.decay, 0.18);
    for (const offset of [0, 0.13])
      note(context, output, voice, {
        at: at + offset,
        frequency: root * 0.75,
        gain: 0.3,
        decay: knock,
      });
  }
}

let context: AudioContext | null = null;

function audioContext() {
  if (context) return context;
  const Context =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
  if (!Context) return null;
  try {
    context = new Context();
    const publish = () =>
      window.dispatchEvent(new Event(CHIME_AUDIO_STATE_EVENT));
    context.addEventListener("statechange", publish);
    publish();
  } catch {
    return null;
  }
  return context;
}

let unlockInstalled = false;
/** Resume audio on the page's first taps and keys (browsers require it). */
export function installChimeUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    void audioContext()
      ?.resume()
      .catch(() => {});
  };
  for (const type of ["pointerdown", "keydown", "touchend"])
    window.addEventListener(type, unlock, { capture: true, passive: true });
}

/** Whether World can play a chime now. */
export function chimeAudioReady() {
  return context?.state === "running";
}

/** Play one chime at `volume` (0–1); false when audio isn't unlocked. */
export function playChime(timbre: Timbre, motif: Motif, volume: number) {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return false;
  const output = ctx.createGain();
  output.gain.value = Math.max(0, Math.min(1, volume));
  output.connect(ctx.destination);
  scheduleChime(ctx, output, timbre, motif);
  return true;
}

/** A preview or test from a button: the tap itself unlocks audio. */
export async function previewChime(
  timbre: Timbre,
  motif: Motif,
  volume: number,
) {
  const ctx = audioContext();
  if (!ctx) return false;
  await ctx.resume().catch(() => {});
  return playChime(timbre, motif, volume);
}
