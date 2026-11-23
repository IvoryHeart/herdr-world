/** Real installation acceptance. World and the release mirror run only in Docker. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { latestStableRelease } from "./installer-upgrade";
import { buildInstallImage } from "./install-linux/image";
import {
  herdrReleaseUrl,
  VERIFIED_HERDR_SHA256,
  VERIFIED_HERDR_VERSION,
} from "../server/src/herdr/release";

const cases = ["fresh", "core-only", "tui", "stopped", "upgrade"] as const;
type Run = (args: string[], env?: Record<string, string>) => Promise<string>;
type Resources = { containers: Set<string>; image?: string };

/** CI already froze the native baseline; avoid rate limits and release races. */
export async function installBaselineTag(
  frozenTag = process.env.INSTALLER_BASELINE_TAG,
  download: typeof fetch = fetch,
) {
  if (frozenTag) {
    assert(
      /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(frozenTag),
      "Baseline must have a stable version tag",
    );
    return frozenTag;
  }
  return (await latestStableRelease(download)).tag;
}

export function installOptions(args: string[]) {
  const options = {
    reuse: false,
    version: process.env.HERDR_WORLD_BUILD_VERSION || "0.0.0-rc.1",
    coreVersion: "latest",
    requireDocker: false,
    only: "",
    fault: "",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--reuse") options.reuse = true;
    else if (arg === "--require-docker") options.requireDocker = true;
    else if (arg === "--version") options.version = args[++i] || "";
    else if (arg === "--core-version") options.coreVersion = args[++i] || "";
    else if (arg === "--case") options.only = args[++i] || "invalid";
    else if (arg === "--fault") options.fault = args[++i] || "invalid";
    else throw new Error(`Unknown option: ${arg}`);
  }
  assert(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.[1-9]\d*)?$/.test(
      options.version,
    ),
    "Invalid candidate version",
  );
  assert(
    options.coreVersion === "latest" ||
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(options.coreVersion),
    "Invalid core version",
  );
  assert(
    !options.only || cases.includes(options.only as (typeof cases)[number]),
    "Unknown case",
  );
  assert(!options.fault || options.fault === "skip-register", "Unknown fault");
  assert(
    !options.reuse || args.includes("--version"),
    "--reuse requires --version for the package in dist/",
  );
  return options;
}

export function dockerArguments(name: string, image: string, assets: string) {
  return [
    "docker",
    "create",
    "--name",
    name,
    "--hostname",
    "install-fixture",
    "--label",
    "herdr-world.install-test=true",
    "--platform",
    "linux/amd64",
    "--cgroupns=private",
    "--cap-add",
    "SYS_ADMIN",
    "--security-opt",
    "apparmor=unconfined",
    "--security-opt",
    "seccomp=unconfined",
    "--tmpfs",
    "/run",
    "--tmpfs",
    "/run/lock",
    "-t",
    "--mount",
    `type=bind,src=${assets},dst=/artifacts,readonly`,
    image,
    "sh",
    "-c",
    "mount -o remount,rw /sys/fs/cgroup && mkdir -p /run/systemd && exec /sbin/init",
  ];
}

/** Register names before creating anything: partial create/build must clean up too. */
export async function withInstallResources(
  root: string,
  _name: string,
  run: Run,
  work: (resources: Resources) => Promise<void>,
) {
  const resources: Resources = { containers: new Set() };
  const errors: string[] = [];
  let failed = false;
  let failure: unknown;
  try {
    await work(resources);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    for (const container of resources.containers) {
      try {
        await run(["docker", "rm", "--force", container]);
      } catch (error) {
        if (!/No such container/i.test(String(error)))
          errors.push("container removal");
      }
    }
    if (resources.image) {
      try {
        await run(["docker", "image", "rm", "--force", resources.image]);
      } catch (error) {
        if (!/No such image/i.test(String(error))) errors.push("image removal");
      }
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      errors.push("scratch removal");
    }
  }
  if (errors.length)
    throw new AggregateError(
      [
        ...(failed ? [failure] : []),
        ...errors.map((error) => new Error(error)),
      ],
      `Install test cleanup failed: ${errors.join(", ")}`,
    );
  if (failed) throw failure;
}

async function main() {
  const options = installOptions(process.argv.slice(2));
  if (!Bun.which("docker")) {
    console.info(
      "SKIP Linux installation: Docker is not installed. Install Docker with cgroup v2 support and rerun.",
    );
    assert(!options.requireDocker, "CI requires Docker");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "world-install-linux-"));
  const name = `world-install-${randomUUID()}`;
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("interrupted"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const scrub = (text: string) =>
    text
      .replaceAll(root, "<scratch>")
      .replaceAll(process.cwd(), "<checkout>")
      .replaceAll(homedir(), "<home>");
  function runner(cleanup = false): Run {
    return async (args, env = {}) => {
      if (!cleanup) abort.signal.throwIfAborted();
      const child = Bun.spawn(args, {
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
        detached: process.platform !== "win32",
      });
      const kill = () => {
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch {
          /* The command may have exited as its deadline fired. */
        }
      };
      if (!cleanup)
        abort.signal.addEventListener("abort", kill, { once: true });
      const timeout = setTimeout(kill, cleanup ? 60_000 : 20 * 60_000);
      try {
        const [out, err, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const checks = out
          .split("\n")
          .filter((line) =>
            /^\[(fresh|core-only|tui|stopped|upgrade)\]/.test(line),
          );
        for (const line of checks) console.info(line);
        if (args[0] === "docker" && args[1] === "build") {
          for (const line of (out + err)
            .split("\n")
            .filter((line) => /\[apt\]/.test(line))) {
            console.info(line);
            if (process.env.GITHUB_STEP_SUMMARY)
              writeFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`, {
                flag: "a",
              });
          }
        }
        assert(
          code === 0,
          scrub(
            `${args[0]} failed (${code})\n${(checks.length ? err : out + err).slice(-7000)}`,
          ),
        );
        if (!cleanup) abort.signal.throwIfAborted();
        return out.trim();
      } finally {
        clearTimeout(timeout);
        abort.signal.removeEventListener("abort", kill);
      }
    };
  }
  const run = runner();
  try {
    await withInstallResources(root, name, runner(true), async (resources) => {
      await run(["docker", "info", "--format", "{{.CgroupVersion}}"]).then(
        (value) =>
          assert.equal(value, "2", "systemd tests require Docker cgroup v2"),
      );
      if (!options.reuse) {
        console.info("Building Linux x64 release package...");
        await run([process.execPath, "run", "package:linux-x64"], {
          HERDR_WORLD_BUILD_VERSION: options.version,
        });
      }
      const assets = join(root, "artifacts");
      mkdirSync(assets);
      const archive = `herdr-world-v${options.version}-linux-x64.tar.xz`;
      const checksum = readFileSync(
        resolve("dist", `${archive}.sha256`),
        "utf8",
      );
      const expected = checksum.match(
        new RegExp(`^([a-f0-9]{64})  ${archive.replaceAll(".", "\\.")}\\s*$`),
      )?.[1];
      assert(expected, "Invalid candidate checksum file");
      const bytes = readFileSync(resolve("dist", archive));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected,
        "Candidate checksum mismatch",
      );
      copyFileSync(resolve("dist", archive), join(assets, archive));
      writeFileSync(join(assets, `${archive}.sha256`), checksum);
      for (const file of ["install-herdr-world.sh", "herdr-core-install.sh"])
        copyFileSync(resolve("scripts", file), join(assets, file));
      if (options.fault === "skip-register") {
        const installer = join(assets, "install-herdr-world.sh");
        const source = readFileSync(installer, "utf8");
        assert.equal(
          source.split("\n  herdr_core_register\n").length,
          2,
          "Registration fault target changed",
        );
        writeFileSync(
          installer,
          source.replace(
            "\n  herdr_core_register\n",
            "\n  : # test-only skipped registration\n",
          ),
        );
        console.info(
          "Injected skip-register into the disposable installer copy; expect fresh to fail.",
        );
      }
      const tag = await installBaselineTag();
      writeFileSync(
        join(assets, "config.json"),
        JSON.stringify({
          version: options.version,
          baseline: tag.slice(1),
          core: options.coreVersion,
          tui: {
            version: VERIFIED_HERDR_VERSION,
            url: herdrReleaseUrl("linux-x86_64"),
            sha256: VERIFIED_HERDR_SHA256["linux-x86_64"],
          },
        }),
      );
      console.info(
        `Baseline ${tag}; candidate ${options.version}; core ${options.coreVersion}; Herdr ${VERIFIED_HERDR_VERSION}`,
      );
      resources.image = `${name}:test`;
      console.info("Building disposable Ubuntu 24.04 systemd image...");
      // Narrow context: no source tree, credentials or host runtime files enter the image.
      await buildInstallImage(
        resources.image,
        run,
        process.env.INSTALLER_LINUX_BASE_CACHE,
      );
      const failures: string[] = [];
      for (const scenario of cases.filter(
        (item) => !options.only || item === options.only,
      )) {
        const container = `${name}-${scenario}`;
        resources.containers.add(container);
        const user = (...args: string[]) =>
          run(["docker", "exec", "--user", "tester", container, ...args]);
        try {
          console.info(
            `[${scenario}] CHECK systemd PID 1 and lingering user manager`,
          );
          await run(dockerArguments(container, resources.image, assets));
          await run(["docker", "start", container]);
          // systemctl waits for PID 1 and the real lingering user manager; no sleeps.
          await run([
            "docker",
            "exec",
            container,
            "python3",
            "/opt/install-test/boot.py",
          ]);
          await run([
            "docker",
            "exec",
            container,
            "systemctl",
            "is-active",
            "user@1000.service",
          ]);
          console.info(
            `[${scenario}] PASS systemd PID 1 and lingering user manager`,
          );
          await user("python3", "/opt/install-test/scenarios.py", scenario);
          if (scenario === "fresh") {
            await run(["docker", "restart", "--timeout", "20", container]);
            await run([
              "docker",
              "exec",
              container,
              "python3",
              "/opt/install-test/boot.py",
            ]);
            await run([
              "docker",
              "exec",
              container,
              "systemctl",
              "is-active",
              "user@1000.service",
            ]);
            await user("python3", "/opt/install-test/scenarios.py", "reboot");
          }
        } catch (error) {
          abort.signal.throwIfAborted();
          failures.push(scenario);
          console.error(`[${scenario}] FAIL ${scrub(String(error))}`);
          // Bounded diagnostics from this synthetic container only, never host services.
          const diagnostics = await runner(true)([
            "docker",
            "exec",
            container,
            "journalctl",
            "--no-pager",
            "-n",
            "35",
          ]).catch(() => "journal unavailable");
          console.error(scrub(diagnostics));
          const bootLog = await runner(true)([
            "docker",
            "logs",
            "--tail",
            "15",
            container,
          ]).catch(() => "boot log unavailable");
          console.error(scrub(bootLog));
        }
        abort.signal.throwIfAborted();
      }
      assert(
        !failures.length,
        `Linux installation failed: ${failures.join(", ")}`,
      );
      console.info("Linux installation: all requested cases passed.");
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
