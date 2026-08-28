import { compareReleaseTags, normalizeReleaseTag, releaseVersion } from "./release-version.mjs";

export const NPM_PACKAGE_NAME = "@ivoryheart/herdr-world";
export const HOMEBREW_TAP_REPOSITORY = "IvoryHeart/homebrew-tap";

export function channelForRelease(tag) {
  return normalizeReleaseTag(tag).includes("-rc.") ? "next" : "latest";
}

export function versionForRelease(tag) {
  return releaseVersion(tag);
}

/**
 * Decide what a publisher may do after reading its target channel while the
 * release mutex is held. The caller supplies the exact-version record and the
 * current moving pointer separately because registries expose those values
 * through different APIs.
 */
export function assessPublication({
  candidate,
  currentVersion = null,
  exactVersionExists = false,
  exactDigestMatches = false,
  pointerVersion = null,
}) {
  const normalizedCandidate = normalizeReleaseTag(candidate);
  const normalizedCurrent = currentVersion ? normalizeReleaseTag(currentVersion) : null;
  const normalizedPointer = pointerVersion ? normalizeReleaseTag(pointerVersion) : null;

  if (normalizedCurrent && compareReleaseTags(normalizedCandidate, normalizedCurrent) < 0) {
    return {
      action: "fail",
      reason: `candidate ${normalizedCandidate} is lower than target-channel version ${normalizedCurrent}`,
    };
  }

  if (normalizedPointer && compareReleaseTags(normalizedCandidate, normalizedPointer) < 0) {
    return {
      action: "fail",
      reason: `candidate ${normalizedCandidate} would regress target pointer ${normalizedPointer}`,
    };
  }

  if (!exactVersionExists) {
    if (normalizedCurrent && compareReleaseTags(normalizedCandidate, normalizedCurrent) <= 0) {
      return {
        action: "fail",
        reason: `version ${normalizedCandidate} is unavailable for a new publication because the target channel already reached ${normalizedCurrent}`,
      };
    }
    return { action: "publish", version: normalizedCandidate };
  }

  if (!exactDigestMatches) {
    return {
      action: "fail",
      reason: `version ${normalizedCandidate} already exists with different content`,
    };
  }

  if (normalizedPointer && compareReleaseTags(normalizedCandidate, normalizedPointer) === 0) {
    return { action: "complete", version: normalizedCandidate };
  }

  return { action: "update-pointer", version: normalizedCandidate };
}
