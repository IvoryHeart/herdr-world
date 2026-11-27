// A fake herdr-core release for installer tests: nothing real is downloaded,
// installed or started. `writeCoreRelease` puts a release list, a versioned
// manifest and an archive in `assets` (for a fake curl that copies by file
// name), plus fake `systemctl` in `fakeBin`. The fake core answers
// `--version` and logs `server start` to $HC_FIXTURE_LOG.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const FIXTURE_CORE_VERSION = "0.1.22";
const TARGETS = [
  "linux-x86_64",
  "linux-aarch64",
  "macos-x86_64",
  "macos-aarch64",
];

export const fakeCoreScript = (version = FIXTURE_CORE_VERSION) => `#!/bin/sh
case "\${1:-}" in
  --version) echo 'hc ${version}' ;;
  server) echo "core server \${2:-} session=\${HC_SESSION:-}" >> "\${HC_FIXTURE_LOG:-/dev/null}"; exit "\${HC_FIXTURE_START_EXIT:-0}" ;;
  *) exit 2 ;;
esac
`;

export function writeCoreRelease(
  assets: string,
  fakeBin: string,
  options: {
    version?: string;
    sha256?: string;
    url?: string;
    /** The packed herdr-core's script instead of the fake core. */
    core?: string;
    /** Also pack an (unsigned) `Herdr Core.app`, as macOS releases carry. */
    app?: boolean;
  } = {},
) {
  const version = options.version ?? FIXTURE_CORE_VERSION;
  const stage = join(assets, "core-stage");
  mkdirSync(stage, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  const core = options.core ?? fakeCoreScript(version);
  writeFileSync(join(stage, "herdr-core"), core, { mode: 0o755 });
  const members = ["herdr-core"];
  if (options.app) {
    const macos = join(stage, "Herdr Core.app", "Contents", "MacOS");
    mkdirSync(macos, { recursive: true });
    writeFileSync(join(macos, "herdr-core"), core, { mode: 0o755 });
    members.push("Herdr Core.app");
  }
  const archive = join(assets, "herdr-core.tar.gz");
  const packed = Bun.spawnSync(
    ["tar", "-czf", archive, "-C", stage, ...members],
    { env: { ...process.env, COPYFILE_DISABLE: "1" }, stderr: "pipe" },
  );
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const sha256 =
    options.sha256 ??
    createHash("sha256").update(readFileSync(archive)).digest("hex");
  const url =
    options.url ??
    `https://releases.herdr.dev/core/${version}/herdr-core.tar.gz`;
  const manifest = JSON.stringify(
    {
      version,
      targets: Object.fromEntries(TARGETS.map((t) => [t, { url, sha256 }])),
    },
    null,
    2,
  );
  writeFileSync(join(assets, "latest.json"), manifest);
  writeFileSync(join(assets, "manifest.json"), manifest);
  writeFileSync(
    join(fakeBin, "systemctl"),
    `#!/bin/sh
echo "systemctl $*" >> "\${HC_FIXTURE_LOG:-/dev/null}"
[ "\${HC_FIXTURE_NO_SYSTEMD:-}" != 1 ] || exit 1
`,
  );
  chmodSync(join(fakeBin, "systemctl"), 0o755);
  writeFileSync(
    join(fakeBin, "launchctl"),
    '#!/bin/sh\necho "launchctl $*" >> "${HC_FIXTURE_LOG:-/dev/null}"\n',
    { mode: 0o755 },
  );
  return { version, sha256, archive };
}

/** A PATH holding the fakes and system tools only, never the user's own core. */
export const isolatedPath = (fakeBin: string) =>
  `${fakeBin}:${process.env.PATH}`;

/** Where a real login entry would be, inside the fixture's HOME. */
export const loginEntry = (home: string, session = "default") => {
  const suffix = session === "default" ? "" : `-${session}`;
  return process.platform === "darwin"
    ? join(
        home,
        "Library",
        "LaunchAgents",
        `dev.herdr-world.herdr-core${suffix}.plist`,
      )
    : join(
        home,
        ".config",
        "systemd",
        "user",
        `herdr-core-login${suffix}.service`,
      );
};
