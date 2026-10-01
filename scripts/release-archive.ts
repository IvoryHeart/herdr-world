import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_VERSION_RE } from "./release-version";

export function readReleaseArchive(
  distDir: string,
  version: string,
  platform: string,
) {
  if (!RELEASE_VERSION_RE.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }
  const name = `herdr-world-v${version}-${platform}.tar.xz`;
  const archive = join(distDir, name);
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  const checksum = readFileSync(`${archive}.sha256`, "utf8").trim();
  if (checksum !== `${digest}  ${name}`) {
    throw new Error(`release archive checksum mismatch: ${name}`);
  }
  return { archive, digest, name };
}
