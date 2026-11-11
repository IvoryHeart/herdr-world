import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoreClient } from "./client";
import { memoryStreamPair } from "./stream";
import type { DeliveryRecording } from "./testing/capture-delivery";

const recording: DeliveryRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/delivery-0.1.20.json"),
    "utf8",
  ),
);
for (const split of [1, 7, 65536])
  test(`recorded native send and answer keys replay with ${split}-byte reads`, async () => {
    const [source, world] = memoryStreamPair();
    let stage = -1;
    source.onData((bytes) => {
      const current = stage++;
      if (current >= 0)
        expect(Buffer.from(bytes).toString("base64")).toBe(
          recording.steps[current]!.request,
        );
      const chunks =
        current < 0 ? [recording.hello] : recording.steps[current]!.response;
      for (const chunk of chunks) {
        const raw = Buffer.from(chunk, "base64");
        for (let offset = 0; offset < raw.length; offset += split)
          source.write(raw.subarray(offset, offset + split));
      }
    });
    const client = await CoreClient.open(world);
    try {
      expect(client.hello.version).toBe(recording.version);
      await expect(
        client.sendText("t1", "café ✓", { force: false }),
      ).rejects.toMatchObject({ kind: "blocked" });
      expect(recording.steps[1]!.outcome).toEqual(
        await client.sendText("t1", "café ✓", { force: true }),
      );
      expect(recording.steps[2]!.outcome).toEqual(
        await client.keys("t1", ["enter"]),
      );
    } finally {
      client.close();
    }
  });
