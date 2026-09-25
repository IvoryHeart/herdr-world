import { describe, expect, jest, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SemanticNotification } from "../bridge/semantic-notification";
import {
  createHerdrNotificationListener,
  parseTaskNotificationSource,
  taskEventFromSemanticNotification,
} from "./herdr-notification-listener";

function notification(
  over: Partial<SemanticNotification> = {},
): SemanticNotification {
  return {
    kind: "finished",
    title: "claude finished",
    body: "cvision",
    sound: "done",
    agent: "claude",
    workspaceId: "w1",
    tabId: "w1:t1",
    paneId: "w1:p1",
    ...over,
  };
}

describe("taskEventFromSemanticNotification", () => {
  test("maps agent transitions onto completed/blocked preferences", () => {
    expect(taskEventFromSemanticNotification(notification())).toEqual({
      kind: "completed",
      agent: "claude",
      title: "claude finished",
      body: "cvision",
      workspaceId: "w1",
      tabId: "w1:t1",
      paneId: "w1:p1",
    });
    expect(
      taskEventFromSemanticNotification(
        notification({ kind: "needs_attention", sound: "request" }),
      )?.kind,
    ).toBe("blocked");
  });

  test("uses the sound to classify pane-less custom alerts", () => {
    const custom = {
      kind: "custom" as const,
      body: null,
      agent: null,
      workspaceId: null,
      tabId: null,
      paneId: null,
    };
    expect(
      taskEventFromSemanticNotification(
        notification({ ...custom, title: "codex idle", sound: "done" }),
      ),
    ).toEqual({ kind: "completed", agent: "Agent", title: "codex idle" });
    expect(
      taskEventFromSemanticNotification(
        notification({ ...custom, title: "codex asks", sound: "request" }),
      )?.kind,
    ).toBe("blocked");
    expect(
      taskEventFromSemanticNotification(
        notification({ ...custom, title: "hello", sound: null }),
      )?.kind,
    ).toBe("completed");
  });

  test("drops Herdr update notices", () => {
    expect(
      taskEventFromSemanticNotification(
        notification({ kind: "update_installed" }),
      ),
    ).toBeNull();
  });
});

describe("parseTaskNotificationSource", () => {
  test("defaults to herdr and accepts status", () => {
    expect(parseTaskNotificationSource(undefined)).toBe("herdr");
    expect(parseTaskNotificationSource(" Status ")).toBe("status");
    expect(() => parseTaskNotificationSource("both")).toThrow(
      "Invalid notification source",
    );
  });
});

class FakeClient extends EventEmitter {
  closed = false;
  readonly connected = Promise.withResolvers<void>();
  connect() {
    return this.connected.promise;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

describe("createHerdrNotificationListener", () => {
  test("forwards notifications and reconnects with capped backoff", async () => {
    jest.useFakeTimers();
    try {
      const clients: FakeClient[] = [];
      const received: SemanticNotification[] = [];
      const errors: string[] = [];
      let connectedCount = 0;
      const listener = createHerdrNotificationListener({
        clientSocketPath: "/unused.sock",
        createClient: () => {
          const client = new FakeClient();
          clients.push(client);
          return client as never;
        },
        onNotification: (value) => received.push(value),
        onConnected: () => connectedCount++,
        onError: (error) => errors.push(error.message),
        initialRetryMs: 100,
        maxRetryMs: 250,
      });
      listener.start();
      expect(clients).toHaveLength(1);
      clients[0]!.connected.resolve();
      await Promise.resolve();
      expect(connectedCount).toBe(1);
      clients[0]!.emit("semantic_notification", notification());
      expect(received).toHaveLength(1);

      // Disconnect: retry after the initial delay.
      clients[0]!.close();
      expect(errors).toEqual(["Herdr notification shell disconnected"]);
      jest.advanceTimersByTime(99);
      expect(clients).toHaveLength(1);
      jest.advanceTimersByTime(1);
      expect(clients).toHaveLength(2);

      // Repeated failures double the delay up to the cap.
      clients[1]!.connected.reject(new Error("ENOENT"));
      await Promise.resolve();
      await Promise.resolve();
      expect(clients[1]!.closed).toBe(true);
      jest.advanceTimersByTime(200);
      expect(clients).toHaveLength(3);
      clients[2]!.emit("error", new Error("ECONNREFUSED"));
      jest.advanceTimersByTime(249);
      expect(clients).toHaveLength(3);
      jest.advanceTimersByTime(1);
      expect(clients).toHaveLength(4);

      // A stale client can no longer deliver.
      clients[0]!.emit("semantic_notification", notification());
      expect(received).toHaveLength(1);

      // A successful connect resets the delay.
      clients[3]!.connected.resolve();
      await Promise.resolve();
      expect(connectedCount).toBe(2);
      clients[3]!.close();
      jest.advanceTimersByTime(100);
      expect(clients).toHaveLength(5);

      listener.stop();
      expect(clients[4]!.closed).toBe(true);
      jest.advanceTimersByTime(10_000);
      expect(clients).toHaveLength(5);
      expect(listener.isRunning()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("stop cancels a pending retry and never reports its own close", () => {
    jest.useFakeTimers();
    try {
      const clients: FakeClient[] = [];
      const errors: string[] = [];
      const listener = createHerdrNotificationListener({
        clientSocketPath: "/unused.sock",
        createClient: () => {
          const client = new FakeClient();
          clients.push(client);
          return client as never;
        },
        onNotification: () => {},
        onError: (error) => errors.push(error.message),
        initialRetryMs: 100,
      });
      listener.start();
      listener.stop();
      expect(errors).toEqual([]);
      listener.start();
      clients[1]!.close();
      listener.stop();
      jest.advanceTimersByTime(1_000);
      expect(clients).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a throwing consumer does not break delivery", async () => {
    const client = new FakeClient();
    const errors: string[] = [];
    let calls = 0;
    const listener = createHerdrNotificationListener({
      clientSocketPath: "/unused.sock",
      createClient: () => client as never,
      onNotification: () => {
        calls++;
        throw new Error("consumer failed");
      },
      onError: (error) => errors.push(error.message),
    });
    listener.start();
    client.connected.resolve();
    await Promise.resolve();
    client.emit("semantic_notification", notification());
    client.emit("semantic_notification", notification());
    expect(calls).toBe(2);
    expect(errors).toEqual(["consumer failed", "consumer failed"]);
    expect(client.closed).toBe(false);
    listener.stop();
  });

  test("never opens a shell to a legacy server and re-checks availability", async () => {
    jest.useFakeTimers();
    try {
      const clients: FakeClient[] = [];
      const errors: string[] = [];
      let unavailable = 0;
      const answers: Array<boolean | Error> = [false, new Error("down"), true];
      const listener = createHerdrNotificationListener({
        clientSocketPath: "/unused.sock",
        createClient: () => {
          const client = new FakeClient();
          clients.push(client);
          return client as never;
        },
        isAvailable: async () => {
          const answer = answers.shift()!;
          if (answer instanceof Error) throw answer;
          return answer;
        },
        onUnavailable: () => unavailable++,
        onNotification: () => {},
        onError: (error) => errors.push(error.message),
        initialRetryMs: 100,
        maxRetryMs: 1_000,
      });
      listener.start();
      await Promise.resolve();
      expect(unavailable).toBe(1);
      expect(clients).toHaveLength(0);
      jest.advanceTimersByTime(999);
      await Promise.resolve();
      expect(errors).toEqual([]);
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(errors).toEqual(["down"]);
      expect(clients).toHaveLength(0);
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(clients).toHaveLength(1);
      listener.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  test("an availability answer after stop never opens a shell", async () => {
    const answer = Promise.withResolvers<boolean>();
    let created = 0;
    const listener = createHerdrNotificationListener({
      clientSocketPath: "/unused.sock",
      createClient: () => {
        created++;
        return new FakeClient() as never;
      },
      isAvailable: () => answer.promise,
      onNotification: () => {},
    });
    listener.start();
    listener.stop();
    listener.start();
    listener.stop();
    answer.resolve(true);
    await Bun.sleep(1);
    expect(created).toBe(0);
  });
});
