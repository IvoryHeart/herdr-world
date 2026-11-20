import {
  ALargeSmall,
  LayoutDashboard,
  MessageSquareText,
  Moon,
  Palette,
  SquareTerminal,
  SunMoon,
  Type,
} from "lucide-react";
import {
  ACCENT_OPTIONS,
  clampTerminalFontScale,
  clampUiScale,
  TERMINAL_FONT_SCALE_DEFAULT,
  TERMINAL_FONT_SCALE_MAX,
  TERMINAL_FONT_SCALE_MIN,
  TERMINAL_FONT_SCALE_STEP,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
} from "../../appearance";
import {
  getChatTextScale,
  setChatTextScale,
  subscribeChatTextScale,
} from "../../textScales";
import { defineSettings } from "../registry";

const percent = (value: number) => `${value}%`;

/** Appearance (#1035). */
defineSettings("appearance", [
  {
    kind: "setting",
    id: "appearance.theme",
    category: "appearance",
    title: "Theme",
    description: "Light, dark, or as this device is set",
    words: ["dark mode", "light mode", "colour scheme", "color scheme"],
    icon: <SunMoon size={15} />,
    scope: "browser",
    control: {
      type: "choice",
      options: [
        { value: "light", label: "Light", words: ["bright", "day"] },
        { value: "dark", label: "Dark", words: ["dark mode"] },
        {
          value: "system",
          label: "Like this device",
          words: ["system", "auto", "automatic"],
        },
      ],
      get: (host) => host.appearance.theme,
      set: (host, value) =>
        host.appearance.setTheme(value as "light" | "dark" | "system"),
    },
  },
  {
    kind: "setting",
    id: "appearance.black-background",
    category: "appearance",
    title: "Black background",
    description: "Pure black instead of blue-grey in the dark theme",
    words: ["oled", "amoled", "true black"],
    icon: <Moon size={15} />,
    scope: "browser",
    control: {
      type: "toggle",
      get: (host) => host.appearance.blackBackground,
      set: (host, on) => host.appearance.setBlackBackground(on),
    },
  },
  {
    kind: "setting",
    id: "appearance.accent",
    category: "appearance",
    title: "Accent colour",
    description: "The colour of selections and buttons",
    words: ["accent color", "highlight", "tint"],
    icon: <Palette size={15} />,
    scope: "browser",
    control: {
      type: "choice",
      options: ACCENT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      get: (host) => host.appearance.accentColor,
      set: (host, value) => host.appearance.setAccentColor(value),
    },
  },
  {
    kind: "setting",
    id: "appearance.interface-scale",
    category: "appearance",
    title: "Interface size",
    description: "Scales menus, panels and dialogs",
    words: ["interface scale", "zoom", "ui size", "font size", "text size"],
    icon: <ALargeSmall size={15} />,
    scope: "browser",
    control: {
      type: "stepper",
      min: UI_SCALE_MIN,
      max: UI_SCALE_MAX,
      step: UI_SCALE_STEP,
      format: percent,
      get: (host) => host.appearance.uiScale,
      set: (host, value) => host.appearance.setUiScale(clampUiScale(value)),
      reset: {
        label: "Reset",
        run: (host) => host.appearance.setUiScale(UI_SCALE_DEFAULT),
      },
    },
  },
  {
    kind: "setting",
    id: "appearance.terminal-font-size",
    category: "appearance",
    title: "Terminal font size",
    description: "Text in terminals; Chat follows it unless set below",
    words: ["font size", "text size", "terminal text", "bigger", "smaller"],
    icon: <Type size={15} />,
    scope: "browser",
    control: {
      type: "stepper",
      min: TERMINAL_FONT_SCALE_MIN,
      max: TERMINAL_FONT_SCALE_MAX,
      step: TERMINAL_FONT_SCALE_STEP,
      format: percent,
      get: (host) => host.appearance.terminalFontScale,
      set: (host, value) =>
        host.appearance.setTerminalFontScale(clampTerminalFontScale(value)),
      reset: {
        label: "Reset",
        run: (host) =>
          host.appearance.setTerminalFontScale(TERMINAL_FONT_SCALE_DEFAULT),
      },
    },
  },
  {
    kind: "setting",
    id: "appearance.chat-text",
    category: "appearance",
    title: "Chat text size",
    description: "Follows the terminal font size until you change it",
    words: ["font size", "text size", "chat font", "message size"],
    icon: <MessageSquareText size={15} />,
    scope: "browser",
    subscribe: subscribeChatTextScale,
    control: {
      type: "stepper",
      min: TERMINAL_FONT_SCALE_MIN,
      max: TERMINAL_FONT_SCALE_MAX,
      step: TERMINAL_FONT_SCALE_STEP,
      format: (value) =>
        getChatTextScale() === null ? `Terminal · ${value}%` : `${value}%`,
      get: (host) => getChatTextScale() ?? host.appearance.terminalFontScale,
      set: (_host, value) => setChatTextScale(clampTerminalFontScale(value)),
      reset: {
        label: "Follow the terminal",
        run: () => setChatTextScale(null),
      },
    },
  },
  {
    kind: "panel",
    id: "appearance.terminal-look",
    category: "appearance",
    title: "Terminal colours and font",
    description: "Colour themes, your own themes and the font family",
    words: ["terminal theme", "font family", "typeface", "colors"],
    icon: <SquareTerminal size={15} />,
    scope: "browser",
    open: (host) => host.openPanel("terminal-look"),
  },
  {
    kind: "panel",
    id: "appearance.layout",
    category: "appearance",
    title: "Layout",
    description: "Phone or desktop layout, the phone breakpoint, sidebar order",
    words: ["mobile layout", "breakpoint", "sidebar", "display mode"],
    icon: <LayoutDashboard size={15} />,
    scope: "browser",
    open: (host) => host.openPanel("layout"),
  },
]);
