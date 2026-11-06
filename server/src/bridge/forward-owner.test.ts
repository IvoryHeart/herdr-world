import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createForwardRpcHandler } from "./forward-rpc";
import { createSshForwards } from "./ssh-forward";

test("forward list and close stay on the captured connection", async () => {
  const forwards = createSshForwards({
    isPortFree: () => true,
    spawn: () => {
      const exit = Promise.withResolvers<number>();
      return { exited: exit.promise, kill: () => exit.resolve(0) };
    },
  });
  const record = forwards.open({
    connectionId: "other",
    destination: "dev.example",
    port: 3100,
  });
  const replies: any[] = [];
  const handle = createForwardRpcHandler({
    connectionId: "mine",
    connectionGeneration: 2,
    sshHost: () => "dev.example",
    runProcess: async () => ({ stdout: "", stderr: "" }),
    forwards,
    safeSend: (_socket, payload) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError: () => {},
  });
  try {
    const socket = {} as ServerWebSocket<unknown>;
    await handle(socket, "list", "forward.list", {}, () => true);
    expect(replies.at(-1).result.forwards).toEqual([]);
    await handle(
      socket,
      "close",
      "forward.close",
      { id: record.id },
      () => true,
    );
    expect(forwards.list()).toHaveLength(1);
    await handle(
      socket,
      "retired",
      "forward.close",
      { id: record.id },
      () => false,
    );
    expect(forwards.list()).toHaveLength(1);
  } finally {
    forwards.closeAll();
  }
});

test("retiring an old generation never stops its replacement's forward", () => {
  const forwards = createSshForwards({
    isPortFree: () => true,
    spawn: () => {
      const exit = Promise.withResolvers<number>();
      return { exited: exit.promise, kill: () => exit.resolve(0) };
    },
  });
  try {
    const old = forwards.open({
      connectionId: "mine",
      connectionGeneration: 2,
      destination: "dev.example",
      port: 3100,
    });
    const next = forwards.open({
      connectionId: "mine",
      connectionGeneration: 3,
      destination: "dev.example",
      port: 3100,
    });
    forwards.loseConnection("mine", 2);
    expect(forwards.list()).toHaveLength(1);
    expect(forwards.list()[0].connectionGeneration).toBe(3);
    expect(forwards.list()[0].state).toBe("starting");
    expect(forwards.closeAttempt(old)).toBe(false);
    expect(forwards.closeAttempt(next)).toBe(true);
  } finally {
    forwards.closeAll();
  }
});

test("forward retirement waits for its owned process and escalates termination", async () => {
  const children: Array<{
    signals: Array<number | undefined>;
    exit: () => void;
  }> = [];
  const forwards = createSshForwards({
    isPortFree: () => true,
    stopTimeoutMs: 0,
    forceKillTimeoutMs: 100,
    spawn: () => {
      const exited = Promise.withResolvers<number>();
      const signals: Array<number | undefined> = [];
      children.push({ signals, exit: () => exited.resolve(0) });
      return {
        exited: exited.promise,
        kill: (signal?: number) => {
          signals.push(signal);
          if (signal === 9) exited.resolve(137);
        },
      };
    },
  });
  try {
    forwards.open({
      connectionId: "mine",
      connectionGeneration: 2,
      destination: "dev.example",
      port: 3100,
    });
    forwards.open({
      connectionId: "peer",
      connectionGeneration: 3,
      destination: "dev.example",
      port: 3200,
    });
    forwards.loseConnection("mine", 2);
    await forwards.drainConnection("mine", 2);
    expect(children[0].signals).toEqual([undefined, 9]);
    expect(children[1].signals).toEqual([]);
    expect(
      forwards.list().find((record) => record.connectionId === "peer")?.state,
    ).toBe("starting");
  } finally {
    forwards.closeAll();
    for (const child of children) child.exit();
    await forwards.drainConnection();
  }
});
