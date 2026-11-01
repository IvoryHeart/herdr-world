/** Exact RGBA comparison. No thresholds, masks or anti-aliasing exemptions. */
export function comparePixels(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (
    expected.length !== width * height * 4 ||
    actual.length !== expected.length
  )
    throw new Error("Image dimensions differ");
  let changed = 0;
  const diff = new Uint8ClampedArray(expected.length);
  for (let i = 0; i < expected.length; i += 4) {
    const different =
      expected[i] !== actual[i] ||
      expected[i + 1] !== actual[i + 1] ||
      expected[i + 2] !== actual[i + 2] ||
      expected[i + 3] !== actual[i + 3];
    if (different) changed++;
    diff[i] = different ? 255 : actual[i]! / 4;
    diff[i + 1] = different ? 0 : actual[i + 1]! / 4;
    diff[i + 2] = different ? 255 : actual[i + 2]! / 4;
    diff[i + 3] = 255;
  }
  return { changed, diff };
}
