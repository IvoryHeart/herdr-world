import {
  Bell,
  BellRing,
  CheckCheck,
  Inbox,
  Music,
  Volume2,
} from "lucide-react";
import { worldLocalStorage } from "../../browserStorage";
import {
  CHIME_DEVICE_CHANGED_EVENT,
  chimeDevice,
  setChimeDevice,
} from "../../chimes/chimeCenter";
import { store } from "../../store";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
} from "../../world/officePreferences";
import { defineSettings } from "../registry";

function subscribeChimeDevice(listener: () => void) {
  window.addEventListener(CHIME_DEVICE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHIME_DEVICE_CHANGED_EVENT, listener);
}

function subscribeOffice(listener: () => void) {
  window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, listener);
  return () =>
    window.removeEventListener(
      WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
      listener,
    );
}

const subscribeStore = (listener: () => void) => store.subscribe(listener);

/** Notifications & sounds: wired whole (#1035 prototype). */
defineSettings("notifications", [
  {
    kind: "setting",
    id: "sounds.on",
    category: "notifications",
    title: "Sounds on this device",
    description: "Chimes when an agent needs you; each device decides",
    words: ["sound", "chime", "audio", "mute", "silence", "quiet"],
    icon: <Volume2 size={15} />,
    scope: "browser",
    subscribe: subscribeChimeDevice,
    control: {
      type: "toggle",
      get: () => chimeDevice().on,
      set: (_host, on) => setChimeDevice({ ...chimeDevice(), on }),
    },
  },
  {
    kind: "setting",
    id: "sounds.volume",
    category: "notifications",
    title: "Sound volume",
    description: "How loud chimes play on this device",
    words: ["sound", "volume", "loud", "quiet", "chime"],
    icon: <Volume2 size={15} />,
    scope: "browser",
    subscribe: subscribeChimeDevice,
    control: {
      type: "stepper",
      min: 0,
      max: 100,
      step: 10,
      format: (value) => `${value}%`,
      get: () => Math.round(chimeDevice().volume * 100),
      set: (_host, value) =>
        setChimeDevice({
          ...chimeDevice(),
          volume: Math.min(1, Math.max(0, value / 100)),
        }),
    },
  },
  {
    kind: "panel",
    id: "sounds.chimes",
    category: "notifications",
    title: "Chimes and who plays them",
    description: "Each agent's chime, motif and instrument",
    words: ["sounds", "chime", "motif", "timbre"],
    icon: <Music size={15} />,
    scope: "world",
    open: (host) => host.openPanel("sounds"),
  },
  {
    kind: "setting",
    id: "notifications.tasks",
    category: "notifications",
    title: "Task notifications",
    description:
      "System notifications from this browser, even in the background",
    words: ["notify", "alerts", "push", "desktop notification"],
    icon: <Bell size={15} />,
    scope: "browser",
    subscribe: subscribeStore,
    status: () => {
      const s = store.get();
      if (s.taskNotificationBusy) return "Saving...";
      if (s.taskNotificationPermission === "unsupported")
        return "Not supported by this browser";
      if (s.taskNotificationPermission === "denied")
        return "Blocked by browser permissions";
      if (!s.taskNotificationsEnabled) return null;
      return s.taskNotificationTransport === "push"
        ? "On · Background push"
        : "On · Active page only";
    },
    control: {
      type: "toggle",
      get: () => store.get().taskNotificationsEnabled,
      set: (_host, on) => void store.setTaskNotificationsEnabled(on),
      busy: () => store.get().taskNotificationBusy,
    },
  },
  {
    kind: "setting",
    id: "notifications.needs-attention",
    category: "notifications",
    title: "Notify when a task needs you",
    description: "With task notifications on",
    words: ["blocked", "needs attention", "waiting"],
    icon: <BellRing size={15} />,
    scope: "browser",
    subscribe: subscribeStore,
    available: () => store.get().taskNotificationsEnabled,
    control: {
      type: "toggle",
      get: () => store.get().taskNotificationPreferences.blocked,
      set: (_host, on) =>
        void store.setTaskNotificationPreference("blocked", on),
      busy: () => store.get().taskNotificationBusy,
    },
  },
  {
    kind: "setting",
    id: "notifications.completed",
    category: "notifications",
    title: "Notify when a task finishes",
    description: "With task notifications on",
    words: ["completed", "done", "finished"],
    icon: <CheckCheck size={15} />,
    scope: "browser",
    subscribe: subscribeStore,
    available: () => store.get().taskNotificationsEnabled,
    control: {
      type: "toggle",
      get: () => store.get().taskNotificationPreferences.completed,
      set: (_host, on) =>
        void store.setTaskNotificationPreference("completed", on),
      busy: () => store.get().taskNotificationBusy,
    },
  },
  {
    kind: "setting",
    id: "notifications.tab-count",
    category: "notifications",
    title: "Count on tab and app icon",
    description:
      "The browser tab and installed app show how many things need you",
    words: ["badge", "unread", "favicon", "needs you count"],
    icon: <Inbox size={15} />,
    scope: "browser",
    subscribe: subscribeOffice,
    control: {
      type: "toggle",
      get: () => readOfficePreferences(worldLocalStorage).tabBadge,
      set: (_host, on) => {
        const next = writeOfficePreferences(worldLocalStorage, {
          ...readOfficePreferences(worldLocalStorage),
          tabBadge: on,
        });
        window.dispatchEvent(
          new CustomEvent(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, {
            detail: next,
          }),
        );
      },
    },
  },
]);
