#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noticeOutputPath = join(root, "DEPENDENCY_NOTICES.md");
const licenseOutputPath = join(root, "DEPENDENCY_LICENSES.md");

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  author?: unknown;
};

type InstalledPackage = {
  id: string;
  name: string;
  version: string;
  license: string;
  author: string | null;
  directory: string;
};

const EMBEDDED_LICENSE_SECTIONS: Record<
  string,
  { file: string; heading: string }
> = {
  "lru_map@0.4.1": { file: "README.md", heading: "MIT license" },
};

function markdownSection(text: string, heading: string): string | null {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const expected = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return match?.[2]?.trim().toLowerCase() === expected;
  });
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)?.[0].length ?? 1;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextLevel = lines[index].match(/^(#{1,6})\s+/)?.[1].length;
    if (nextLevel !== undefined && nextLevel <= level) {
      end = index;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function licenseLabel(value: unknown, packageId: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.filter(
      (entry): entry is string => typeof entry === "string" && !!entry.trim(),
    );
    if (values.length) return values.join(" OR ");
  }
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string" &&
    value.type.trim()
  ) {
    return value.type.trim();
  }
  throw new Error(`${packageId} has no declared licence`);
}

function authorLabel(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const author = value as { name?: unknown; email?: unknown; url?: unknown };
  const name = typeof author.name === "string" ? author.name.trim() : "";
  const email = typeof author.email === "string" ? author.email.trim() : "";
  const url = typeof author.url === "string" ? author.url.trim() : "";
  const result = [name, email ? `<${email}>` : "", url ? `(${url})` : ""]
    .filter(Boolean)
    .join(" ");
  return result || null;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function canonicalPackageIdsFromLock(lockText: string): string[] {
  let parsed: { packages?: unknown };
  try {
    const value: unknown = Bun.JSONC.parse(lockText);
    if (!value || typeof value !== "object") {
      throw new Error("invalid root");
    }
    parsed = value;
  } catch {
    throw new Error("bun.lock is not valid JSONC");
  }
  const packages = parsed.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    throw new Error("bun.lock has no package inventory");
  }
  const packageIds = new Set<string>();
  for (const entry of Object.values(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const packageId = entry[0];
    const metadata =
      entry[2] && typeof entry[2] === "object"
        ? (entry[2] as { os?: unknown; cpu?: unknown })
        : {};
    if (
      packageId.includes("@workspace:") ||
      metadata.os !== undefined ||
      metadata.cpu !== undefined
    ) {
      continue;
    }
    packageIds.add(packageId);
  }
  return [...packageIds].sort((left, right) => left.localeCompare(right));
}

async function installedPackageMap(rootDirectory: string) {
  const packages = new Map<string, InstalledPackage>();
  const patterns = [
    "node_modules/.bun/*/node_modules/*/package.json",
    "node_modules/.bun/*/node_modules/@*/*/package.json",
  ];
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: rootDirectory,
      onlyFiles: true,
    })) {
      const manifestPath = join(rootDirectory, path);
      const manifest = (await Bun.file(manifestPath).json()) as PackageManifest;
      if (
        typeof manifest.name !== "string" ||
        typeof manifest.version !== "string"
      ) {
        continue;
      }
      const id = `${manifest.name}@${manifest.version}`;
      packages.set(id, {
        id,
        name: manifest.name,
        version: manifest.version,
        license: licenseLabel(manifest.license, `${id} (${path})`),
        author: authorLabel(manifest.author),
        directory: dirname(manifestPath),
      });
    }
  }
  return packages;
}

async function packageLicenseFiles(pkg: InstalledPackage) {
  const entries = await readdir(pkg.directory, { withFileTypes: true });
  const names = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(
          entry.name,
        ),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      text: (await Bun.file(join(pkg.directory, name)).text())
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd(),
    })),
  );
  const embedded = EMBEDDED_LICENSE_SECTIONS[pkg.id];
  if (!embedded) return files;
  const source = Bun.file(join(pkg.directory, embedded.file));
  if (!(await source.exists())) {
    throw new Error(`${pkg.id} is missing ${embedded.file}`);
  }
  const text = markdownSection(await source.text(), embedded.heading);
  if (!text) {
    throw new Error(
      `${pkg.id} is missing the ${embedded.heading} section in ${embedded.file}`,
    );
  }
  files.push({
    name: `${embedded.file}#${embedded.heading}`,
    text,
  });
  return files;
}

function renderNotices(packages: InstalledPackage[]): string {
  return [
    "# Resolved JavaScript dependency notices",
    "",
    "Generated by `bun run notices:generate` from every platform-independent package",
    "in the pinned `bun.lock`. OS/CPU-specific optional binaries are excluded so this",
    "committed inventory is identical on every supported build host. Package authors",
    "retain their own copyright and licence terms; full texts shipped by the packages",
    "are reproduced in `DEPENDENCY_LICENSES.md`.",
    "",
    "| Package | Version | Declared licence |",
    "| --- | --- | --- |",
    ...packages.map(
      ({ name, version, license }) =>
        `| ${escapeCell(name)} | ${escapeCell(version)} | ${escapeCell(license)} |`,
    ),
    "",
  ].join("\n");
}

async function renderLicenses(packages: InstalledPackage[]): Promise<string> {
  const groups = new Map<
    string,
    { text: string; sources: Array<{ id: string; name: string }> }
  >();
  const withoutText: InstalledPackage[] = [];
  for (const pkg of packages) {
    const files = await packageLicenseFiles(pkg);
    if (!files.length) withoutText.push(pkg);
    for (const file of files) {
      if (!file.text) continue;
      const digest = createHash("sha256").update(file.text).digest("hex");
      const group = groups.get(digest) ?? { text: file.text, sources: [] };
      group.sources.push({ id: pkg.id, name: file.name });
      groups.set(digest, group);
    }
  }

  const lines = [
    "# Resolved JavaScript dependency licence texts",
    "",
    "Generated by `bun run notices:generate` from the package payloads selected by",
    "the platform-independent `bun.lock` inventory. Identical texts are emitted once",
    "and list every package source to keep release archives complete without needless",
    "duplication.",
    "",
  ];
  if (withoutText.length) {
    lines.push(
      "## Packages without a separate licence-text file",
      "",
      "These package payloads declare the licence shown in `DEPENDENCY_NOTICES.md` but",
      "do not ship a root LICENSE, LICENCE, COPYING, NOTICE, or COPYRIGHT file.",
      "Manifest author metadata is retained here when provided.",
      "",
      ...withoutText.map(
        (pkg) => `- \`${pkg.id}\`${pkg.author ? ` — ${pkg.author}` : ""}`,
      ),
      "",
    );
  }
  lines.push("## Distributed texts", "");
  for (const [digest, group] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(
      `### ${digest.slice(0, 16)}`,
      "",
      "Sources:",
      "",
      ...group.sources
        .sort(
          (left, right) =>
            left.id.localeCompare(right.id) ||
            left.name.localeCompare(right.name),
        )
        .map((source) => `- \`${source.id}\` — \`${source.name}\``),
      "",
      ...group.text
        .split("\n")
        .map((line) => (line ? `    ${line.replaceAll("\t", "    ")}` : "")),
      "",
    );
  }
  return lines.join("\n");
}

export async function generateDependencyArtifacts(
  rootDirectory = root,
): Promise<{ notices: string; licenses: string }> {
  const expectedIds = canonicalPackageIdsFromLock(
    await Bun.file(join(rootDirectory, "bun.lock")).text(),
  );
  const installed = await installedPackageMap(rootDirectory);
  const missing = expectedIds.filter((id) => !installed.has(id));
  if (missing.length) {
    throw new Error(
      `installed packages do not match bun.lock; run bun install --frozen-lockfile (missing: ${missing.join(", ")})`,
    );
  }
  const packages = expectedIds.map((id) => installed.get(id)!);
  return {
    notices: renderNotices(packages),
    licenses: await renderLicenses(packages),
  };
}

async function main() {
  const generated = await generateDependencyArtifacts();
  if (process.argv.includes("--check")) {
    const currentNotices = await Bun.file(noticeOutputPath)
      .text()
      .catch(() => "");
    const currentLicenses = await Bun.file(licenseOutputPath)
      .text()
      .catch(() => "");
    if (
      currentNotices !== generated.notices ||
      currentLicenses !== generated.licenses
    ) {
      console.error(
        "dependency notices are stale; run bun run notices:generate and commit both generated files",
      );
      process.exit(1);
    }
    console.log("Dependency notices and licence texts are current");
    return;
  }
  await Promise.all([
    writeFile(noticeOutputPath, generated.notices),
    writeFile(licenseOutputPath, generated.licenses),
  ]);
  console.log(`Wrote ${noticeOutputPath}`);
  console.log(`Wrote ${licenseOutputPath}`);
}

if (import.meta.main) await main();
