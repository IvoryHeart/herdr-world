import { expect, test } from "bun:test";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { AgentActivityCache } from "../world/agent-activity-cache";
import {
  FocusedAcquisition,
  type FocusedOwner,
} from "../world/focused-acquisition";
import { readFocusedList, readFocusedLists } from "../world/focused-lists";

test("two sockets share observer activity; fresh lists and new holders reuse its reading", async () => {
  let now = 0;
  const jobs = new Set<() => void>();
  const hosts = new Map(
    ["alpha", "beta"].map((id) => [
      id,
      {
        generation: 1,
        stats: 0,
        activity: 100,
        status: "idle",
        session: "one",
      },
    ]),
  );
  const pushes: { socket: string; owner: FocusedOwner; agents: unknown[] }[] =
    [];
  const cache = new AgentActivityCache({
    clock: { now: () => now, monotonic: () => now },
    active: (owner) => acquisition.holdersFor(owner).size > 0,
    changed(owner, agents) {
      for (const socket of acquisition.holdersFor(owner))
        pushes.push({ socket, owner, agents });
    },
  });
  const runtime = (id: string) => {
    const host = hosts.get(id)!;
    return {
      herdr: {
        async call(method: string) {
          if (method !== "agent.list") return {};
          return {
            agents: [
              {
                pane_id: "pane",
                terminal_id: "terminal",
                agent: "codex",
                agent_status: host.status,
                agent_session: { value: host.session },
              },
            ],
          };
        },
      },
      agentSessions: {
        async enrichActivity(result: any) {
          host.stats++;
          return {
            agents: result.agents.map((agent: object) => ({
              ...agent,
              last_activity_at: host.activity,
            })),
          };
        },
      },
      worktreeParents: {
        async enrichWorkspaceList(value: unknown) {
          return value;
        },
      },
      status: {
        async enrichWorkspacesWithGitStatus(value: unknown) {
          return value;
        },
      },
      terminalBridge: {
        async navigationMode() {
          return "shared";
        },
        async tabMoveSupported() {
          return true;
        },
        endpointAvailability() {
          return {};
        },
      },
    } as unknown as LegacyConnectionRuntime;
  };
  const context = (id = "alpha", force = false) => {
    const generation = hosts.get(id)!.generation;
    return {
      cache,
      owner: { connection_id: id, connection_generation: generation },
      isCurrent: () => hosts.get(id)!.generation === generation,
      force,
    };
  };
  const acquisition = new FocusedAcquisition<string>({
    scheduler: {
      schedule(callback) {
        jobs.add(callback);
        return { cancel: () => jobs.delete(callback) };
      },
    },
    released: (owner) => cache.clear(owner),
    lease(owner) {
      const host = hosts.get(owner.connection_id);
      if (!host || host.generation !== owner.connection_generation) return null;
      const activity = context(owner.connection_id, true);
      return {
        isCurrent: activity.isCurrent,
        read: () => readFocusedLists(runtime(owner.connection_id), activity),
      };
    },
    send: () => true,
  });
  const tick = async () => {
    now += 5000;
    await Promise.all(
      [...jobs].map(async (job) => {
        if (jobs.delete(job)) await job();
      }),
    );
  };
  try {
    acquisition.declare("one", { owners: [context().owner] });
    acquisition.declare("two", {
      owners: [context().owner, context("beta").owner],
    });
    expect(pushes).toEqual([]);
    await tick();
    expect(hosts.get("alpha")!.stats).toBe(1);
    expect(hosts.get("beta")!.stats).toBe(1);
    expect(
      pushes
        .map(({ socket, owner }) => `${socket}:${owner.connection_id}`)
        .sort(),
    ).toEqual(["one:alpha", "two:alpha", "two:beta"]);
    acquisition.declare("three", { owners: [context().owner] });
    expect(pushes).toHaveLength(3);
    hosts.get("alpha")!.status = "working";
    const reply = await readFocusedList(
      runtime("alpha"),
      "agent.list",
      {},
      context(),
    );
    expect(reply.agents[0]).toMatchObject({
      agent_status: "working",
      last_activity_at: 100,
    });
    expect(hosts.get("alpha")!.stats).toBe(1);
    hosts.get("alpha")!.activity = 200;
    await tick();
    expect(hosts.get("alpha")!.stats).toBe(2);
    expect(
      pushes
        .slice(3)
        .map(({ socket }) => socket)
        .sort(),
    ).toEqual(["one", "three", "two"]);
    acquisition.release("one");
    acquisition.release("three");
    hosts.get("beta")!.generation++;
    acquisition.reconcile();
    hosts.get("alpha")!.activity = 300;
    await tick();
    expect(pushes.at(-1)).toMatchObject({
      socket: "two",
      owner: context().owner,
      agents: [{ last_activity_at: 300 }],
    });
    expect(hosts.get("beta")!.stats).toBe(2);
    acquisition.release("two");
    const count = pushes.length;
    await tick();
    expect(pushes).toHaveLength(count);
    expect(jobs.size).toBe(0);
  } finally {
    acquisition.stop();
  }
});
