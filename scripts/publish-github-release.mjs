import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyBundle } from "./release-bundle.mjs";

const [version, directory, commit] = process.argv.slice(2);
const manifest = verifyBundle(directory, version, commit);
const tag = `v${version}`;
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const lookup = spawnSync(
  "gh",
  ["release", "view", tag, "--json", "isDraft,assets"],
  { encoding: "utf8" },
);
if (lookup.error) throw lookup.error;
let release;
if (lookup.status === 0) release = JSON.parse(lookup.stdout);
else {
  // Only an explicit absence may create a release; permission/network errors fail closed.
  if (!/release not found|HTTP 404/i.test(lookup.stderr))
    throw new Error(lookup.stderr);
  gh(
    "release",
    "create",
    tag,
    "--draft",
    "--verify-tag",
    "--title",
    `Herdr World ${tag}`,
    "--notes-file",
    join(directory, "notes.md"),
    ...(version.includes("-rc.") ? ["--prerelease"] : []),
  );
  release = { isDraft: true, assets: [] };
}
const expected = readdirSync(join(directory, "github")).sort();
const existing = release.assets.map((asset) => asset.name);
if (existing.some((name) => !expected.includes(name)))
  throw new Error("GitHub release has unexpected assets");
const temporary = mkdtempSync(join(tmpdir(), "world-release-"));
try {
  const checkDownloaded = () => {
    for (const name of readdirSync(temporary)) rmSync(join(temporary, name));
    gh("release", "download", tag, "--dir", temporary);
    // Verify downloaded bytes against the sealed manifest, including installer and aliases.
    const names = readdirSync(temporary).sort();
    for (const name of names) {
      const digest = createHash("sha256")
        .update(readFileSync(join(temporary, name)))
        .digest("hex");
      if (digest !== manifest.files[`github/${name}`])
        throw new Error(`Published GitHub asset differs: ${name}`);
    }
    return names;
  };
  // Never clobber an existing asset, even on a partial retry.
  if (existing.length) checkDownloaded();
  const missing = expected.filter((name) => !existing.includes(name));
  if (!release.isDraft && missing.length)
    throw new Error(
      "Public GitHub release is incomplete; refusing to mutate it",
    );
  if (missing.length)
    gh(
      "release",
      "upload",
      tag,
      ...missing.map((name) => join(directory, "github", name)),
    );
  if (JSON.stringify(checkDownloaded()) !== JSON.stringify(expected))
    throw new Error("GitHub asset set is incomplete");
  if (release.isDraft)
    gh(
      "release",
      "edit",
      tag,
      "--draft=false",
      ...(version.includes("-rc.") ? ["--prerelease"] : ["--latest"]),
    );
  console.log(
    `GitHub: public; all ${expected.length} asset digests match verification`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
