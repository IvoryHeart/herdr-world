/**
 * Keys Chat may press in an agent's pane, in Herdr's key names: one printable
 * character, or a named key, with optional modifiers. Herdr has no names for
 * Page Up/Down, Home, End, Insert or Delete.
 */
export const CHAT_KEY =
  /^(?:(?:ctrl|alt|shift)\+){0,3}(?:[!-~]|enter|esc|tab|backspace|space|up|down|left|right|f(?:[1-9]|1[0-2]))$/;
