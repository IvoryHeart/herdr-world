import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

/**
 * Town's overlays share one style (townOverlay.css), readable in both World
 * themes, and amber is reserved for what needs you. These tests read the
 * stylesheets themselves, so a rule that drifts back fails here.
 */

const TOWN_DIR = new URL("./", import.meta.url);

const readCss = (name: string) =>
  Bun.file(new URL(name, TOWN_DIR))
    .text()
    .then((css) => css.replace(/\/\*[\s\S]*?\*\//g, ""));

type Rule = { file: string; selectors: string[]; body: string };

/** Flat rules, including those nested one level in @media blocks. */
function rules(file: string, css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    file,
    selectors: match[1]!
      .trim()
      .split(",")
      .map((selector) => selector.trim().replace(/\s+/g, " "))
      .filter(Boolean),
    body: match[2]!,
  }));
}

async function townRules() {
  const files = readdirSync(TOWN_DIR).filter((name) => name.endsWith(".css"));
  const all = await Promise.all(
    files.map(async (file) => rules(file, await readCss(file))),
  );
  return all.flat();
}

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [0, 2, 4]
      .map((at) => parseInt(hex.slice(at, at + 2), 16))
      .concat(1) as Rgba;
  }
  const rgba = value.match(
    /^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/,
  );
  if (!rgba) throw new Error(`unparsed colour ${value}`);
  return rgba.slice(1).map(Number) as Rgba;
}

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];

const luminance = ([r, g, b]: Rgba) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

async function tokens() {
  const css = await readCss("townOverlay.css");
  const block = rules("townOverlay.css", css).find((rule) =>
    rule.body.includes("--town-glass:"),
  )!;
  const token = (name: string) =>
    block.body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
  return { block, token };
}

// The town under an overlay can be anything from a white roof to the night.
const BACKDROPS: Record<string, Rgba> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
};

test("overlay text keeps WCAG AA on the glass over any town, in both themes", async () => {
  const { block, token } = await tokens();
  // One set of tokens for every theme: nothing reads World's theme colours.
  expect(block.body).not.toMatch(/var\(--(?!town-)/);
  const glass = parseColor(token("town-glass"));
  const fill = parseColor(token("town-glass-fill-hover"));
  const text = parseColor(token("town-glass-text"));
  const muted = parseColor(token("town-glass-muted"));
  const attention = parseColor(token("town-attention"));
  const ink = parseColor(token("town-attention-ink"));
  expect(glass[3]).toBeLessThan(1);
  for (const backdrop of Object.values(BACKDROPS)) {
    // The panel, and the brightest inset on it (a hovered button).
    for (const surface of [
      over(glass, backdrop),
      over(fill, over(glass, backdrop)),
    ]) {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(attention, surface)).toBeGreaterThanOrEqual(4.5);
      // The focus ring is a non-text mark: 3:1.
      expect(
        contrast(parseColor(token("town-glass-focus")), surface),
      ).toBeGreaterThanOrEqual(3);
    }
  }
  // The answer button: dark ink on the attention colour.
  expect(contrast(ink, attention)).toBeGreaterThanOrEqual(4.5);
});

/** The Town board, zoom controls, peek, toasts and hover cards. */
const SURFACES = [
  ".town-board",
  ".town-board-chip",
  ".town-recap-chip",
  ".town-zoom",
  ".town-peek",
  ".town-toast",
  ".town-place-card",
  ".town-fuel-details",
];

const SURFACE_PROPERTIES =
  /(?:^|;)\s*(background(?:-color)?|border(?:-color|-width|-style)?|border-radius|box-shadow|backdrop-filter|font-family)\s*:/;

test("one rule gives every overlay its surface, border, radius, shadow and type", async () => {
  const all = await townRules();
  const shared = all.filter(
    (rule) =>
      rule.file === "townOverlay.css" &&
      rule.body.includes("background: var(--town-glass)"),
  );
  expect(shared).toHaveLength(1);
  expect([...shared[0]!.selectors].sort()).toEqual([...SURFACES].sort());
  for (const property of [
    "border: 1px solid var(--town-glass-line)",
    "border-radius: var(--town-glass-radius)",
    "box-shadow: var(--town-glass-shadow)",
    "font-family:",
  ]) {
    expect(shared[0]!.body).toContain(property);
  }
  // No other rule re-skins a surface itself (a state's border colour aside).
  const overrides = all
    .filter((rule) => rule !== shared[0])
    .filter((rule) => rule.selectors.some((s) => SURFACES.includes(s)))
    .filter((rule) => SURFACE_PROPERTIES.test(rule.body))
    .map((rule) => `${rule.file}: ${rule.selectors.join(", ")}`);
  expect(overrides).toEqual([]);
});

test("no overlay blurs the animated Town behind it", async () => {
  // A backdrop filter over the canvas is recomputed on every Town frame.
  const blurred = (await townRules())
    .filter((rule) => /backdrop-filter\s*:/.test(rule.body))
    .map((rule) => `${rule.file}: ${rule.selectors.join(", ")}`);
  expect(blurred).toEqual([]);
});

/** Whether a colour reads as amber or gold: warm hue, saturated, not dark. */
function amberLike(hex: string) {
  const [r, g, b] = parseColor(hex).map((value) => value / 255) as Rgba;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return false;
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return hue >= 30 && hue <= 55 && saturation >= 0.45 && lightness >= 0.3;
}

/** Rules that draw inside the overlays. */
const OVERLAY_SELECTOR =
  /\.town-(board|zoom|peek|toast|place-card|place-summary|fuel(?!-mark)|recap|answers|lens-legend|lens-choices|lens-name|pill)/;

/** What needs you: waiting, a question, low or used-up fuel. */
const ATTENTION_SELECTOR =
  /blocked|attention|answers-question|data-low="true"|fuel-reached/;

test("amber in an overlay marks only what needs you", async () => {
  const all = await townRules();
  const amberRules = all.filter((rule) => {
    const hexes = rule.body.match(/#[0-9a-f]{6}\b/gi) ?? [];
    return (
      hexes.some(amberLike) ||
      /var\(--town-(wait|accent|attention)\b/.test(rule.body)
    );
  });
  const misplaced = amberRules
    .filter((rule) => rule.selectors.some((s) => OVERLAY_SELECTOR.test(s)))
    .filter((rule) => !rule.selectors.every((s) => ATTENTION_SELECTOR.test(s)))
    .map((rule) => `${rule.file}: ${rule.selectors.join(", ")}`);
  expect(misplaced).toEqual([]);
  // The detector itself: Town's old board gold and focus yellow are amber.
  expect(["#e7c48a", "#ffd166", "#ffb547", "#e3aa3a"].every(amberLike)).toBe(
    true,
  );
  expect(["#f1efe6", "#b6bec9", "#7be08f", "#6fc3ff"].some(amberLike)).toBe(
    false,
  );
});
