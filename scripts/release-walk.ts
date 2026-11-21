/** Real-runtime acceptance of the packaged executable. Never imported by product code. */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  herdrReleaseUrl,
  resolveHerdrReleaseTarget,
  VERIFIED_HERDR_SHA256,
} from "../server/src/herdr/release";
import { latestStableRelease } from "./installer-upgrade";

async function command(argv: string[], env = process.env) {
  const child = Bun.spawn(argv, { env, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code) throw new Error(`${argv[0]} exited ${code}`);
}

export async function releaseWalk(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      archive: { type: "string" },
      version: { type: "string" },
      "baseline-tag": { type: "string" },
      report: { type: "string" },
      "signed-in-home": { type: "string" },
      "disposable-host": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.info(
      "bun run test:release-walk --disposable-host [--archive PACKAGE.tar.xz --version X.Y.Z] [--signed-in-home DEDICATED_HOME] [--baseline-tag vX.Y.Z] [--report FILE]\nRuns every journey on a disposable Linux/macOS user account or VM. Without --archive, builds the native release package. Requires Bun, Node/npm, Python/venv, gh and a native user service manager. No journey may be skipped.",
    );
    return;
  }
  if (!values["disposable-host"])
    throw new Error(
      "Service journey requires --disposable-host in a disposable OS account or VM",
    );
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new Error("Release walk requires Linux or macOS");
  const target = resolveHerdrReleaseTarget(process.platform, process.arch);
  if (!target) throw new Error("Unsupported release walk architecture");
  const platform = `${process.platform}-${process.arch}`;
  const version =
    values.version ??
    readFileSync("herdr-plugin.toml", "utf8").match(
      /^version = "([^"]+)"/m,
    )?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version))
    throw new Error("Missing or invalid release package version");
  if (!values.archive)
    await command(["bash", "scripts/package-release.sh", platform], {
      ...process.env,
      HERDR_WORLD_BUILD_VERSION: version,
    });
  const archive = resolve(
    values.archive ?? `dist/herdr-world-v${version}-${platform}.tar.xz`,
  );
  const checksum = readFileSync(`${archive}.sha256`, "utf8").split(/\s/)[0];
  if (
    new Bun.CryptoHasher("sha256")
      .update(await Bun.file(archive).arrayBuffer())
      .digest("hex") !== checksum
  )
    throw new Error("Release archive checksum mismatch");
  const baseline = values["baseline-tag"] ?? (await latestStableRelease()).tag;
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim();
  const root = mkdtempSync("/tmp/world-walk-");
  try {
    const venv = join(root, "venv");
    await command(["python3", "-m", "venv", venv]);
    const python = join(venv, "bin/python3");
    await command([
      python,
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "websocket-client==1.8.0",
    ]);
    const config = join(root, "config.json");
    const report = resolve(
      values.report ?? `.agents/delivery/release-walk/${platform}.json`,
    );
    mkdirSync(resolve(report, ".."), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({
        root,
        archive,
        version,
        commit,
        platform,
        baseline,
        report,
        disposable: values["disposable-host"],
        signed_home: values["signed-in-home"]
          ? resolve(values["signed-in-home"])
          : null,
        herdr_url: herdrReleaseUrl(target),
        herdr_sha256: VERIFIED_HERDR_SHA256[target],
        runtime_target: target,
      }),
    );
    await command([python, "scripts/release-walk/main.py", config]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await releaseWalk(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
