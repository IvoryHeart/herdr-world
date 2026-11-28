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
