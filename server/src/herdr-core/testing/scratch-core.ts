import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real herdr-core under scratch HOME/XDG directories, for live checks and
 * captures. Its identity is synthetic (seeded `core.json`), so recorded
 * traffic names no real host. Linux only: cleanup finds every process whose
 * environment names this scratch state directory.
 */
export function scratchCoreBinary(): string | null {
  const bin = process.env.HERDR_CORE_BIN;
  return bin && process.platform === "linux" ? bin : null;
}

export class ScratchCore {
  readonly root: string;
  readonly env: Record<string, string>;
  readonly stateDir: string;
  private serve: ReturnType<typeof Bun.spawn> | null = null;

  constructor(
    readonly bin: string,
    options: { heartbeatMs?: number; coreId?: string } = {},
  ) {
    // Short: holder sockets must fit the OS limit.
    this.root = mkdtempSync(join(tmpdir(), "hcw-"));
    for (const dir of ["home", "run", "state", "config"])
      mkdirSync(join(this.root, dir), { recursive: true, mode: 0o700 });
    this.stateDir = join(this.root, "state", "herdr-core", "default");
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(this.stateDir, "core.json"),
      JSON.stringify({
        id: options.coreId ?? "c0ffee0000000001",
        name: "example-host",
      }),
    );
    this.env = {
      PATH: "/usr/bin:/bin",
      HOME: join(this.root, "home"),
      XDG_RUNTIME_DIR: join(this.root, "run"),
      XDG_STATE_HOME: join(this.root, "state"),
      XDG_CONFIG_HOME: join(this.root, "config"),
      SHELL: "/bin/sh",
      LANG: "C.UTF-8",
      HC_HEARTBEAT_MS: String(options.heartbeatMs ?? 300),
    };
  }

  /** Runs `serve` in the foreground: no autostart path is involved. */
  async start(): Promise<void> {
    this.serve = Bun.spawn([this.bin, "serve"], {
      env: this.env,
      cwd: this.env.HOME,
      stdout: "ignore",
      stderr: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      try {
        const socket = readFileSync(join(this.stateDir, "core.lock"), "utf8");
        if (socket && readdirSync(join(socket, "..")).length > 0) {
          await Bun.sleep(50);
          return;
        }
      } catch {}
      await Bun.sleep(20);
    }
    throw new Error("scratch core did not start");
  }

  /** CLI calls run with this core's environment, in its scratch home. */
  async hc(...args: string[]): Promise<string> {
    const proc = Bun.spawn([this.bin, ...args], {
      env: this.env,
      cwd: this.env.HOME,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`hc ${args.join(" ")}: ${err || out}`);
    return out;
  }

  /** Every process carrying this scratch state in its environment. */
  pids(): number[] {
    const marker = `XDG_STATE_HOME=${this.env.XDG_STATE_HOME}`;
    const found: number[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      try {
        const env = readFileSync(`/proc/${entry}/environ`, "latin1").split(
          "\0",
        );
        if (env.includes(marker)) found.push(Number(entry));
      } catch {}
    }
    return found;
  }

  /** The serving core process (holders respawn one after a crash). */
  corePid(): number | null {
    for (const pid of this.pids()) {
      try {
        const argv = readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0");
        if (argv[1] === "serve") return pid;
      } catch {}
    }
    return null;
  }

  /** `kill -9` of the core only: holders keep programs and start a new core. */
  killCore(): number {
    const pid = this.corePid();
    if (!pid) throw new Error("no scratch core is serving");
    process.kill(pid, "SIGKILL");
    return pid;
  }

  /** Ends everything this scratch core started and removes its files. */
  async dispose(): Promise<void> {
    for (let round = 0; round < 5; round++) {
      const pids = this.pids();
      if (pids.length === 0) break;
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await Bun.sleep(50);
    }
    this.serve = null;
    rmSync(this.root, { recursive: true, force: true });
  }
}
