import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import checker from "../tools/quint/checker.json";
import { runVerificationProcess } from "./verification-process";

export const verificationRoot = resolve(import.meta.dir, "..");
/**
 * The verified checker (about 190 MB unpacked) is shared by every worktree
 * and clone of this user instead of being downloaded into each one. Its
 * contents are verified against the committed digests before use, so a
 * shared copy is as trustworthy as a private one.
 * HERDR_WORLD_VERIFICATION_CACHE moves it.
 */
export function verificationCacheDirectory(
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
) {
  if (env.HERDR_WORLD_VERIFICATION_CACHE?.trim())
    return resolve(env.HERDR_WORLD_VERIFICATION_CACHE.trim());
  const cache = env.XDG_CACHE_HOME?.trim() || resolve(home, ".cache");
  return resolve(cache, "herdr-world", "verification");
}

export const checkerHome = resolve(verificationCacheDirectory(), "checker");
export const checkerDirectory = resolve(
  checkerHome,
  `apalache-dist-${checker.version}`,
  "apalache",
);
export const checkerJar = resolve(checkerDirectory, "lib/apalache.jar");
export const quintCli = resolve(
  verificationRoot,
  "tools/quint/node_modules/@informalsystems/quint/dist/src/cli.js",
);

export function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function assertVerificationInstalled() {
  const manifest = JSON.parse(
    await readFile(
      resolve(
        verificationRoot,
        "tools/quint/node_modules/@informalsystems/quint/package.json",
      ),
      "utf8",
    ),
  );
  if (manifest.version !== "0.33.0")
    throw new Error(
      "Install the locked Quint tooling with bun run verification:setup",
    );
  const jar = await readFile(checkerJar);
  if (!("jarSha256" in checker) || sha256(jar) !== checker.jarSha256)
    throw new Error(
      "Checker JAR does not match the committed lock; run verification:setup",
    );
  return {
    quint: manifest.version as string,
    checker: checker.version,
    jarSha256: sha256(jar),
  };
}

export async function setupVerification() {
  const install = await runVerificationProcess(
    [
      "npm",
      "ci",
      "--prefix",
      "tools/quint",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: verificationRoot, timeoutMs: 120_000 },
  );
  if (install.code !== 0)
    throw new Error(`Locked tooling installation failed: ${install.stderr}`);
  try {
    await assertVerificationInstalled();
    console.log("Locked verification tooling is installed.");
    return;
  } catch {
    // A missing or modified owned cache is repaired from the verified archive.
  }
  await mkdir(checkerHome, { recursive: true });
  const temporary = await mkdtemp(resolve(checkerHome, "setup-"));
  try {
    const response = await fetch(checker.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Checker download failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength > 256 * 1024 * 1024 ||
      sha256(bytes) !== checker.sha256
    )
      throw new Error("Checker archive does not match the committed SHA-256");
    const archive = resolve(temporary, "apalache.tgz");
    await writeFile(archive, bytes);
    const unpack = await runVerificationProcess(
      ["tar", "-xzf", archive, "-C", temporary],
      { timeoutMs: 120_000 },
    );
    if (unpack.code !== 0)
      throw new Error("Verified checker archive could not be unpacked");
    const staged = resolve(temporary, "apalache");
    const jar = await readFile(resolve(staged, "lib/apalache.jar"));
    if ("jarSha256" in checker && sha256(jar) !== checker.jarSha256)
      throw new Error("Checker JAR does not match its committed digest");
    await mkdir(resolve(checkerHome, `apalache-dist-${checker.version}`), {
      recursive: true,
    });
    // Another worktree may be repairing the shared copy at the same time:
    // move a stale copy aside instead of deleting it under a reader, and
    // keep whichever verified copy is published first.
    await rename(checkerDirectory, resolve(temporary, "replaced")).catch(
      () => {},
    );
    try {
      await rename(staged, checkerDirectory);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOTEMPTY" &&
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      )
        throw error;
      await assertVerificationInstalled();
    }
    console.log(
      `Verified checker ${checker.version}; jar SHA-256 ${sha256(jar)}`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) await setupVerification();
