import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdeForward, IdeHostRun } from "../server/src/ide/hosts";
import type { IdeDetectEnvironment } from "../server/src/ide/providers";
import { type IdeConnection, IdeService } from "../server/src/ide/service";
import { memoryIdeSettingsStore } from "../server/src/ide/settings";

/**
 * Replays `quint/ide-lifecycle.qnt` behaviours through World's real IDE
 * service and instance list (#1009). The host side is the model's: each
 * host script World sends is held until the trace answers it, with the
 * answer the model's host gave (or a lost reply). After every step World's
 * side must match the model: which script each folder waits on, each
 * entry's state and Stop, and the streams its routes carry.
 */

type Op = { name: string; slot: number; arg: string };
type Script = { kind: string; ph: number; out: string; inc: number };
type ModelState = {
  q: Map<number, Script>;
  ls: Map<number, Script>;
  w: Map<number, string>;
  stopping: Map<number, boolean>;
  hinc: Map<number, number>;
  proc: number[][];
  streams: { slot: number; att: number; inc: number; gen: number }[];
  cgen: Map<number, number>;
};
export type IdeStep = { st: ModelState; op: Op };

/** ITF with the maps, tuples and records this model uses. */
export function decodeIdeItf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeIdeItf);
  if (value === null || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if ("#bigint" in v) return Number(v["#bigint"]);
  if ("#set" in v) return (v["#set"] as unknown[]).map(decodeIdeItf);
  if ("#tup" in v) return (v["#tup"] as unknown[]).map(decodeIdeItf);
  if ("#map" in v)
    return new Map(
      (v["#map"] as [unknown, unknown][]).map(([key, entry]) => [
        decodeIdeItf(key),
        decodeIdeItf(entry),
      ]),
    );
  return Object.fromEntries(
    Object.entries(v)
      .filter(([key]) => key !== "#meta")
      .map(([key, entry]) => [key, decodeIdeItf(entry)]),
  );
}

export function ideSteps(itf: { states: unknown[] }): IdeStep[] {
  const steps = decodeIdeItf(itf.states) as IdeStep[];
  assert(Array.isArray(steps) && steps.length > 1, "empty IDE trace");
  for (const step of steps) {
    assert(step.st.w instanceof Map && step.st.q instanceof Map);
    assert(typeof step.op.name === "string");
  }
  return steps;
}

const PROVIDER = "code-server";
const WORLD_ID = "world-model-aaaaaaaaaaaa";
const SSH_DESTINATION = "dev@devbox.example";
const LOOK_MS = 200;
const PROBE_MS = 100;

type Pending = {
  slot: number;
  kind: "start" | "attach" | "list" | "stop";
  resolve(result: { code: number; stdout: string; stderr: string }): void;
};

/** One World process: its service and what it waits on. */
type World = {
  service: IdeService;
  runs: Pending[];
  looks: (() => void)[];
  probes: (() => void)[];
  forward: { slot: number; drop(): void } | null;
  streams: { id: string; inc: number }[];
  ready: Set<string>;
};

function kindOf(script: string): Pending["kind"] {
  const kinds = (
    [
      ["start", "echo result=started"],
      ["list", "pending="],
      ["stop", 'echo "result=$r"'],
      ["attach", "state=stopping"],
    ] as const
  ).filter(([, marker]) => script.includes(marker));
  assert.equal(kinds.length, 1, "unrecognised IDE host script");
  return kinds[0]![0];
}

/** Replay one model behaviour through World's IDE service. */
export async function replayIdeTrace(steps: IdeStep[]) {
  const top = mkdtempSync(join(tmpdir(), "world-ide-model-"));
  try {
    return await replay(steps, top);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}

async function replay(steps: IdeStep[], top: string) {
  const folders = [join(top, "project-a"), "/srv/project-b"];
  mkdirSync(folders[0]!, { recursive: true });
  const program = join(top, "code-server");
  writeFileSync(program, "");
  const hostRoots = [join(top, "host-local"), join(top, "host-ssh")];
  const connections = new Map<number, IdeConnection>([
    [
      0,
      { id: "local-a", label: "This computer", type: "local", generation: 1 },
    ],
    [
      1,
      {
        id: "ssh-b",
        label: "devbox",
        type: "ssh",
        generation: 1,
        sshDestination: SSH_DESTINATION,
      },
    ],
  ]);
  const settings = memoryIdeSettingsStore({
    version: 1,
    world_id: WORLD_ID,
    providers: {
      [PROVIDER]: { enabled: true, trusted_at: "x", binary: program },
    },
  });
  const environment: IdeDetectEnvironment = {
    platform: "linux",
    which: () => null,
    exists: () => true,
    realpath: (path) => path,
    isExecutableFile: (path) => path === program,
    version: async () => "4.0.0",
    homeDir: "",
  };
  const idOf = (slot: number) =>
    world.service.instances
      .list()
      .find((entry) => entry.folder === folders[slot])?.id;

  const makeWorld = (): World => {
    const self: World = {
      service: null as unknown as IdeService,
      runs: [],
      looks: [],
      probes: [],
      forward: null,
      streams: [],
      ready: new Set(),
    };
    const run: IdeHostRun = (target, script) =>
      new Promise((resolve) =>
        self.runs.push({
          slot: target.kind === "ssh" ? 1 : 0,
          kind: kindOf(script),
          resolve,
        }),
      );
    const forward: IdeForward = (_destination, _remote, localSocket) => {
      writeFileSync(localSocket, "");
      let drop = () => {};
      const exited = new Promise<unknown>((resolve) => {
        drop = () => resolve(null);
      });
      const handle = { slot: 1, drop: () => drop() };
      self.forward = handle;
      return {
        exited,
        kill: () => {
          if (self.forward === handle) self.forward = null;
        },
      };
    };
    self.service = new IdeService({
      settings,
      environment,
      localRoot: join(top, "data"),
      instanceOptions: {
        run,
        forward,
        probe: async (upstream) =>
          self.ready.has(upstream.instanceId) ? 200 : null,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            assert(ms === LOOK_MS || ms === PROBE_MS, `unexpected wait ${ms}`);
            (ms === LOOK_MS ? self.looks : self.probes).push(resolve);
          }),
        now: () => new Date("2026-11-22T10:00:00.000Z"),
        maxInstances: 1,
        stopGraceMs: 10,
      },
      connection: (id) =>
        [...connections.values()].find((entry) => entry.id === id) ?? null,
      connectionIds: () => [...connections.values()].map((entry) => entry.id),
      remoteDetect: async (_destination, provider) => ({
        provider,
        state: "detected",
        path: program,
        version: "4.0.0",
        configured: false,
      }),
    });
    self.service.onRevoked((id) => {
      self.streams = self.streams.filter((stream) => stream.id !== id);
    });
    return self;
  };
  let world = makeWorld();

  // Lets World run until it waits on a host, a probe or a person; waits
  // between looks at a starting server pass at once.
  const settle = async () => {
    for (let round = 0; round < 40; round++) {
      await new Promise((resolve) => setImmediate(resolve));
      for (const look of world.looks.splice(0)) look();
    }
  };
  const take = (slot: number, list: boolean) => {
    const index = world.runs.findIndex(
      (entry) => entry.slot === slot && (entry.kind === "list") === list,
    );
    assert(index >= 0, `World sent no ${list ? "list" : "script"} for ${slot}`);
    return world.runs.splice(index, 1)[0]!;
  };
  const answer = (slot: number, pending: Pending, out: string, inc: number) => {
    const id = idOf(slot) ?? "";
    const root = hostRoots[slot]!;
    if (out === "started" || out === "running") {
      mkdirSync(join(root, id), { recursive: true });
      writeFileSync(join(root, id, "ide.sock"), "");
    }
    const lines =
      pending.kind === "start"
        ? out === "voided"
          ? null
          : [`result=${out}`, `root=${root}`]
        : pending.kind === "attach"
          ? out === "running"
            ? ["state=running", `root=${root}`, "token=t", `inc=${inc}`]
            : out === "exited"
              ? ["state=exited", "exit=1"]
              : [`state=${out}`]
          : [`result=${out}`];
    pending.resolve(
      lines
        ? { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" }
        : { code: 93, stdout: "", stderr: "" },
    );
  };
  const listed = (slot: number, out: string) => {
    const id = world.service.instances.idFor({
      connectionId: connections.get(slot)?.id ?? (slot ? "ssh-b" : "local-a"),
      provider: PROVIDER,
      folder: folders[slot]!,
      ...(slot ? { sshDestination: SSH_DESTINATION } : {}),
    });
    if (out === "pending") return `pending=${id}\n`;
    if (out !== "seen" && out !== "exited") return "";
    return `${[
      `id=${id}`,
      `provider=${PROVIDER}`,
      `folder=${folders[slot]}`,
      `connection=${slot ? "ssh-b" : "local-a"}`,
      "started=2026-11-22T10:00:00.000Z",
      `state=${out === "seen" ? "running" : "exited"}`,
      ...(out === "exited" ? ["exit=1"] : []),
      "end",
    ].join("\n")}\n`;
  };

  const compare = (index: number, st: ModelState) => {
    const where = (what: string) =>
      `step ${index} (${steps[index]!.op.name} ${steps[index]!.op.slot} ${steps[index]!.op.arg}): ${what}`;
    for (const slot of [0, 1]) {
      const id = idOf(slot);
      const entry = id ? world.service.instances.get(id) : null;
      assert.equal(
        entry?.state ?? "none",
        st.w.get(slot),
        where(`state of ${slot}`),
      );
      assert.equal(
        entry?.stopping === true,
        st.stopping.get(slot) === true,
        where(`Stop of ${slot}`),
      );
      const q = st.q.get(slot)!;
      const waiting = world.runs
        .filter((entry) => entry.slot === slot && entry.kind !== "list")
        .map((entry) => entry.kind);
      assert.deepEqual(
        waiting,
        q.kind === "none" ? [] : [q.kind],
        where(`script World waits on for ${slot}`),
      );
      const lists = world.runs.filter(
        (entry) => entry.slot === slot && entry.kind === "list",
      ).length;
      assert.equal(
        lists,
        st.ls.get(slot)!.kind === "none" ? 0 : 1,
        where(`list of ${slot}`),
      );
      assert.equal(
        world.streams.filter((stream) => stream.id === id).length,
        st.streams.filter((stream) => stream.slot === slot).length,
        where(`streams of ${slot}`),
      );
    }
  };

  compare(0, steps[0]!.st);
  for (let index = 1; index < steps.length; index++) {
    const { op } = steps[index]!;
    const before = steps[index - 1]!.st;
    const after = steps[index]!.st;
    const slot = op.slot;
    const service = world.service;
    switch (op.name) {
      case "open": {
        const connection = connections.get(slot)!;
        void service.open({
          provider: PROVIDER,
          connectionId: connection.id,
          generation: connection.generation,
          folder: folders[slot],
        });
        break;
      }
      case "stop":
        void service.stop(idOf(slot));
        break;
      case "forget":
        assert.deepEqual(service.forget(idOf(slot)), { ok: true });
        break;
      case "stopByHand": {
        const id = idOf(slot);
        const entry = id ? service.instances.get(id) : null;
        assert(entry, "nothing listed to stop by hand");
        const shown = await serviceListed(service, entry);
        assert(shown.unreachable && shown.stopByHand?.includes(id!));
        break;
      }
      case "reply": {
        const pending = take(slot, false);
        assert.equal(pending.kind, before.q.get(slot)!.kind);
        answer(slot, pending, op.arg, before.q.get(slot)!.inc);
        break;
      }
      case "lose":
        take(slot, false).resolve({ code: 255, stdout: "", stderr: "" });
        break;
      case "listReply":
        take(slot, true).resolve({
          code: 0,
          stdout: listed(slot, op.arg),
          stderr: "",
        });
        break;
      case "listLose":
        take(slot, true).resolve({ code: 255, stdout: "", stderr: "" });
        break;
      case "ready": {
        const id = idOf(slot)!;
        world.ready.add(id);
        for (const probe of world.probes.splice(0)) probe();
        await settle();
        world.ready.delete(id);
        break;
      }
      case "request": {
        const id = idOf(slot)!;
        const upstream = service.upstream(id);
        if (op.arg === "stale")
          assert.equal(upstream, null, "stale route served");
        else {
          assert(upstream, "ready route refused");
          world.streams.push({ id, inc: after.hinc.get(slot)! });
        }
        break;
      }
      case "crash": {
        const gone = before.proc.find(
          ([s, inc]) =>
            s === slot && !after.proc.some(([t, j]) => t === s && j === inc),
        )!;
        const id = idOf(slot);
        world.streams = world.streams.filter(
          (stream) => !(stream.id === id && stream.inc === gone[1]),
        );
        break;
      }
      case "reconnect":
        connections.get(slot)!.generation = after.cgen.get(slot)!;
        void service.reconcile();
        break;
      case "poll":
        void service.reconcile(op.arg === "refresh");
        break;
      case "removeConn":
        connections.delete(1);
        void service.reconcile();
        service.connectionRemoved("ssh-b");
        break;
      case "disable":
        void service.disable(PROVIDER);
        break;
      case "enable":
        void service.enable(PROVIDER, { trust: true });
        break;
      case "forwardDrop":
        assert(world.forward, "no forward to drop");
        world.forward.drop();
        break;
      case "restart":
        // The old World is gone: what it waited on never answers.
        service.closeAll();
        world = makeWorld();
        break;
      case "hostStep":
      case "listStep":
      case "ghostStep":
      case "ghostDie":
        break;
      default:
        assert.fail(`unknown IDE step ${op.name}`);
    }
    await settle();
    compare(index, after);
  }
  return { steps: steps.length };
}

/** What the Code view lists for one entry (unreachable, how to stop by hand). */
async function serviceListed(
  service: IdeService,
  entry: NonNullable<ReturnType<IdeService["instances"]["get"]>>,
) {
  const listed = (
    service as unknown as {
      listed(view: typeof entry): { unreachable?: string; stopByHand?: string };
    }
  ).listed(entry);
  return listed;
}

type WitnessOp = { name: string; slot: number; arg: string };

/** The model calls one step of a recorded behaviour makes. */
function call(op: WitnessOp) {
  const { name, slot, arg } = op;
  if (name === "lose") return `loseAs(${slot}, ${arg === "ghost"})`;
  if (name === "restart")
    return `restartAs(${arg.includes("0")}, ${arg.includes("1")})`;
  if (name === "poll") return `poll(${arg === "refresh"})`;
  if (["removeConn", "disable", "enable", "forwardDrop"].includes(name))
    return name;
  return `${name}(${slot})`;
}

/**
 * The model, driven through one recorded behaviour step by step: Quint
 * exports it as ITF for replay (TLC reports its counterexamples only as
 * text).
 */
export function scriptedIdeModel(source: string, ops: readonly WitnessOp[]) {
  const end = source.lastIndexOf("}");
  const steps = ops
    .map((op, index) => `      all { witnessAt == ${index}, ${call(op)} },`)
    .join("\n");
  return `${source.slice(0, end)}
  var witnessAt: int
  action witnessInit = all { init, witnessAt' = 0 }
  action witnessStep = all {
    witnessAt' = witnessAt + 1,
    any {
${steps}
    },
  }
}
`;
}

const op = (name: string, slot = 1, arg = ""): WitnessOp => ({
  name,
  slot,
  arg,
});

/**
 * Counterexamples the model found in the first design (TLC, one SSH
 * folder), each with the flag that restores that design and the
 * implementation fault that takes the fix back out of World.
 */
export const ideCounterexamples = {
  // An Open queued behind a Stop ran after the SSH connection was removed:
  // it started a server on the removed host after the person stopped it
  // by hand, and Forget then hid it.
  "queued-open": {
    flag: "OLD_QUEUE",
    fault: "ide-queue",
    ops: [
      op("open"),
      op("stop"),
      op("lose", 1, "dead"),
      op("open"),
      op("hostStep"),
      op("removeConn"),
      op("stopByHand"),
      op("reply", 1, "gone"),
      op("hostStep"),
      op("hostStep"),
      op("hostStep"),
      op("lose", 1, "dead"),
      op("forget"),
    ],
  },
  // A list sent before a start answered "absent"; the start's reply was
  // lost, and the old list deleted the entry while its server ran.
  "start-epoch": {
    flag: "OLD_START_EPOCH",
    fault: "ide-start-epoch",
    ops: [
      op("open"),
      op("open"),
      op("lose", 1, "dead"),
      op("hostStep"),
      op("poll", -1),
      op("listStep"),
      op("reply", 1, "gone"),
      op("hostStep"),
      op("hostStep"),
      op("hostStep"),
      op("lose", 1, "dead"),
      op("listReply", 1, "absent"),
    ],
  },
} as const;
