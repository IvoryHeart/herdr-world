import { expect, test } from "bun:test";
import { browserCapacity } from "./browser-capacity";

test("context admission transfers one slot once and closes queued work", async () => {
  const capacity = browserCapacity(1);
  const release = await capacity.acquire();
  let admitted = false;
  const second = capacity.acquire().then((release) => {
    admitted = true;
    return release;
  });
  await Promise.resolve();
  expect(admitted).toBe(false);
  release();
  release();
  const releaseSecond = await second;
  const third = capacity.acquire();
  capacity.close();
  await expect(third).rejects.toThrow("Browser closed");
  await expect(capacity.acquire()).rejects.toThrow("Browser closed");
  releaseSecond();
});

test("closing after a slot transfer refuses admission before context creation", async () => {
  const capacity = browserCapacity(1);
  const release = await capacity.acquire();
  const transferred = capacity.acquire();
  release();
  capacity.close();
  await expect(transferred).rejects.toThrow("Browser closed");
});

test.each([2, 3, 20])(
  "browser-wide tracing drains %i contexts and blocks later contexts in FIFO order",
  async (limit) => {
    const capacity = browserCapacity(limit);
    const owners = await Promise.all(
      Array.from({ length: limit }, () => capacity.acquire()),
    );
    const order: string[] = [];
    const trace = capacity.acquire(true).then((release) => {
      order.push("trace");
      return release;
    });
    const later = capacity.acquire().then((release) => {
      order.push("later");
      return release;
    });
    for (const release of owners.slice(0, -1)) release();
    await Promise.resolve();
    expect(order).toEqual([]);
    owners.at(-1)!();
    const endTrace = await trace;
    expect(order).toEqual(["trace"]);
    endTrace();
    (await later)();
    expect(order).toEqual(["trace", "later"]);
    const end = await capacity.acquire(true);
    const rejected = capacity.acquire(true);
    capacity.close();
    await expect(rejected).rejects.toThrow("Browser closed");
    end();
  },
);
