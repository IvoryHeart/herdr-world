import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionProfileStore } from "./profiles";

type Event = { name: string; data?: unknown };
const roots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) =>
          child.once("close", () => resolve()),
        );
      }
    }),
  );
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "registry-process-"));
  roots.push(home);
  const root = join(home, "data");
  mkdirSync(root, { mode: 0o700 });
  const config = join(home, ".config", "herdr-world");
  mkdirSync(config, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(config, "herdr-world.env"),
    "HOST=127.0.0.1\nPORT=19042\n",
  );
  const core = join(home, "state", "herdr-core", "default");
  mkdirSync(core, { recursive: true });
  writeFileSync(join(core, "core.lock"), join(home, "synthetic-core.sock"));
  return {
    home,
    root,
    store: new ConnectionProfileStore({ path: join(root, "connections.json") }),
  };
}
const profile = (id: string) => ({
  id,
  label: id,
  type: "local" as const,
  runtime: "herdr-core" as const,
  core_session: "default",
  core_state_dir: "",
  auto_connect: false,
});
async function seed(f: ReturnType<typeof fixture>) {
  await f.store.save({
    version: 2,
    default_connection_id: "alpha",
    profiles: [profile("alpha")],
  });
}
const add = (id: string) => ["add", id, "--core"];
function launch(
  f: ReturnType<typeof fixture>,
  options: {
    mode: "edit" | "startup";
    args?: string[];
    hold?: string;
    ownerRoot?: string;
    /** The contender's ownership wait expires in milliseconds, not seconds. */
    testTimings?: boolean;
  },
) {
  const child = spawn(
    process.execPath,
    [
      join(import.meta.dir, "testing/registry-process.ts"),
      JSON.stringify({ root: f.root, home: f.home, ...options }),
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: f.home,
        USERPROFILE: f.home,
        PATH: "",
        XDG_STATE_HOME: join(f.home, "state"),
        HC_SESSION: "default",
      },
    },
  );
  children.push(child);
  const events: Event[] = [];
  const waiters = new Set<() => void>();
  let pending = "";
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  child.stdout.on("data", (chunk) => {
    pending += String(chunk);
    const lines = pending.split("\n");
    pending = lines.pop()!;
    for (const line of lines)
      if (line.startsWith("@@")) events.push(JSON.parse(line.slice(2)));
    for (const wake of waiters) wake();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code);
      for (const wake of waiters) wake();
    });
  });
  return {
    child,
    events,
    exited,
    release: () => child.stdin.write("x"),
    async event(name: string): Promise<Event> {
      return new Promise<Event>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`fixture timed out at ${name}: ${errors}`));
        }, 15_000);
        const check = () => {
          const found = events.find((event) => event.name === name);
          if (found || child.exitCode !== null || child.signalCode !== null) {
            clearTimeout(timer);
            waiters.delete(check);
            if (found) resolve(found);
            else reject(new Error(`fixture exited before ${name}: ${errors}`));
          }
        };
        waiters.add(check);
        check();
      });
    },
  };
}
const ids = (f: ReturnType<typeof fixture>) =>
  f.store
    .load()!
    .profiles.map((p) => p.id)
    .sort();

for (const hold of ["snapshot", "save", "receipt"]) {
  test(`two real offline CLI processes retain successful additions while the first pauses at ${hold}`, async () => {
    const f = fixture();
    await seed(f);
    const a = launch(f, { mode: "edit", args: add("beta"), hold });
    await a.event(hold);
    const b = launch(f, { mode: "edit", args: add("gamma") });
    await b.event("cli-attempt");
    a.release();
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(ids(f)).toEqual(["alpha", "beta", "gamma"]);
  }, 20_000);
}
// Main's host verbs and the legacy profile verbs mutate the same registry.
for (const hostFirst of [false, true]) {
  test(`real offline host and profile edits accumulate with ${hostFirst ? "host" : "profile"} ownership first`, async () => {
    const f = fixture();
    await seed(f);
    const hostArgs = ["add", "runtime-fixture.example", "--preview-empty"];
    const a = launch(f, {
      mode: "edit",
      args: hostFirst ? hostArgs : add("beta"),
      hold: "snapshot",
    });
    await a.event("snapshot");
    const b = launch(f, {
      mode: "edit",
      args: hostFirst ? add("beta") : hostArgs,
    });
    await b.event("cli-attempt");
    a.release();
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(ids(f)).toEqual(["alpha", "beta"]);
    expect(
      f.store
        .load()
        ?.hosts?.some(
          (host) =>
            host.type === "ssh" &&
            host.ssh_destination === "runtime-fixture.example",
        ),
    ).toBe(true);
  }, 20_000);
}

test("a paused offline owner is never stolen after the contender's wait expires", async () => {
  const f = fixture();
  await seed(f);
  const a = launch(f, { mode: "edit", args: add("beta"), hold: "snapshot" });
  await a.event("snapshot");
  const b = launch(f, { mode: "edit", args: add("gamma"), testTimings: true });
  expect(await b.exited).toBe(1);
  expect(b.events.some((e) => e.name === "snapshot")).toBe(false);
  expect(ids(f)).toEqual(["alpha"]);
  a.release();
  expect(await a.exited).toBe(0);
  const retry = launch(f, { mode: "edit", args: add("gamma") });
  expect(await retry.exited).toBe(0);
  expect(ids(f)).toEqual(["alpha", "beta", "gamma"]);
}, 20_000);

for (const fresh of [false, true])
  for (const hold of ["snapshot", "save"]) {
    test(`startup after an offline ${fresh ? "first save" : "saved edit"} at ${hold} reads the acknowledged catalogue`, async () => {
      const f = fixture();
      if (!fresh) await seed(f);
      const a = launch(f, { mode: "edit", args: add("beta"), hold });
      await a.event(hold);
      const startup = launch(f, { mode: "startup", hold: "bootstrapped" });
      await startup.event("service-attempt");
      a.release();
      expect(await a.exited).toBe(0);
      const boot = await startup.event("bootstrapped");
      expect(boot.data).toEqual(fresh ? ["local", "beta"] : ["alpha", "beta"]);
      startup.release();
      expect(await startup.exited).toBe(0);
      expect(ids(f)).toContain("beta");
    }, 20_000);
  }
test("startup timeout releases its instance claim without replacing a paused CLI snapshot", async () => {
  const f = fixture();
  await seed(f);
  const edit = launch(f, { mode: "edit", args: add("beta"), hold: "snapshot" });
  await edit.event("snapshot");
  const startup = launch(f, { mode: "startup", testTimings: true });
  expect(await startup.exited).toBe(1);
  expect(existsSync(join(f.root, "instance.lock"))).toBe(false);
  expect(ids(f)).toEqual(["alpha"]);
  edit.release();
  expect(await edit.exited).toBe(0);
  const retry = launch(f, { mode: "startup", hold: "bootstrapped" });
  expect((await retry.event("bootstrapped")).data).toEqual(["alpha", "beta"]);
  retry.release();
  expect(await retry.exited).toBe(0);
}, 20_000);

for (const hold of ["service-attempt", "snapshot", "save", "bootstrapped"]) {
  test(`a CLI refuses a startup owner at ${hold} and succeeds after shutdown`, async () => {
    const f = fixture();
    const startup = launch(f, { mode: "startup", hold });
    await startup.event(hold);
    const edit = launch(f, { mode: "edit", args: add("beta") });
    expect(await edit.exited).toBe(1);
    expect(edit.events.some((e) => e.name === "snapshot")).toBe(false);
    startup.release();
    expect(await startup.exited).toBe(0);
    const retry = launch(f, { mode: "edit", args: add("beta") });
    expect(await retry.exited).toBe(0);
    expect(ids(f)).toEqual(["beta", "core-local"]);
  }, 20_000);
}
for (const hold of ["service-owned", "bootstrapped"]) {
  test(`a killed service owner at ${hold} releases registry ownership for the next CLI`, async () => {
    const f = fixture();
    await seed(f);
    const startup = launch(f, { mode: "startup", hold });
    await startup.event(hold);
    startup.child.kill("SIGKILL");
    await startup.exited;
    const edit = launch(f, { mode: "edit", args: add("beta") });
    expect(await edit.exited).toBe(0);
    expect(ids(f)).toEqual(["alpha", "beta"]);
  }, 20_000);
}
for (const hold of ["snapshot", "save", "receipt"]) {
  test(`a killed offline owner at ${hold} releases ownership without deleting the sidecar`, async () => {
    const f = fixture();
    await seed(f);
    const a = launch(f, { mode: "edit", args: add("beta"), hold });
    await a.event(hold);
    a.child.kill("SIGKILL");
    await a.exited;
    const b = launch(f, { mode: "edit", args: add("gamma") });
    expect(await b.exited).toBe(0);
    expect(ids(f)).toEqual(
      hold === "receipt" ? ["alpha", "beta", "gamma"] : ["alpha", "gamma"],
    );
  }, 20_000);
}
test("a live owner of an overridden registry in another data folder prevents offline edits", async () => {
  const f = fixture();
  await seed(f);
  const startup = launch(f, {
    mode: "startup",
    ownerRoot: join(f.home, "other-data"),
    hold: "bootstrapped",
  });
  await startup.event("bootstrapped");
  const edit = launch(f, {
    mode: "edit",
    args: add("beta"),
    testTimings: true,
  });
  expect(await edit.exited).toBe(1);
  expect(
    edit.events
      .filter((e) => e.name === "error")
      .map((e) => e.data)
      .join(),
  ).toContain("busy");
  expect(ids(f)).toEqual(["alpha"]);
  startup.release();
  expect(await startup.exited).toBe(0);
}, 20_000);

test("an invalid ownership file fails closed without changing the registry", async () => {
  const f = fixture();
  await seed(f);
  const lock = `${f.store.path}.ownership.sqlite`;
  writeFileSync(lock, "uncertain ownership", { mode: 0o600 });
  chmodSync(lock, 0o600);
  const edit = launch(f, { mode: "edit", args: add("beta") });
  expect(await edit.exited).toBe(1);
  expect(edit.events.some((e) => e.name === "snapshot")).toBe(false);
  expect(ids(f)).toEqual(["alpha"]);
});
