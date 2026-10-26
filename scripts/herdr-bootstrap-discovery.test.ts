import { expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHerdrBootstrap } from "./herdr-bootstrap";

// Exercise the same status producer used by published World, rather than a
// hand-written status string that can hide invalid installed entries.
const bootstrapModule = fileURLToPath(
  new URL("../server/src/herdr/bootstrap.ts", import.meta.url),
);
const cliModule = fileURLToPath(
  new URL("../server/src/herdr/cli.ts", import.meta.url),
);
const quote = (path: string) => "'" + path.replaceAll("'", "'\\''") + "'";

for (const location of ["default", "PATH", "explicit"]) {
  const kinds =
    location === "default"
      ? ["directory", "non-executable", "executable", "running"]
      : ["directory", "non-executable", "executable"];
  test.each(kinds)(
    `discovery-backed launcher validates ${location} %s`,
    (kind) => {
      const root = mkdtempSync(join(tmpdir(), "world-discovery-"));
      try {
        const runtime = join(root, "runtime");
        const selected = join(
          root,
          location === "default" ? "runtime" : "external prefix",
        );
        mkdirSync(selected);
        const candidate = join(selected, "herdr");
        if (kind === "directory") mkdirSync(candidate);
        else if (kind !== "running")
          writeFileSync(candidate, "#!/bin/sh\necho herdr 0.9.5\n", {
            mode: kind === "executable" ? 0o755 : 0o644,
          });
        const original = kind === "running" ? undefined : lstatSync(candidate);
        const driver = join(root, "world.ts");
        writeFileSync(
          driver,
          `
import {appendFileSync} from "node:fs";
import {detectHerdrSetup} from ${JSON.stringify(bootstrapModule)};
import {runHerdrCommand} from ${JSON.stringify(cliModule)};
const deps={homeDir:process.env.HOME,installDir:process.env.HERDR_INSTALL_DIR,pathEnv:process.env.FIXTURE_PATH??"",binPathEnv:process.env.FIXTURE_BINARY??"",ping:async()=>{if(process.env.FIXTURE_RUNNING==="1")return{version:"0.9.5",protocol:22};throw Error("not running")}};
if(process.argv[2]==="herdr"){
 appendFileSync(process.env.FIXTURE_LOG!,"status\\n");
 const state=await detectHerdrSetup(deps);
 appendFileSync(process.env.FIXTURE_STATE_LOG!,JSON.stringify(state));
 process.exit((await runHerdrCommand(process.argv.slice(2),"0.2.7",{loadConfig:()=>({socketPath:"/fixture/default.sock"}) as never,detect:()=>Promise.resolve(state),serviceStatus:()=>({installed:false,active:false})}))??1);
}
appendFileSync(process.env.FIXTURE_LOG!,"World started\\n");
`,
        );
        const world = join(root, "world");
        writeFileSync(
          world,
          '#!/bin/sh\nexec "$FIXTURE_BUN" "$FIXTURE_DRIVER" "$@"\n',
          { mode: 0o755 },
        );
        const launcher = join(root, "launcher");
        const template = readFileSync(
          new URL("./homebrew-launcher.sh", import.meta.url),
          "utf8",
        );
        writeFileSync(
          launcher,
          template
            .replace("@HERDR_WORLD_BINARY@", () => quote(world))
            .replace("@HERDR_BOOTSTRAP@", () => renderHerdrBootstrap()),
          { mode: 0o755 },
        );
        const tools = join(root, "tools");
        mkdirSync(tools);
        const download = join(root, "download");
        writeFileSync(
          join(tools, "curl"),
          '#!/bin/sh\necho unexpected > "$FIXTURE_DOWNLOAD"\nexit 99\n',
          { mode: 0o755 },
        );
        const log = join(root, "log");
        const stateLog = join(root, "state");
        const result = Bun.spawnSync([launcher], {
          env: {
            ...process.env,
            HOME: root,
            PATH: tools + ":" + (process.env.PATH ?? ""),
            HERDR_INSTALL_DIR: runtime,
            HERDR_WORLD_SKIP_HERDR: "",
            HERDR_SSH_HOST: "",
            HERDR_SOCKET_PATH: "",
            HERDR_CLIENT_SOCKET_PATH: "",
            HERDR_SESSION: "",
            FIXTURE_RUNNING: kind === "running" ? "1" : "",
            FIXTURE_BUN: process.execPath,
            FIXTURE_DRIVER: driver,
            FIXTURE_LOG: log,
            FIXTURE_STATE_LOG: stateLog,
            FIXTURE_DOWNLOAD: download,
            FIXTURE_PATH: location === "PATH" ? selected : "",
            FIXTURE_BINARY: location === "explicit" ? candidate : "",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(JSON.parse(readFileSync(stateLog, "utf8"))).toEqual(
          kind === "running"
            ? { state: "running", version: "0.9.5", protocol: 22 }
            : { state: "installed", binaryPath: candidate },
        );
        expect(result.exitCode).toBe(0);
        expect(readFileSync(log, "utf8")).toBe("status\nWorld started\n");
        expect(existsSync(download)).toBe(false);
        if (kind === "executable" || kind === "running")
          expect(result.stderr.toString()).toBe("");
        else {
          expect(result.stderr.toString()).toContain(
            `Herdr installation blocked by non-executable entry: ${candidate}`,
          );
          expect(result.stderr.toString()).toContain(
            "HERDR_WORLD_SKIP_HERDR=1",
          );
        }
        if (original) {
          expect(lstatSync(candidate).ino).toBe(original.ino);
          expect(lstatSync(candidate).mode).toBe(original.mode);
        }
        if (kind === "running") expect(existsSync(candidate)).toBe(false);
        else
          expect(
            kind === "directory"
              ? lstatSync(candidate).isDirectory()
              : readFileSync(candidate, "utf8").startsWith("#!/bin/sh"),
          ).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
