export type TownCanvasCase = [
  width: number,
  height: number,
  scale: string,
  flightFrameDelay: number,
];

// The original 22 parameter tuples, partitioned without changing fixture behavior.
export const townCanvasCases = {
  baseline: [
    [1440, 900, "typical", 0],
    [390, 900, "typical", 0],
    [390, 844, "recovery", 0],
    [1440, 900, "recovery", 0],
    [1440, 900, "max", 0],
  ],
  extended: [
    [390, 844, "extended", 0],
    [960, 1080, "extended", 0],
    [1440, 900, "extended", 0],
  ],
  portrait: [
    [1080, 1920, "extended", 0],
    [1080, 1920, "extended", 300],
  ],
  fold: [
    [390, 844, "fold", 0],
    [960, 1080, "fold", 0],
    [1440, 900, "fold", 0],
    [1080, 1920, "fold", 0],
    [2560, 1440, "fold", 0],
    [390, 844, "fold-protected", 0],
  ],
  navigation: [
    [390, 844, "incremental", 0],
    [1440, 900, "plates", 0],
    [390, 844, "plates", 0],
    [390, 844, "protected", 0],
    [390, 844, "navigation", 0],
    [1440, 900, "navigation", 0],
  ],
} satisfies Record<string, TownCanvasCase[]>;
