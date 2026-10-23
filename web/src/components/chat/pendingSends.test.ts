import { expect, test } from "bun:test";
import { placedSends } from "./pendingSends";
import type { ConversationDelivery } from "../AgentChat";

const delivery = (
  extra: Partial<ConversationDelivery>,
): ConversationDelivery => ({
  id: "d1",
  text: "Run the tests",
  sent_at: "2026-10-23T12:00:00.000Z",
  state: "pending",
  expected: "claude session",
  fingerprint: "a".repeat(64),
  ...extra,
});

test("a pending send is placed by its time on the transcript host's clock", () => {
  // The host runs a minute behind: its turns are stamped a minute early, so
  // the send must be too, or it would sit below replies written after it.
  expect(
    placedSends(
      [delivery({ transcript_at: "2026-10-23T11:59:00.000Z" })],
      "claude",
      () => {},
    )[0]!.at,
  ).toBe("2026-10-23T11:59:00.000Z");
  // A host a minute ahead.
  expect(
    placedSends(
      [delivery({ transcript_at: "2026-10-23T12:01:00.000Z" })],
      "claude",
      () => {},
    )[0]!.at,
  ).toBe("2026-10-23T12:01:00.000Z");
  // A receipt from an older service keeps its local time.
  expect(placedSends([delivery({})], "claude", () => {})[0]!.at).toBe(
    "2026-10-23T12:00:00.000Z",
  );
});
