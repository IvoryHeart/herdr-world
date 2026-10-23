import { useEffect } from "react";
import { store } from "../store";
import { chimeDevice, CHIME_DEVICE_CHANGED_EVENT } from "./chimeCenter";
import {
  chimeAudioReady,
  installChimeUnlock,
  CHIME_AUDIO_STATE_EVENT,
} from "./player";

/** Opens Settings → Sounds from any menu. */
export const WORLD_SOUNDS_EVENT = "herdr-world:sounds";
export const openSounds = () =>
  window.dispatchEvent(new Event(WORLD_SOUNDS_EVENT));

const HEARTBEAT_MS = 20_000;

/** Whether this page gets the events it would chime for. */
export type ChimeListening = {
  now(): boolean;
  subscribe(changed: () => void): () => void;
};
const alwaysListening: ChimeListening = {
  now: () => true,
  subscribe: () => () => {},
};
/** A paused or disconnected page drops Herdr's events, so it can't chime. */
const storeListening: ChimeListening = {
  now: () => {
    const state = store.get();
    return state.status === "connected" && !state.connectionPaused;
  },
  subscribe: (changed) => {
    const unsubscribe = store.subscribe(changed);
    return () => void unsubscribe();
  },
};

/** Keep each controlled page's current sound policy fresh, including mute. */
export function startChimeHeartbeat(
  serviceWorker:
    | Pick<
        ServiceWorkerContainer,
        "controller" | "addEventListener" | "removeEventListener"
      >
    | undefined,
  device = chimeDevice,
  ready = chimeAudioReady,
  listening = alwaysListening,
) {
  let listened = listening.now();
  const beat = () => {
    listened = listening.now();
    serviceWorker?.controller?.postMessage({
      type: "herdr-world:chime-policy",
      mode: !device().on
        ? "muted"
        : listened && ready()
          ? "playing"
          : "fallback",
      until: Date.now() + HEARTBEAT_MS * 2,
    });
  };
  // The store changes often; beat only when listening flips.
  const stopListening = listening.subscribe(() => {
    if (listening.now() !== listened) beat();
  });
  // Activation claims the first page without a reload, then changes controller.
  serviceWorker?.addEventListener("controllerchange", beat);
  window.addEventListener("storage", beat);
  window.addEventListener(CHIME_DEVICE_CHANGED_EVENT, beat);
  window.addEventListener(CHIME_AUDIO_STATE_EVENT, beat);
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    stopListening();
    serviceWorker?.removeEventListener("controllerchange", beat);
    window.removeEventListener("storage", beat);
    window.removeEventListener(CHIME_DEVICE_CHANGED_EVENT, beat);
    window.removeEventListener(CHIME_AUDIO_STATE_EVENT, beat);
  };
}

/**
 * Unlock audio on the page's first gesture, and tell the notification worker
 * while this page plays chimes, so push notifications stay silent instead of
 * sounding twice.
 */
export function useChimeHost() {
  useEffect(() => {
    installChimeUnlock();
    return startChimeHeartbeat(
      navigator.serviceWorker,
      chimeDevice,
      chimeAudioReady,
      storeListening,
    );
  }, []);
}
