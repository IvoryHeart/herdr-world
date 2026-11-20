/**
 * One registry of every setting and command World offers (#1035). The
 * Settings screen, its search, the command box (Cmd+K), the short Menu and
 * links to a setting all read this list; none keeps its own.
 *
 * A feature adds its own entries in its own folder with `defineSettings`
 * (see world/town/town.settings.ts) and one import line in
 * settings/catalog.ts; the shell (Menu, Settings screen, command box) never
 * changes for a new setting.
 *
 * An entry holds what it is and how to read and change it, not its value:
 * values stay where they are kept today (this browser's storage, the store,
 * the server), so a setting found here and the same setting on its view or in
 * an older dialog are one value.
 */

import type { ComponentType, ReactNode } from "react";

/** The categories, in the order the Settings screen shows them. */
export const SETTINGS_CATEGORIES = [
  {
    id: "appearance",
    label: "Appearance",
    detail: "Theme, colour and text sizes",
  },
  {
    id: "town",
    label: "Town & views",
    detail: "Time of day, motion and what opening an agent shows",
  },
  {
    id: "notifications",
    label: "Notifications & sounds",
    detail: "Chimes, alerts and the count on the tab",
  },
  {
    id: "agents",
    label: "Agents",
    detail: "Profiles, voices and how agents start",
  },
  {
    id: "keyboard",
    label: "Keyboard",
    detail: "Shortcuts and the phone's terminal keys",
  },
  {
    id: "integrations",
    label: "Integrations",
    detail: "Sources, metrics, harnesses and hosts",
  },
  {
    id: "system",
    label: "This World",
    detail: "Name, connection, updates and session",
  },
  {
    id: "commands",
    label: "Commands",
    detail:
      "Workspaces, tabs, panes, agents and windows, as the command box offers them now",
  },
  { id: "help", label: "Help", detail: "Guides, changes and reporting" },
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

/** Where a value is kept, shown beside it so nobody guesses. */
export type SettingScope =
  /** This browser's storage. */
  | "browser"
  /** Synced through the World service to every browser. */
  | "world"
  /** The connection (host) that is open. */
  | "connection";

export const SCOPE_LABELS: Record<SettingScope, string> = {
  browser: "This browser",
  world: "All browsers",
  connection: "This connection",
};

/** What the shell hands entries: the controls App owns, and ways out. */
export type SettingsHost = {
  /** App-owned appearance values and their setters (ConfigurationProps). */
  appearance: {
    theme: "light" | "dark" | "system";
    setTheme(theme: "light" | "dark" | "system"): void;
    accentColor: string;
    setAccentColor(accent: string): void;
    blackBackground: boolean;
    setBlackBackground(on: boolean): void;
    uiScale: number;
    setUiScale(scale: number): void;
    terminalFontScale: number;
    setTerminalFontScale(scale: number): void;
  };
  zen: { on: boolean; available: boolean; set(on: boolean): void };
  /** Opens a dialog the shell owns: the cheat sheet, profiles, sounds… */
  openPanel(panel: SettingsPanel): void;
  mobile: boolean;
  mac: boolean;
  /** This World asks browsers to sign in, so Log out means something. */
  signedIn: boolean;
};

export type SettingsPanel =
  /** The read-only shortcut cheat sheet. */
  | "shortcuts"
  /** Change a key or choose a preset. */
  | "shortcut-editor"
  | "agent-profiles"
  | "sounds"
  /** Terminal colour themes and font. */
  | "terminal-look"
  /** Phone or desktop layout, breakpoint and sidebar order. */
  | "layout"
  /** The key bar above a phone's keyboard. */
  | "phone-keys"
  /** Automatic branch updates on this connection. */
  | "branch-sync";

/** What a page inside Settings is given. */
export type SettingsPageProps = {
  /** A row to show first, such as the Integrations row `source:github`. */
  focus?: string;
  /** Closes Settings, for a page that starts something elsewhere. */
  close(): void;
};

/**
 * A group of settings shown whole inside Settings, with a way back to the
 * list: loaded when first opened, so the list stays light.
 */
export type SettingsPage = {
  load(): Promise<{ default: ComponentType<SettingsPageProps> }>;
  /** The row the page shows first. */
  focus?: string;
};

export type ChoiceOption<T extends string = string> = {
  value: T;
  label: string;
  /** Other words a person would use for this option ("dark" for Night). */
  words?: readonly string[];
};

/** How a setting is changed: one of a few shapes the screen draws. */
export type SettingControl =
  | {
      type: "toggle";
      get(host: SettingsHost): boolean;
      set(host: SettingsHost, on: boolean): void;
      /** While a change is saving the switch ignores presses. */
      busy?(): boolean;
    }
  | {
      type: "choice";
      options: readonly ChoiceOption[];
      get(host: SettingsHost): string;
      set(host: SettingsHost, value: string): void;
    }
  | {
      type: "stepper";
      min: number;
      max: number;
      step: number;
      /** The value as shown: "110%". */
      format(value: number): string;
      get(host: SettingsHost): number;
      set(host: SettingsHost, value: number): void;
      /** What the value button does, if anything ("Reset", "Link"). */
      reset?: { label: string; run(host: SettingsHost): void };
    }
  | {
      type: "text";
      placeholder?: string;
      maxLength?: number;
      get(host: SettingsHost): string;
      set(host: SettingsHost, value: string): void;
    };

type EntryBase = {
  /** Stable id: links (`?setting=<id>`) and tests use it. */
  id: string;
  category: SettingsCategory;
  title: string;
  /** One plain line under the title. */
  description?: string;
  /** Words people use for it that the title lacks ("lighting", "night"). */
  words?: readonly string[];
  icon?: ReactNode;
  /** Shown only where it means something. */
  platform?: "phone" | "desktop" | "mac";
  /** Development builds only. */
  dev?: boolean;
  /** Hidden when the host cannot offer it (for example, no sign-in). */
  available?(host: SettingsHost): boolean;
  /**
   * A control that also lives on a view, such as Town's time-of-day button.
   * The screen says where, so a person learns both places.
   */
  alsoOn?: string;
  /** Re-reads the value, and whether it is `available`, when something outside changes it. */
  subscribe?(listener: () => void): () => void;
  /**
   * The surface that published the entry and already lists it itself, so it
   * does not list it twice: "command-box" for the command box's own commands.
   */
  listedBy?: "command-box";
};

export type SettingEntry = EntryBase & {
  kind: "setting";
  scope: SettingScope;
  control: SettingControl;
  /**
   * The setting's state in words, read when shown, in place of the
   * description: "Blocked by browser permissions".
   */
  status?(): string | null;
};

/**
 * A group of settings: a page inside Settings, or a dialog or view control
 * it opens. Without either the entry only says where it lives (`alsoOn`).
 */
export type PanelEntry = EntryBase & {
  kind: "panel";
  scope?: SettingScope;
  /** Shown inside Settings, with Back to the list. */
  page?: SettingsPage;
  /** Opens a dialog or a view's control; Settings closes first. */
  open?(host: SettingsHost): void;
};

/** Something to do now, not a value: reload, check for updates, log out. */
export type CommandEntry = EntryBase & {
  kind: "command";
  /** The key that runs it, as shown ("Ctrl+K"), if any. */
  shortcut?: () => string | null;
  /** Kept on the short Menu: things people do every day. */
  menu?: boolean;
  run(host: SettingsHost): void | Promise<unknown>;
  danger?: boolean;
  /**
   * Why it cannot run now, read when shown: the command box's own admission
   * (a creation the active connection refuses, a stale selection).
   */
  disabledReason?(): string | null;
};

export type RegistryEntry = SettingEntry | PanelEntry | CommandEntry;

const entries = new Map<string, RegistryEntry>();
const sources = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
let snapshot: readonly RegistryEntry[] = [];

/**
 * Adds a feature's entries. Calling it again with the same `source` replaces
 * that feature's entries (hot reload, tests). Ids are unique across
 * features: a clash throws, so two features never fight over one link.
 */
export function defineSettings(source: string, list: readonly RegistryEntry[]) {
  for (const id of sources.get(source) ?? []) entries.delete(id);
  for (const entry of list) {
    if (entries.has(entry.id))
      throw new Error(`Setting ${entry.id} is already defined`);
    entries.set(entry.id, entry);
  }
  sources.set(
    source,
    list.map((entry) => entry.id),
  );
  const order = new Map(
    SETTINGS_CATEGORIES.map((category, index) => [category.id, index]),
  );
  snapshot = [...entries.values()].sort(
    (a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99),
  );
  for (const listener of listeners) listener();
}

/** Every entry, in category order and, within one, as its feature listed it. */
export function registryEntries(): readonly RegistryEntry[] {
  return snapshot;
}

export function registryEntry(id: string): RegistryEntry | undefined {
  return entries.get(id);
}

export function subscribeRegistry(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this host shows the entry at all. */
export function entryShown(
  entry: RegistryEntry,
  host: SettingsHost,
  devtools: boolean,
) {
  if (entry.dev && !devtools) return false;
  if (entry.platform === "phone" && !host.mobile) return false;
  if (entry.platform === "desktop" && host.mobile) return false;
  if (entry.platform === "mac" && !host.mac) return false;
  return entry.available ? entry.available(host) : true;
}

/**
 * Calls `listener` when anything an entry reads may have changed: each
 * entry's own `subscribe`, once per distinct source. Lists re-check values
 * and availability with it, so a row that appears once another setting is on
 * appears at once.
 */
export function subscribeEntries(
  list: readonly RegistryEntry[],
  listener: () => void,
) {
  const sources = new Set<NonNullable<RegistryEntry["subscribe"]>>();
  for (const entry of list) if (entry.subscribe) sources.add(entry.subscribe);
  const stops = [...sources].map((subscribe) => subscribe(listener));
  return () => {
    for (const stop of stops) stop();
  };
}

export function categoryLabel(id: SettingsCategory) {
  return SETTINGS_CATEGORIES.find((category) => category.id === id)!.label;
}

/** Tests: forget every entry. */
export function resetRegistryForTests() {
  entries.clear();
  sources.clear();
  snapshot = [];
}
