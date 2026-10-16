import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { basename, delimiter, join, resolve } from "node:path";

const repository = "IvoryHeart/herdr-world";

// Windows may retain executable/file handles briefly after child exit. Yield
// during bounded retries; a persistent lock still fails the required job.
export async function removeInstallerFixture(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

export function candidateVersion(tag: string, run: string): string {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  assert(match, "The upgrade baseline must be a stable release tag");
  assert(/^[1-9]\d*$/.test(run), "A positive CI run ID is required");
  return `${match[1]}.${match[2]}.${BigInt(match[3]) + 1n}-rc.${run}`;
}

// v0.2.3 signed cookies with the password. The accepted independent-signing-key
// migration must reject those cookies, then retain new sessions across restarts.
export const upgradeCookieStatus = (tag: string) =>
  tag === "v0.2.3" ? 401 : 200;

export async function plan() {
  const api = async (path: string) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        headers: process.env.GH_TOKEN
          ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(response.ok, `GitHub baseline lookup failed: ${response.status}`);
    return response.json() as Promise<any>;
  };
  const release = await api("releases/latest");
  assert(
    !release.draft && !release.prerelease,
    "Baseline must be published and stable",
  );
  const version = candidateVersion(
    release.tag_name,
    process.env.GITHUB_RUN_ID!,
  );
  const commit = await api(`commits/${encodeURIComponent(release.tag_name)}`);
  assert(
    /^[0-9a-f]{40}$/.test(commit.sha),
    "Missing immutable baseline revision",
  );
  const values = {
    baseline_tag: release.tag_name,
    baseline_sha: commit.sha,
    candidate_version: version,
  };
  assert(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
  const { appendFileSync } = await import("node:fs");
  for (const [key, value] of Object.entries(values))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.info(JSON.stringify(values));
}

export function runtimeEnvironment(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(HERDR_|ROAMGATE_)/.test(key),
    ),
  );
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH:
      process.platform === "win32"
        ? [
            join(process.env.SystemRoot!, "System32"),
            join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0"),
          ].join(delimiter)
        : "/usr/bin:/bin:/usr/sbin:/sbin",
    HOST: "127.0.0.1",
    PORT: "0",
    OPEN_BROWSER: "0",
    HERDR_WORLD_PASSWORD: "installer-upgrade-fixture-password",
    HERDR_WORLD_CONNECTIONS_PATH: join(home, "connections.json"),
    HERDR_CONNECTIONS_PATH: join(home, "connections.json"),
    HERDR_SOCKET_PATH: join(home, "absent-control.sock"),
    HERDR_CLIENT_SOCKET_PATH: join(home, "absent-render.sock"),
  };
}

async function command(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  success = true,
) {
  const child = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 120_000);
  try {
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    assert(!timedOut, `${basename(argv[0])} exceeded its command deadline`);
    assert(
      success ? code === 0 : code !== 0,
      `${basename(argv[0])} ${argv.slice(1).join(" ")} exited ${code}\n${out.slice(-2000)}\n${err.slice(-2000)}`,
    );
    return success ? out.trim() : `${out}\n${err}`.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function exerciseRuntime(
  binary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  previousCookie?: string,
  cookieStatus = 200,
) {
  const child = Bun.spawn([binary], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const ready = Promise.withResolvers<string>();
  let stdout = "";
  const errors = new Response(child.stderr).text();
  const output = (async () => {
    for await (const chunk of child.stdout) {
      stdout += new TextDecoder().decode(chunk);
      const port = stdout.match(
        /\bINFO bridge listening\b[^\r\n]*:(\d+)\b/,
      )?.[1];
      if (port) ready.resolve(`http://127.0.0.1:${port}`);
    }
    ready.reject(
      new Error(
        `Runtime exited before listening: ${stdout.slice(-1500)}\n${(await errors).slice(-1500)}`,
      ),
    );
  })();
  const timeout = setTimeout(
    () => ready.reject(new Error("Runtime startup timed out")),
    30_000,
  );
  try {
    const base = await ready.promise;
    clearTimeout(timeout);
    const request = (path: string, init?: RequestInit) =>
      fetch(base + path, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    assert.equal((await request("/health")).status, 200);
    const unauthenticated = await request("/");
    assert.equal(
      unauthenticated.status,
      401,
      "The application must require login",
    );
    if (previousCookie)
      assert.equal(
        (await request("/", { headers: { Cookie: previousCookie } })).status,
        cookieStatus,
        "Upgrade/restart must enforce the documented session migration",
      );
    const login = await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ password: env.HERDR_WORLD_PASSWORD }),
    });
    assert.equal(login.status, 200, "The configured password must survive");
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert(cookie, "Login must issue a session cookie");
    const app = await request("/", { headers: { Cookie: cookie } });
    assert.equal(app.status, 200);
    const html = await app.text();
    const asset = html.match(
      /(?:src|href)="([^"?]*\/assets\/[^"?]+\.js)"/,
    )?.[1];
    assert(
      asset,
      "Packaged application must contain its embedded browser assets",
    );
    assert.equal(
      (await request(asset, { headers: { Cookie: cookie } })).status,
      200,
    );
    return cookie;
  } finally {
    clearTimeout(timeout);
    child.kill();
    const deadline = setTimeout(() => child.kill(9), 10_000);
    await child.exited;
    clearTimeout(deadline);
    await output;
    await errors;
  }
}

type Manifest = {
  version: string;
  build: { platforms?: string[]; command: string[] }[];
  actions: { id: string; command: string[] }[];
  panes: { id: string; command: string[] }[];
};
const manifestAt = (root: string) =>
  Bun.TOML.parse(
    readFileSync(join(root, "herdr-plugin.toml"), "utf8"),
  ) as Manifest;
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export async function verify() {
  const source = resolve(import.meta.dir, "..");
  const baseline = resolve(process.env.INSTALLER_BASELINE_DIR!);
  const tag = process.env.INSTALLER_BASELINE_TAG!;
  const version = process.env.HERDR_WORLD_BUILD_VERSION!;
  assert.equal(version, candidateVersion(tag, process.env.GITHUB_RUN_ID!));
  assert.equal(manifestAt(baseline).version, tag.slice(1));
  const platform = `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"}-${process.arch}`;
  const archiveName = `herdr-world-v${version}-${platform}.tar.xz`;
  const archive = join(source, "dist", archiveName);
  assert(
    existsSync(archive),
    "Build the native release package before verification",
  );
  assert.equal(
    readFileSync(`${archive}.sha256`, "utf8").trim(),
    `${digest(archive)}  ${archiveName}`,
  );
  const root = mkdtempSync(join(tmpdir(), "world installer upgrade "));
  const reportDir = resolve(
    process.env.INSTALLER_REPORT_DIR ??
      join(source, ".agents/installer-report"),
  );
  mkdirSync(reportDir, { recursive: true });
  const report = {
    platform,
    baseline: tag,
    baselineSha: process.env.INSTALLER_BASELINE_SHA,
    candidate: version,
    candidateSha: process.env.INSTALLER_CANDIDATE_SHA,
    archiveSha256: digest(archive),
    cases: [] as string[],
    status: "failed",
  };
  let corruptChecksum = false;
  const host = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const name = new URL(request.url).pathname.slice(1);
      if (![archiveName, `${archiveName}.sha256`].includes(name))
        return new Response("missing", { status: 404 });
      if (corruptChecksum && name.endsWith(".sha256"))
        return new Response(`${"0".repeat(64)}  ${archiveName}\n`);
      return new Response(Bun.file(join(source, "dist", name)));
    },
  });
  const executable =
    process.platform === "win32" ? "herdr-world.exe" : "herdr-world";
  const prepare = (directory: string) => {
    mkdirSync(join(directory, "scripts"), { recursive: true });
    for (const name of [
      "install-plugin.sh",
      "install-plugin.ps1",
      "install-herdr-world.sh",
    ])
      copyFileSync(
        join(source, "scripts", name),
        join(directory, "scripts", name),
      );
    writeFileSync(
      join(directory, "herdr-plugin.toml"),
      readFileSync(join(source, "herdr-plugin.toml"), "utf8").replace(
        /^version = ".*"/m,
        `version = "${version}"`,
      ),
    );
  };
  const installer = (directory: string) =>
    process.platform === "win32"
      ? [
          join(
            process.env.SystemRoot!,
            "System32/WindowsPowerShell/v1.0/powershell.exe",
          ),
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(directory, "scripts/install-plugin.ps1"),
        ]
      : ["sh", join(directory, "scripts/install-plugin.sh")];
  const environment = (directory: string) => {
    const env = runtimeEnvironment(join(directory, "home"));
    const config =
      process.platform === "win32"
        ? join(env.APPDATA!, "herdr-world")
        : join(env.HOME!, ".config/herdr-world");
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, "herdr-world.env"),
      `HOST=127.0.0.1\nPORT=8799\nHERDR_WORLD_PASSWORD=${env.HERDR_WORLD_PASSWORD}\n`,
    );
    writeFileSync(
      join(config, "settings.json"),
      JSON.stringify({
        version: 1,
        title_suffix: "Upgrade fixture",
        repositories: {},
        workspace_auto_sync: {},
        custom: { installerFixture: true },
      }),
    );
    assert.equal(
      Bun.which("bun", { PATH: env.PATH }),
      null,
      "Installer environment must not resolve Bun",
    );
    return {
      env: { ...env, HERDR_WORLD_RELEASE_BASE_URL: host.url.origin },
      config,
    };
  };
  try {
    const fresh = join(root, "fresh");
    prepare(fresh);
    const freshState = environment(fresh);
    await command(installer(fresh), fresh, freshState.env);
    assert.equal(
      await command(
        [join(fresh, "server", executable), "--version"],
        fresh,
        freshState.env,
      ),
      `herdr-world ${version}`,
    );
    await exerciseRuntime(
      join(fresh, "server", executable),
      fresh,
      freshState.env,
    );
    report.cases.push(
      "fresh plugin install, authenticated runtime and embedded assets without Bun",
    );

    const upgrade = join(root, "upgrade");
    cpSync(baseline, upgrade, {
      recursive: true,
      filter: (path) =>
        ![".git", ".agents", "node_modules", "dist"].includes(basename(path)),
    });
    const state = environment(upgrade);
    const previousManifest = manifestAt(upgrade);
    const os =
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux";
    const build = previousManifest.build.filter(
      (entry) => !entry.platforms || entry.platforms.includes(os),
    );
    assert(
      build.length > 0,
      "Baseline must have an applicable plugin installer",
    );
    for (const entry of build)
      await command(entry.command, upgrade, {
        ...state.env,
        PATH: process.env.PATH,
        HERDR_WORLD_RELEASE_BASE_URL: `https://github.com/${repository}/releases/download/${tag}`,
      });
    const binary = join(upgrade, "server", executable);
    const launcher = join(upgrade, "server/herdr-world-plugin.exe");
    assert.equal(
      await command([binary, "--version"], upgrade, state.env),
      `herdr-world ${tag.slice(1)}`,
    );
    assert.equal(
      await command([launcher, "version"], upgrade, state.env),
      `herdr-world ${tag.slice(1)}`,
    );
    const previousBinary = join(root, executable);
    copyFileSync(binary, previousBinary);
    const oldCookie = await exerciseRuntime(binary, upgrade, state.env);
    const retained = [
      join(state.config, "herdr-world.env"),
      join(state.config, "settings.json"),
    ];
    const before = retained.map(digest);
    prepare(upgrade);
    const nextManifest = manifestAt(upgrade);
    for (const kind of ["actions", "panes"] as const)
      for (const action of previousManifest[kind])
        assert.deepEqual(
          nextManifest[kind].find((entry) => entry.id === action.id)?.command,
          action.command,
          `Cached ${kind} ${action.id} must remain compatible`,
        );
    await command(installer(upgrade), upgrade, state.env);
    assert.equal(
      await command([launcher, "version"], upgrade, state.env),
      `herdr-world ${version}`,
    );
    assert.equal(
      await command([launcher, "url"], upgrade, state.env),
      "http://localhost:8799",
    );
    assert(
      (await command([launcher, "panel"], upgrade, state.env)).includes(
        `herdr-world ${version}`,
      ),
    );
    const newCookie = await exerciseRuntime(
      binary,
      upgrade,
      state.env,
      oldCookie,
      upgradeCookieStatus(tag),
    );
    await exerciseRuntime(binary, upgrade, state.env, newCookie);
    assert.deepEqual(
      retained.map(digest),
      before,
      "Configuration must survive upgrade/restart unchanged",
    );
    report.cases.push(
      "latest stable plugin upgrade, cached actions, password and settings preservation, runtime restart",
    );
    report.cases.push(
      upgradeCookieStatus(tag) === 401
        ? "legacy password-signed cookie rejected; re-login and new-session persistence verified"
        : "existing session retained across upgrade and restart",
    );

    const installed = [binary, launcher].map(digest);
    corruptChecksum = true;
    assert.match(
      await command(installer(upgrade), upgrade, state.env, false),
      /checksum mismatch/i,
    );
    corruptChecksum = false;
    assert.deepEqual(
      [binary, launcher].map(digest),
      installed,
      "Rejected download must not replace either executable",
    );
    assert.deepEqual(retained.map(digest), before);
    await exerciseRuntime(binary, upgrade, state.env, newCookie);
    report.cases.push(
      "checksum rejection leaves installation and authenticated runtime usable",
    );

    if (process.platform !== "win32") {
      const directory = join(root, "standalone");
      mkdirSync(directory);
      const env = {
        ...state.env,
        HERDR_WORLD_VERSION: version,
        HERDR_WORLD_INSTALL_DIR: directory,
      };
      copyFileSync(previousBinary, join(directory, executable));
      assert.equal(
        await command(
          [join(directory, executable), "--version"],
          directory,
          env,
        ),
        `herdr-world ${tag.slice(1)}`,
      );
      await command(
        ["sh", join(source, "scripts/install-herdr-world.sh")],
        directory,
        env,
      );
      assert.equal(
        await command(
          [join(directory, executable), "--version"],
          directory,
          env,
        ),
        `herdr-world ${version}`,
      );
      assert.equal(digest(join(directory, executable)), digest(binary));
      report.cases.push("standalone shell installer replacement without Bun");
    }
    report.status = "passed";
  } finally {
    host.stop(true);
    writeFileSync(
      join(reportDir, `${platform}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    await removeInstallerFixture(root);
  }
  console.info(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  try {
    await (process.argv[2] === "plan" ? plan() : verify());
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
