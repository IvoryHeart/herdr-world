import { useEffect } from "react";
import { chimeDevice } from "./chimeCenter";
import { chimeAudioReady, installChimeUnlock } from "./player";

/** Opens Settings → Sounds from any menu. */
export const WORLD_SOUNDS_EVENT = "herdr-world:sounds";
export const openSounds = () =>
  window.dispatchEvent(new Event(WORLD_SOUNDS_EVENT));

const HEARTBEAT_MS = 20_000;

/**
 * Unlock audio on the page's first gesture, and tell the notification worker
 * while this page plays chimes, so push notifications stay silent instead of
 * sounding twice.
 */
export function useChimeHost() {
  useEffect(() => {
    installChimeUnlock();
    const beat = () => {
      if (!chimeDevice().on || !chimeAudioReady()) return;
      navigator.serviceWorker?.controller?.postMessage({
        type: "herdr-world:chimes-active",
        until: Date.now() + HEARTBEAT_MS * 2,
      });
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);
}
