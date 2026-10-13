import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import checker from "../tools/quint/checker.json";
import { verificationRoot } from "./verification-setup";

export async function verificationNotices(check = false) {
  const base = resolve(verificationRoot, "tools/quint");
  const lock = JSON.parse(
    await readFile(resolve(base, "package-lock.json"), "utf8"),
  ) as {
    packages: Record<
      string,
      { version?: string; license?: string; integrity?: string }
    >;
  };
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages).sort()) {
    if (!path || !entry.version) continue;
    const manifest = JSON.parse(
      await readFile(resolve(base, path, "package.json"), "utf8"),
    );
    const id = `${manifest.name}@${entry.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (
      !entry.license ||
      !entry.integrity ||
      manifest.version !== entry.version
    )
      throw new Error(`Tooling licence/lock information incomplete for ${id}`);
    sections.push(`| ${id} | ${entry.license.replaceAll("|", "\\|")} |`);
  }
  const output = `# Development verification dependency notices\n\nThese dependencies belong to the isolated development tooling package, not the\nshipped Herdr World application. Resolutions and integrity are in package-lock.json.\nLicences below are recorded as declared by the locked packages; this inventory is\nnot a replacement for their licence texts if the tooling is redistributed.\nApalache ${checker.version} (Apache-2.0) and its bundled TLC are installed from the\nSHA-256-verified distribution in checker.json; preserve its bundled licence notices\nwhen redistributing that checker. No checker binary is committed or shipped here.\n\n| Package | Declared licence |\n| --- | --- |\n${sections.join("\n")}\n`;
  const destination = resolve(base, "DEPENDENCY_NOTICES.md");
  if (check) {
    if ((await readFile(destination, "utf8")) !== output)
      throw new Error(
        "Development verifier notices changed; run verification:notices",
      );
  } else await writeFile(destination, output);
  console.log(
    `Development verifier notices ${check ? "checked" : "generated"}: ${seen.size} packages`,
  );
}

if (import.meta.main)
  await verificationNotices(process.argv.includes("--check"));
