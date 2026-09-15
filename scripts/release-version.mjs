import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MIN_HERDR_VERSION, TERMINAL_PROTOCOL } from "./herdr-world-plugin.mjs";

export const RELEASE_REFERENCE_PATHS = [
  "README.md",
  "site/index.html",
  "site/site.js",
  "release.json",
];
export const OPTIONAL_RELEASE_REFERENCE_PATHS = ["herdr-plugin.toml"];

const RELEASE_TAG_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;
const README_COMPATIBILITY_PATTERN =
  /requires Herdr `v([^`]+)` or newer\s+with terminal protocol `(\d+)`/g;
const SITE_HERDR_PATTERN = /<dt>Herdr<\/dt><dd>v([^<]+)\+<\/dd>/g;
const SITE_PROTOCOL_PATTERN = /<dt>Protocol<\/dt><dd>(\d+)<\/dd>/g;
const SITE_MANAGED_HERDR_PATTERN = /Herdr-managed \/ Herdr ([0-9]+\.[0-9]+\.[0-9]+)\+/g;

function exactlyOneMatch(contents, pattern, label) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one public Herdr compatibility claim`);
  }
  return matches[0];
}

function publicCompatibility(contents, relativePath) {
  if (relativePath === "README.md") {
    const match = exactlyOneMatch(contents, README_COMPATIBILITY_PATTERN, relativePath);
    return { herdr: [match[1]], protocol: [Number(match[2])] };
  }
  if (relativePath === "site/index.html") {
    const herdr = exactlyOneMatch(contents, SITE_HERDR_PATTERN, relativePath);
    const protocol = exactlyOneMatch(contents, SITE_PROTOCOL_PATTERN, relativePath);
    const managedHerdr = exactlyOneMatch(contents, SITE_MANAGED_HERDR_PATTERN, relativePath);
    return { herdr: [herdr[1], managedHerdr[1]], protocol: [Number(protocol[1])] };
  }
  throw new Error(`unsupported public compatibility surface: ${relativePath}`);
}

export function stampPublicReleaseCompatibility(contents, relativePath) {
  publicCompatibility(contents, relativePath);
  if (relativePath === "README.md") {
    return contents.replace(
      README_COMPATIBILITY_PATTERN,
      `requires Herdr \`v${MIN_HERDR_VERSION}\` or newer\nwith terminal protocol \`${TERMINAL_PROTOCOL}\``,
    );
  }
  return contents
    .replace(SITE_HERDR_PATTERN, `<dt>Herdr</dt><dd>v${MIN_HERDR_VERSION}+</dd>`)
    .replace(SITE_PROTOCOL_PATTERN, `<dt>Protocol</dt><dd>${TERMINAL_PROTOCOL}</dd>`)
    .replace(SITE_MANAGED_HERDR_PATTERN, `Herdr-managed / Herdr ${MIN_HERDR_VERSION}+`);
}

export function assertPublicReleaseCompatibility({ readme, site }) {
  for (const [relativePath, contents] of [["README.md", readme], ["site/index.html", site]]) {
    const actual = publicCompatibility(contents, relativePath);
    const invalidHerdr = actual.herdr.find((version) => version !== MIN_HERDR_VERSION);
    const invalidProtocol = actual.protocol.find((protocol) => protocol !== TERMINAL_PROTOCOL);
    if (invalidHerdr !== undefined && invalidProtocol !== undefined) {
      throw new Error(
        `${relativePath} advertises Herdr v${invalidHerdr} with terminal protocol ${invalidProtocol}; ` +
        `expected Herdr v${MIN_HERDR_VERSION} with terminal protocol ${TERMINAL_PROTOCOL}`,
      );
    }
    if (invalidHerdr !== undefined) {
      throw new Error(
        `${relativePath} advertises Herdr v${invalidHerdr}; expected Herdr v${MIN_HERDR_VERSION}`,
      );
    }
    if (invalidProtocol !== undefined) {
      throw new Error(
        `${relativePath} advertises terminal protocol ${invalidProtocol}; expected ${TERMINAL_PROTOCOL}`,
      );
    }
  }
  return true;
}

export function assertCurrentReleaseCompatibility(root = process.cwd()) {
  return assertPublicReleaseCompatibility({
    readme: readFileSync(join(root, "README.md"), "utf8"),
    site: readFileSync(join(root, "site/index.html"), "utf8"),
  });
}

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

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isReleaseCommitSubject(subject, tag) {
  const expected = `Release ${normalizeReleaseTag(tag)}`;
  return new RegExp(`^${escapeRegex(expected)} \\(#\\d+\\)$`).test(subject);
}

export function releaseVersion(value) {
  return parseReleaseTag(value).tag.slice(1);
}

export function npmDistributionTag(value) {
  return parseReleaseTag(value).rc === null ? "latest" : "next";
}

export function homebrewFormulaName(value) {
  return parseReleaseTag(value).rc === null ? "herdr-world" : "herdr-world-rc";
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

function readAndroidReleaseMetadata(buildFile) {
  const codePattern = /^([ \t]*versionCode[ \t]+)([1-9]\d*)([ \t]*)$/gm;
  const namePattern = /^([ \t]*versionName[ \t]+)"([^"\r\n]*)"([ \t]*)$/gm;
  const codes = [...buildFile.matchAll(codePattern)];
  const names = [...buildFile.matchAll(namePattern)];
  if (codes.length !== 1 || names.length !== 1) {
    throw new Error(
      "android/app/build.gradle must contain exactly one literal versionCode and versionName",
    );
  }

  return {
    code: Number(codes[0][2]),
    name: names[0][2],
    codePattern,
    namePattern,
  };
}

export function assertAndroidReleaseMetadata(buildFile, releaseTag) {
  const metadata = readAndroidReleaseMetadata(buildFile);
  const version = releaseVersion(releaseTag);
  if (metadata.code > 2_100_000_000) {
    throw new Error("Android versionCode exceeds 2100000000");
  }
  if (metadata.name !== version) {
    throw new Error(`Android versionName is ${metadata.name}, not ${version}`);
  }
  return true;
}

export function prepareAndroidReleaseMetadata(buildFile, releaseTag) {
  const version = releaseVersion(releaseTag);
  const metadata = readAndroidReleaseMetadata(buildFile);

  const nextCode = metadata.code + 1;
  if (!Number.isSafeInteger(nextCode) || nextCode > 2_100_000_000) {
    throw new Error("Android versionCode increment would exceed 2100000000");
  }

  return buildFile
    .replace(metadata.codePattern, (_match, prefix, _code, suffix) => `${prefix}${nextCode}${suffix}`)
    .replace(metadata.namePattern, (_match, prefix, _name, suffix) => `${prefix}"${version}"${suffix}`);
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
    const expected = relativePath === "herdr-plugin.toml" ? releaseVersion(current) : current;
    if (!contents.includes(expected)) {
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
    const oldReference = relativePath === "herdr-plugin.toml" ? releaseVersion(current) : current;
    const newReference = relativePath === "herdr-plugin.toml" ? releaseVersion(newTag) : newTag;
    let updated = contents.replaceAll(oldReference, newReference);
    if (["README.md", "site/index.html", "site/site.js"].includes(relativePath)) {
      updated = updated
        .replaceAll(`@${npmDistributionTag(current)}`, `@${npmDistributionTag(newTag)}`)
        .replaceAll(
          `@${releaseVersion(current)}`,
          `@${releaseVersion(newTag)}`,
        )
        .replaceAll(
          `tap/${homebrewFormulaName(current)}`,
          `tap/${homebrewFormulaName(newTag)}`,
        )
        .replaceAll(
          `upgrade ${homebrewFormulaName(current)}`,
          `upgrade ${homebrewFormulaName(newTag)}`,
        )
        .replaceAll(
          `uninstall ${homebrewFormulaName(current)}`,
          `uninstall ${homebrewFormulaName(newTag)}`,
        );
    }
    if (["README.md", "site/index.html"].includes(relativePath)) {
      updated = stampPublicReleaseCompatibility(updated, relativePath);
    }
    if (updated === contents || updated.includes(oldReference)) {
      throw new Error(`could not replace every ${oldReference} reference in ${relativePath}`);
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
  assertCurrentReleaseCompatibility(root);
  return releaseReferencePaths(root);
}
