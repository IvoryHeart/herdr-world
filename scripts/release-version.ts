export const RELEASE_VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

export function isReleaseCandidate(version: string) {
  const match = RELEASE_VERSION_RE.exec(version);
  if (!match) throw new Error(`invalid release version: ${version}`);
  return match[4] !== undefined;
}
