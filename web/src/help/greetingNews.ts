import { worldLocalStorage } from "../browserStorage";
import type { HelpPictureSize, HelpPictureTheme } from "./helpEntry";
import {
  markHelpSeen,
  readHelpSeen,
  takeWhatsNewSwitch,
  whatsNew,
  type WhatsNew,
} from "./whatsNew";

let forced: { returning: boolean } | null = null;

/**
 * Reads and removes the `?whatsNewSince=` testing switch (whatsNew.ts) as
 * World opens, before the greeting shows.
 */
export function applyWhatsNewSwitch() {
  if (typeof window === "undefined") return;
  forced =
    takeWhatsNewSwitch(worldLocalStorage, window.location, window.history) ??
    forced;
}

/** What the Town Master shows this visit; `returning` when World knows a last visit. */
export function greetingNews(returning: boolean): WhatsNew | null {
  return whatsNew(
    readHelpSeen(worldLocalStorage),
    forced?.returning ?? returning,
  );
}

/** The greeting closed after showing its news: next visit shows only newer. */
export function greetingNewsSeen() {
  forced = null;
  markHelpSeen(worldLocalStorage);
}

/** The picture that matches this screen: phone or desktop, light or dark. */
export function helpPictureLook(mobile: boolean): {
  size: HelpPictureSize;
  theme: HelpPictureTheme;
} {
  return {
    size: mobile ? "phone" : "desktop",
    theme:
      typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "light"
        ? "light"
        : "dark",
  };
}
