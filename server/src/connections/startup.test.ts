import { expect, test } from "bun:test";
import {
  bindListenerBeforeConnectionStart,
  describeListenerStartError,
} from "./startup";

test("occupied listener gives a recoverable port choice without changing it", () => {
  const error = describeListenerStartError(
    new Error("Failed to start server. Is port 8787 in use?"),
    "127.0.0.1",
    8787,
  );
  expect(error.message).toContain("127.0.0.1:8787");
  expect(error.message).toContain("--port");
  expect(error.message).toContain("herdr-world.env");
  expect(error.message).toContain("will not move");
  const other = new Error("bad TLS certificate");
  expect(describeListenerStartError(other, "127.0.0.1", 8787)).toBe(other);
});

test("listener remains available when downstream startup rejects", async () => {
  const events: string[] = [];
  let rejectStart!: (error: Error) => void;
  const start = new Promise<void>((_resolve, reject) => {
    rejectStart = reject;
  });
  let observedError = "";

  const listener = bindListenerBeforeConnectionStart({
    bindListener: () => {
      events.push("listener-bound");
      return {
        health: () => ({ ok: true }),
        bridgePing: () => ({ ok: true }),
      };
    },
    startConnection: () => {
      events.push("connection-started");
      return start;
    },
    onConnectionError: (error) => {
      observedError = (error as Error).message;
    },
  });

  expect(events).toEqual(["listener-bound", "connection-started"]);
  expect(listener.health()).toEqual({ ok: true });
  expect(listener.bridgePing()).toEqual({ ok: true });

  rejectStart(new Error("downstream unavailable"));
  await Promise.resolve();
  await Promise.resolve();
  expect(observedError).toBe("downstream unavailable");
  expect(listener.health()).toEqual({ ok: true });
});
