import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function inventory(directory, prefix = "") {
  return readdirSync(join(directory, prefix))
    .sort()
    .flatMap((name) => {
      const path = prefix ? `${prefix}/${name}` : name;
      if (path === "manifest.json") return [];
      const stat = lstatSync(join(directory, path));
      if (stat.isDirectory()) return inventory(directory, path);
      if (!stat.isFile())
        throw new Error(`Not a regular release file: ${path}`);
      return [
        [
          path,
          createHash("sha256")
            .update(readFileSync(join(directory, path)))
            .digest("hex"),
        ],
      ];
    });
}

export function sealBundle(directory, version, commit) {
  const manifest = {
    schema: 1,
    version,
    commit,
    files: Object.fromEntries(inventory(directory)),
  };
  if (!Object.keys(manifest.files).length)
    throw new Error("Empty release bundle");
  writeFileSync(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyBundle(directory, version, commit) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.schema !== 1 ||
    manifest.version !== version ||
    manifest.commit !== commit
  ) {
    throw new Error("Release bundle version or source commit differs");
  }
  const actual = Object.fromEntries(inventory(directory));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error(
      "Release bundle files or SHA-256 digests differ from verification",
    );
  }
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [mode, directory, version, commit] = process.argv.slice(2);
  if (!directory || !version || !commit || !["seal", "verify"].includes(mode)) {
    throw new Error(
      "usage: node scripts/release-bundle.mjs seal|verify DIRECTORY VERSION COMMIT",
    );
  }
  const manifest =
    mode === "seal"
      ? sealBundle(directory, version, commit)
      : verifyBundle(directory, version, commit);
  console.log(
    `${mode}: ${Object.keys(manifest.files).length} release files for ${version} (${commit})`,
  );
}
