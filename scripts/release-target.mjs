export const RELEASE_REMOTE = "origin";
export const RELEASE_REPOSITORY = "IvoryHeart/herdr-world";

const GITHUB_REMOTE_PREFIXES = [
  "git@github.com:",
  "ssh://git@github.com/",
  "https://github.com/",
];

export function githubRepositoryFromRemoteUrl(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const lowercase = normalized.toLowerCase();
  const prefix = GITHUB_REMOTE_PREFIXES.find((candidate) =>
    lowercase.startsWith(candidate),
  );
  if (!prefix) {
    return null;
  }

  const repository = normalized.slice(prefix.length);
  return repository.split("/").length === 2 ? repository : null;
}

export function assertReleaseRemoteUrls(remoteUrls, direction) {
  if (remoteUrls.length === 0) {
    throw new Error(`${RELEASE_REMOTE} has no ${direction} URL`);
  }

  for (const remoteUrl of remoteUrls) {
    const repository = githubRepositoryFromRemoteUrl(remoteUrl);
    if (repository?.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase()) {
      const resolved = repository ?? "an unsupported or non-GitHub remote";
      throw new Error(
        `${RELEASE_REMOTE} ${direction} must resolve to ${RELEASE_REPOSITORY}; resolved ${resolved}`,
      );
    }
  }
}

export function withReleaseRepository(args) {
  return [...args, "--repo", RELEASE_REPOSITORY];
}

export function releaseCreateArgs(tag, notesFile) {
  const args = ["release", "create", tag, "--verify-tag", "--notes-file", notesFile];
  if (tag.includes("-")) {
    args.push("--prerelease");
  }
  return withReleaseRepository(args);
}
