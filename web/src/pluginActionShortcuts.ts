import { getShortcutSnapshot } from "./shortcutPreferences";
import { matchesShortcut, type ShortcutBindings } from "./shortcutBindings";

export type PluginActionShortcut = {
  pluginId: string;
  actionId: string;
};

type PluginActionShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "isComposing" | "keyCode">>;

const PLUGIN_ACTIONS = {
  "plugin.herdrFloat.toggle": { pluginId: "herdr-float", actionId: "toggle" },
} as const satisfies Record<string, PluginActionShortcut>;

/** The plugin action a shortcut id stands for, for controls that invoke it. */
export function pluginActionShortcutFor(
  id: keyof typeof PLUGIN_ACTIONS,
): PluginActionShortcut {
  return PLUGIN_ACTIONS[id];
}

/**
 * Resolve a keydown into a Herdr plugin action to invoke, from the fixed set
 * of plugin action shortcuts World currently knows about. There is no
 * plugin action discovery/configuration UI yet, so this list is hardcoded.
 */
export function pluginActionShortcut(
  event: PluginActionShortcutEvent,
  bindings: ShortcutBindings = getShortcutSnapshot().preset.bindings,
): PluginActionShortcut | null {
  if (matchesShortcut(event, "plugin.herdrFloat.toggle", bindings)) {
    return PLUGIN_ACTIONS["plugin.herdrFloat.toggle"];
  }
  return null;
}
