import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASE_REFERENCE_PATHS = [
  "README.md",
  "site/index.html",
  "site/site.js",
  "release.json",
];
export const OPTIONAL_RELEASE_REFERENCE_PATHS = ["herdr-plugin.toml"];

const RELEASE_TAG_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

export function parseReleaseTag(value) {
  if (typeof value !== "string") {
    throw new Error(`invalid release tag: ${value}`);
  }

  const match = value.match(RELEASE_TAG_PATTERN);
  if (!match) {
    throw new Error(
      `invalid release tag: ${value}; expected vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N`,
    );
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4]),
    tag: `v${match[1]}.${match[2]}.${match[3]}${match[4] ? `-rc.${match[4]}` : ""}`,
  };
}

export function normalizeReleaseTag(value) {
  return parseReleaseTag(value).tag;
}

export function releaseVersion(value) {
  return parseReleaseTag(value).tag.slice(1);
}

export function compareReleaseTags(left, right) {
  const a = parseReleaseTag(left);
  const b = parseReleaseTag(right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) {
      return a[key] > b[key] ? 1 : -1;
    }
  }
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1;
  if (b.rc === null) return -1;
  return a.rc > b.rc ? 1 : -1;
}

export function releaseReferencePaths(root = process.cwd()) {
  return [
    ...RELEASE_REFERENCE_PATHS,
    ...OPTIONAL_RELEASE_REFERENCE_PATHS.filter((relativePath) =>
      existsSync(join(root, relativePath)),
    ),
  ];
}

export function readCurrentReleaseTag(root = process.cwd()) {
  const metadataPath = join(root, "release.json");
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`could not read release.json: ${error.message}`);
  }

  if (typeof metadata.current !== "string" || !metadata.current.startsWith("v")) {
    throw new Error("release.json current must be a v-prefixed release tag");
  }
  return parseReleaseTag(metadata.current).tag;
}

export function assertCurrentReleaseReferences(root = process.cwd()) {
  const current = readCurrentReleaseTag(root);
  for (const relativePath of releaseReferencePaths(root).filter(
    (relativePath) => relativePath !== "release.json",
  )) {
    const contents = readFileSync(join(root, relativePath), "utf8");
    if (!contents.includes(current)) {
      throw new Error(`${relativePath} does not reference the current release ${current}`);
    }
  }
  return current;
}

export function stampCurrentRelease(
  newTag,
  root = process.cwd(),
) {
  newTag = normalizeReleaseTag(newTag);

  const current = assertCurrentReleaseReferences(root);
  if (current === newTag) {
    throw new Error(`release references already point to ${newTag}`);
  }

  const updates = releaseReferencePaths(root)
    .filter((relativePath) => relativePath !== "release.json")
    .map((relativePath) => {
    const path = join(root, relativePath);
    const contents = readFileSync(path, "utf8");
    const updated = contents.replaceAll(current, newTag);
    if (updated === contents || updated.includes(current)) {
      throw new Error(`could not replace every ${current} reference in ${relativePath}`);
    }
    return { path, updated };
    });

  for (const update of updates) {
    writeFileSync(update.path, update.updated);
  }
  writeFileSync(
    join(root, "release.json"),
    `${JSON.stringify({ current: newTag }, null, 2)}\n`,
  );

  assertCurrentReleaseReferences(root);
  return releaseReferencePaths(root);
}
