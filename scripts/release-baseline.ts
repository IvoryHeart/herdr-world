import { RELEASE_VERSION_RE } from "./release-version";

/** Stable baselines must precede the candidate, including expired-seal retries. */
export function stableBefore(tag: string, version: string): boolean {
  const baseline = RELEASE_VERSION_RE.exec(tag.replace(/^v/, ""));
  const candidate = RELEASE_VERSION_RE.exec(version);
  if (!baseline || !candidate || baseline[4]) return false;
  for (let index = 1; index <= 3; index++) {
    const left = BigInt(baseline[index]!),
      right = BigInt(candidate[index]!);
    if (left !== right) return left < right;
  }
  return false;
}
