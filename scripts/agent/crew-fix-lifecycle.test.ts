import { afterEach, expect, test } from "bun:test";
import { cleanupFixtures, fixture, reviewPost } from "./crew-round-fixture";
import { input, NOW, SHA } from "./gate/cases";
import { QUIET_MS } from "./crew/round-policy";
import { reviewCycles } from "./crew/round-policy-store";
import { addAction, getAction, setAction } from "./crew/store";

afterEach(cleanupFixtures);

test.each([false, true])(
  "a completed fix request reopens once when a later RESULT rejects the same cycle (legacy: %s)",
  (legacy) => {
    const f = fixture();
    const first = f
      .pass(f.value(SHA.reviewed))
      .find((action) => action.kind === "fix")!;
    expect(addAction(f.db, first, NOW)).toBe(true);
    setAction(f.db, first.key, "sent", NOW, null, true);
    f.reply();
    f.pass(f.value(SHA.reviewed), NOW + 1);
    expect(getAction(f.db, first.key)?.state).toBe("done");
    if (legacy) setAction(f.db, first.key, "done", NOW + 1);

    const rejected = input({
      head: SHA.reviewed,
      posts: [
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: "0/0 resolved, 1 new",
        },
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: "0/1 resolved, 1 new",
        },
      ],
    });
    const earlierReply = {
      id: "102",
      body: "[builder]\nrev2:101:1 fixed",
      at: NOW,
      url: "earlier-reply",
    };
    const laterResult = {
      ...reviewPost,
      id: "103",
      at: NOW + 60_000,
      body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/1 resolved, 1 new\nP3 src/widget.ts:20 incorrect fallback`,
    };
    f.setPosts([reviewPost, earlierReply, laterResult]);

    const preview = f
      .pass(rejected, NOW + 60_001, true)
      .find((action) => action.kind === "fix")!;
    expect(preview.key).toBe(first.key);
    expect(getAction(f.db, first.key)?.state).toBe("done");
    const reopened = f
      .pass(rejected, NOW + 60_001)
      .find((action) => action.kind === "fix")!;
    expect(reopened.text).toContain("rev2:101:1");
    expect(reopened.text).toContain("rev2:103:1");
    expect(addAction(f.db, reopened, NOW + 60_001)).toBe(true);
    expect(getAction(f.db, reopened.key)).toMatchObject({
      state: "pending",
      attempts: 0,
    });
    setAction(f.db, reopened.key, "sent", NOW + 60_002, null, true);

    for (const minutes of [2, 3, 4]) {
      const repeated = f
        .pass(rejected, NOW + minutes * QUIET_MS)
        .find((action) => action.kind === "fix")!;
      expect(addAction(f.db, repeated, NOW + minutes * QUIET_MS)).toBe(false);
      expect(getAction(f.db, reopened.key)).toMatchObject({
        state: "sent",
        attempts: 1,
      });
    }
    expect(reviewCycles(f.db, 7)).toHaveLength(1);

    f.setPosts([
      reviewPost,
      earlierReply,
      laterResult,
      {
        id: "104",
        at: NOW + 4 * QUIET_MS + 1,
        body: "[builder]\nrev2:101:1 fixed in bbbbbbb\nrev2:103:1 fixed in bbbbbbb",
        url: "fresh-reply",
      },
    ]);
    const next = f.pass(rejected, NOW + 4 * QUIET_MS + 2);
    expect(next.some((action) => action.kind === "fix")).toBe(false);
    expect(next.some((action) => action.kind === "confirm")).toBe(true);
    expect(getAction(f.db, reopened.key)?.state).toBe("done");
    expect(reviewCycles(f.db, 7).at(-1)?.ordinal).toBe(2);
  },
);
