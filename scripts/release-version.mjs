import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASE_REFERENCE_PATHS = [
  "README.md",
  "site/index.html",
  "site/site.js",
  "release.json",
];

const VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readCurrentReleaseTag(root = process.cwd()) {
  const metadataPath = join(root, "release.json");
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`could not read release.json: ${error.message}`);
  }

  if (typeof metadata.current !== "string" || !VERSION_PATTERN.test(metadata.current)) {
    throw new Error("release.json current must be a v-prefixed SemVer release tag");
  }
  return metadata.current;
}

export function assertCurrentReleaseReferences(root = process.cwd()) {
  const current = readCurrentReleaseTag(root);
  for (const relativePath of RELEASE_REFERENCE_PATHS.slice(0, -1)) {
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
  { allowSameTag = false } = {},
) {
  if (!VERSION_PATTERN.test(newTag)) {
    throw new Error(`invalid release tag: ${newTag}`);
  }

  const current = assertCurrentReleaseReferences(root);
  if (current === newTag) {
    if (!allowSameTag) {
      throw new Error(`release references already point to ${newTag}`);
    }
    return [];
  }

  const updates = RELEASE_REFERENCE_PATHS.slice(0, -1).map((relativePath) => {
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
  return [...RELEASE_REFERENCE_PATHS];
}
