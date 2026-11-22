/**
 * Precompressed web assets: the build writes `<file>.br` and `<file>.gz`
 * beside each compressible, content-hashed file under `/assets/`, and the
 * service serves the variant a browser accepts. Only static build output is
 * compressed, never a response that carries secrets or user data.
 */

/** URL prefix of Vite's content-hashed build output. */
export const HASHED_ASSET_PREFIX = "/assets/";

/** Preferred first: brotli is smaller, gzip is universal. */
export const PRECOMPRESSED_ENCODINGS = [
  { coding: "br", suffix: ".br" },
  { coding: "gzip", suffix: ".gz" },
] as const;

export type PrecompressedCoding =
  (typeof PRECOMPRESSED_ENCODINGS)[number]["coding"];

// Fonts (woff2) and pictures are already compressed.
const COMPRESSIBLE = /\.(?:m?js|css|json|map|svg|wasm|html|txt)$/;

export function isPrecompressible(name: string): boolean {
  return COMPRESSIBLE.test(name);
}

/**
 * The precompressed codings an `Accept-Encoding` header accepts, most
 * preferred first. A coding with q=0 is refused, an unlisted one follows
 * `*`, and a missing header accepts none (RFC 9110, section 12.5.3).
 */
export function acceptedPrecompressedCodings(
  header: string | null,
): PrecompressedCoding[] {
  if (!header) return [];
  const weights = new Map<string, number>();
  for (const part of header.split(",")) {
    const [rawCoding = "", ...params] = part.split(";");
    const coding = rawCoding.trim().toLowerCase();
    if (!coding) continue;
    let weight = 1;
    for (const param of params) {
      const [key = "", value = ""] = param.split("=");
      if (key.trim().toLowerCase() !== "q") continue;
      const parsed = Number(value.trim());
      weight = Number.isFinite(parsed) ? parsed : 0;
    }
    weights.set(coding, weight);
  }
  const wildcard = weights.get("*");
  const weight = (coding: string) => weights.get(coding) ?? wildcard ?? 0;
  // A higher q wins; equal weights keep World's order (stable sort).
  return PRECOMPRESSED_ENCODINGS.map(({ coding }) => coding)
    .filter((coding) => weight(coding) > 0)
    .sort((a, b) => weight(b) - weight(a));
}
