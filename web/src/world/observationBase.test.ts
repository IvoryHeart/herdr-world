import { expect, test } from "bun:test";
import { observationFixture } from "./testing/observationFixture";
import { countedWorldWork } from "./testing/countedWorldWork";

test("negotiated unchanged replies retain hosts and publish and prepare nothing", async () => {
  const { store, calls } = observationFixture();
  await store.refresh();
  const held = store.get();
  let published = 0;
  store.subscribe(() => published++);
  const work = await countedWorldWork(() => store.refresh());
  expect(calls[1]!.base).toMatchObject({
    service_incarnation: "synthetic-service",
    hosts: [
      { connection_id: "alpha", generation: 1 },
      { connection_id: "beta", generation: 1 },
    ],
  });
  expect(store.get()).toBe(held);
  expect(published).toBe(0);
  expect(work).toEqual({});
});

test("one changed host replaces whole and retains its unchanged sibling", async () => {
  const { store, raw } = observationFixture();
  await store.refresh();
  const held = store.get().connections;
  raw.connections[0]!.snapshot!.panes[0]!.agent_status = "blocked";
  await store.refresh();
  expect(store.get().connections[0]).not.toBe(held[0]);
  expect(store.get().connections[1]).toBe(held[1]);
  expect(store.get().connections[0]!.snapshot!.panes[0]!.agent_status).toBe(
    "blocked",
  );
});

test("foreign incarnation replaces retained content and a reply from the prior incarnation is rejected", async () => {
  const { store, client, restart } = observationFixture();
  await store.refresh();
  const held = store.get().connections[0];
  const read = client.call;
  const old = await read("world.snapshot");
  restart();
  client.call = async () => old;
  await store.refresh();
  expect(store.get().status).toBe("error");
  expect(store.get().connections.every((host) => !host.actionable)).toBe(true);
  client.call = read;
  await store.refresh();
  expect(store.get().serviceIncarnation).toBe("replacement-service");
  expect(store.get().connections[0]!.snapshot).not.toBe(held!.snapshot);
});

test("a lost base discards the whole reply and follows once with a complete request", async () => {
  const { store, client, calls } = observationFixture();
  await store.refresh();
  const read = client.call;
  const arrived = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let held = true;
  client.call = async (method, params) => {
    const response = await read(method, params);
    if (held) {
      held = false;
      arrived.resolve();
      await release.promise;
    }
    return response;
  };
  let published = 0;
  store.subscribe(() => published++);
  const pending = store.refresh();
  await arrived.promise;
  store.get().connections = [];
  release.resolve();
  await pending;
  expect(calls).toHaveLength(3);
  expect(calls[1]).toHaveProperty("base");
  expect(calls[2]).not.toHaveProperty("base");
  expect(published).toBe(1);
  expect(store.get().connections).toHaveLength(2);
});

test.each([
  "invalid World snapshot base",
  "invalid World observation base",
  "unsupported World observation base",
  "invalid World snapshot parameters",
])(
  "a refused base (%s) falls back once and stays disabled only for that hello",
  async (message) => {
    const { store, client, calls } = observationFixture();
    await store.refresh();
    const read = client.call;
    let refused = 0;
    client.call = async (method, params) => {
      if (params?.base && refused++ === 0) {
        calls.push(params);
        throw new Error(message);
      }
      return read(method, params);
    };
    await store.refresh();
    await store.refresh();
    expect(calls[1]).toHaveProperty("base");
    expect(calls[2]).not.toHaveProperty("base");
    expect(calls[3]).not.toHaveProperty("base");
    client.hello = { ...client.hello };
    await store.refresh();
    expect(calls[4]).toHaveProperty("base");
  },
);

test("unnegotiated clients retain complete snapshot behavior", async () => {
  const { store, client, calls } = observationFixture();
  client.hello.capabilities.world_observation_v1 = false;
  await store.refresh();
  await store.refresh();
  expect(calls.every((params) => !("base" in params))).toBe(true);
  expect(store.get().status).toBe("ready");
});

test("a confirmation cannot resurrect a generation retired during the request", async () => {
  const f = observationFixture();
  await f.store.refresh();
  f.store.start();
  try {
    const read = f.client.call;
    const arrived = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    f.client.call = async (method, params) => {
      const response = await read(method, params);
      arrived.resolve();
      await release.promise;
      return response;
    };
    const pending = f.store.refresh();
    await arrived.promise;
    f.live.set("alpha", false);
    f.control({
      type: "world_invalidated",
      connection_id: "alpha",
      connection_generation: 2,
      connection_state: "reconnecting",
    });
    release.resolve();
    await pending;
    expect(f.store.get().connections[0]).toMatchObject({
      generation: 2,
      actionable: false,
      stale: true,
    });
    expect(f.store.get().connections[1]!.actionable).toBe(true);
  } finally {
    f.store.stop();
  }
});

test.each(["token", "metadata", "duplicate", "null-token"])(
  "malformed %s reply fails without partial admission",
  async (mode) => {
    const f = observationFixture();
    await f.store.refresh();
    const read = f.client.call;
    f.client.call = async (method) => {
      const reply = (await read(method, {})) as any;
      if (mode === "token") reply.connections[0].token = "";
      if (mode === "metadata") reply.connections[0].generation = -1;
      if (mode === "duplicate") reply.connections.push(reply.connections[0]);
      if (mode === "null-token") reply.connections[0].token = null;
      return reply;
    };
    await f.store.refresh();
    expect(f.store.get().status).toBe("error");
    expect(f.store.get().connections).toHaveLength(2);
    expect(f.store.get().connections.every((host) => !host.actionable)).toBe(
      true,
    );
  },
);

test.each([
  "temporary read failure",
  "database is temporarily locked",
  "unsupported database operation",
  "parameter storage unavailable",
])(
  "a transient based-call failure (%s) does not disable negotiated bases",
  async (message) => {
    const f = observationFixture();
    await f.store.refresh();
    const read = f.client.call;
    let fail = true;
    f.client.call = async (method, params) => {
      if (fail) {
        fail = false;
        f.calls.push(params ?? {});
        throw new Error(message);
      }
      return read(method, params);
    };
    await f.store.refresh();
    expect(f.store.get().status).toBe("error");
    await f.store.refresh();
    expect(f.store.get().status).toBe("ready");
    expect(f.calls).toHaveLength(3);
    expect(f.calls[1]).toHaveProperty("base");
    expect(f.calls[2]).toHaveProperty("base");
  },
);

test("a hello incarnation change during a read rejects the old reply independently of disconnect", async () => {
  const f = observationFixture();
  await f.store.refresh();
  const read = f.client.call;
  const arrived = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.client.call = async (method, params) => {
    const response = await read(method, params);
    arrived.resolve();
    await release.promise;
    return response;
  };
  const pending = f.store.refresh();
  await arrived.promise;
  f.restart();
  release.resolve();
  await pending;
  expect(f.store.get().status).toBe("error");
  expect(f.store.get().connections.every((host) => !host.actionable)).toBe(
    true,
  );
});

test("new incarnation drops old runtime-health generations before admitting generation one", async () => {
  const f = observationFixture();
  await f.store.refresh();
  f.store.start();
  try {
    f.control({
      type: "world_invalidated",
      connection_id: "alpha",
      connection_generation: 2,
      connection_state: "reconnecting",
    });
    f.restart();
    await f.store.refresh();
    expect(f.store.get().connections[0]).toMatchObject({
      generation: 1,
      snapshotGeneration: 1,
      actionable: true,
      stale: false,
    });
  } finally {
    f.store.stop();
  }
});
