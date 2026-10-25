import { describe, expect, test } from "bun:test";
import { createHerdrInfoHandler } from "./herdr-info";

describe("Herdr server information", () => {
  test("returns only the connected server identity", async () => {
    const { handleHerdrInfo } = createHerdrInfoHandler({
      ping: async () => ({ version: "0.7.4", protocol: 16 }),
    });

    const response = await handleHerdrInfo();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "0.7.4", protocol: 16 });
  });

  test("does not hide connection or malformed-response failures", async () => {
    const unavailable = createHerdrInfoHandler({
      ping: async () => {
        throw new Error("Herdr is unavailable");
      },
    });
    const malformed = createHerdrInfoHandler({
      ping: async () => ({ version: "", protocol: 0 }),
    });

    expect((await unavailable.handleHerdrInfo()).status).toBe(503);
    expect((await malformed.handleHerdrInfo()).status).toBe(503);
  });
});
