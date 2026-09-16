const ADJECTIVES = [
  "bright",
  "calm",
  "clear",
  "clever",
  "fresh",
  "gentle",
  "happy",
  "lucky",
  "neat",
  "quick",
  "solid",
  "steady",
  "swift",
  "tidy",
  "vivid",
  "warm",
  "bold",
  "brisk",
  "crisp",
  "daring",
  "eager",
  "fair",
  "fast",
  "fine",
  "glad",
  "golden",
  "grand",
  "keen",
  "kind",
  "light",
  "merry",
  "nimble",
  "plain",
  "proud",
  "rapid",
  "ready",
  "sharp",
  "smooth",
  "sunny",
  "wise",
] as const;

const NOUNS = [
  "branch",
  "brook",
  "cloud",
  "comet",
  "field",
  "harbor",
  "lantern",
  "meadow",
  "orbit",
  "path",
  "river",
  "spark",
  "stone",
  "trail",
  "wave",
  "wind",
  "anchor",
  "beacon",
  "bridge",
  "canyon",
  "delta",
  "garden",
  "grove",
  "island",
  "maple",
  "motion",
  "peak",
  "pixel",
  "ridge",
  "signal",
  "summit",
  "token",
  "valley",
  "voyage",
  "willow",
  "zenith",
] as const;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function luckyWorktreeBranchName() {
  return luckyName();
}

export function luckyWorkspaceName() {
  return luckyName();
}

function luckyName() {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}
