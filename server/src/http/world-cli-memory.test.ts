import { expect, test } from "bun:test";
import { handleWorldCliEndpoint } from "./world-cli-endpoint";
import { MEMORY_LIMITS } from "../../../shared/memory";

test("memory edits fit the authenticated CLI body budget even with sixfold JSON escaping", async () => {
  let calls = 0;
  const content = "\u0001".repeat(MEMORY_LIMITS.file_bytes);
  const deps = {
    serverPort: 8790,
    platform: "other",
    bearerAuth: () => true as const,
    handle: async (body: unknown) => {
      calls++;
      expect((body as { params: { content: string } }).params.content).toBe(
        content,
      );
      return {
        ok: true as const,
        actor: { label: "local", verified: false },
        result: null,
      };
    },
  };
  const request = (command: string, text = content) =>
    new Request("http://127.0.0.1:8790/api/world/cli", {
      method: "POST",
      body: JSON.stringify({ command, params: { content: text } }),
    });
  const peer = { address: "127.0.0.1", port: 50000 };
  expect(
    (await handleWorldCliEndpoint(request("memory create"), peer, deps)).status,
  ).toBe(200);
  expect(calls).toBe(1);
  expect(
    (await handleWorldCliEndpoint(request("result"), peer, deps)).status,
  ).toBe(400);
  expect(calls).toBe(1);
  expect(
    (
      await handleWorldCliEndpoint(
        request("memory create", "x".repeat(2 * 1024 * 1024)),
        peer,
        deps,
      )
    ).status,
  ).toBe(400);
  expect(calls).toBe(1);
});
