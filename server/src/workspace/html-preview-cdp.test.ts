import { expect, test } from "bun:test";
import {
  createPreviewCdp,
  PreviewSessionDetachedError,
} from "./html-preview-cdp.fixture";

function fixture() {
  const sent: { id: number; method: string; sessionId?: string }[] = [];
  const detached = new Set<string>();
  const client = createPreviewCdp((message) => {
    const command = JSON.parse(message);
    sent.push(command);
    // Behave like Chrome if a stale continuation reaches the wire.
    if (detached.has(command.sessionId))
      queueMicrotask(() =>
        client.receive({ id: command.id, error: missingSession }),
      );
  });
  const attach = (sessionId: string) =>
    client.receive({
      method: "Target.attachedToTarget",
      params: { sessionId },
    });
  const detach = (sessionId: string) => {
    detached.add(sessionId);
    client.receive({
      method: "Target.detachedFromTarget",
      params: { sessionId },
    });
  };
  const reply = (index: number, result = {}) =>
    client.receive({ id: sent[index]!.id, result });
  return { ...client, sent, attach, detach, reply };
}

const missingSession = {
  code: -32001,
  message: "Session with given id not found.",
};

test("detach between setup replies and resume cancels the stale continuation", async () => {
  const client = fixture();
  client.attach("canary");
  const setup = Promise.all([
    client.cdp("Runtime.enable", {}, "canary"),
    client.cdp("Fetch.enable", {}, "canary"),
  ]).then(() => client.cdp("Runtime.runIfWaitingForDebugger", {}, "canary"));

  client.reply(0);
  client.reply(1);
  client.detach("canary");
  await expect(setup).rejects.toBeInstanceOf(PreviewSessionDetachedError);
  expect(client.sent.map((command) => command.method)).toEqual([
    "Runtime.enable",
    "Fetch.enable",
  ]);
});

test("detach cancels in-flight setup without waiting for a protocol reply", async () => {
  const client = fixture();
  client.attach("canary");
  const setup = Promise.all([
    client.cdp("Runtime.enable", {}, "canary"),
    client.cdp("Fetch.enable", {}, "canary"),
  ]);
  client.detach("canary");
  await expect(setup).rejects.toBeInstanceOf(PreviewSessionDetachedError);
});

test("detach retires only its own fetch work and ignores late replies", async () => {
  const client = fixture();
  client.attach("old-frame");
  client.attach("current-frame");
  const retired = client.cdp("Fetch.fulfillRequest", {}, "old-frame");
  const current = client.cdp("Fetch.fulfillRequest", {}, "current-frame");
  const root = client.cdp("Page.navigate");
  client.detach("old-frame");
  await expect(retired).rejects.toBeInstanceOf(PreviewSessionDetachedError);
  client.receive({ id: client.sent[0]!.id, error: missingSession });
  client.reply(1, { fulfilled: true });
  client.reply(2, { navigated: true });
  expect(await current).toEqual({ fulfilled: true });
  expect(await root).toEqual({ navigated: true });
  await expect(
    client.cdp("Fetch.fulfillRequest", {}, "old-frame"),
  ).rejects.toBeInstanceOf(PreviewSessionDetachedError);
  expect(client.sent).toHaveLength(3);
});

test.each([undefined, "live-frame"])(
  "missing-session errors without a matching detach still fail (%s)",
  async (sessionId) => {
    const client = fixture();
    client.attach("other-frame");
    client.detach("other-frame");
    if (sessionId) client.attach(sessionId);
    const request = client.cdp("Fetch.enable", {}, sessionId);
    client.receive({ id: client.sent[0]!.id, error: missingSession });
    await expect(request).rejects.toThrow(JSON.stringify(missingSession));
    await expect(request).rejects.not.toBeInstanceOf(
      PreviewSessionDetachedError,
    );
  },
);

test("a protocol failure before detach is not reclassified as cancellation", async () => {
  const client = fixture();
  client.attach("frame");
  const request = client.cdp("Fetch.enable", {}, "frame");
  const error = { code: -32602, message: "Invalid parameters" };
  client.receive({ id: client.sent[0]!.id, error });
  client.detach("frame");
  await expect(request).rejects.toThrow(JSON.stringify(error));
  await expect(request).rejects.not.toBeInstanceOf(PreviewSessionDetachedError);
});

test("connection loss fails both root and child commands", async () => {
  const client = fixture();
  client.attach("frame");
  const root = client.cdp("Page.navigate");
  const child = client.cdp("Fetch.enable", {}, "frame");
  const failures = Promise.allSettled([root, child]);
  client.close();
  for (const result of await failures) {
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected")
      throw new Error("Expected connection loss");
    expect(result.reason.message).toBe("CDP connection closed");
    expect(result.reason).not.toBeInstanceOf(PreviewSessionDetachedError);
  }
  await expect(child).rejects.not.toBeInstanceOf(PreviewSessionDetachedError);
  await expect(client.cdp("Page.navigate")).rejects.toThrow(
    "CDP connection closed",
  );
  expect(client.sent).toHaveLength(2);
});
