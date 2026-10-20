import { expect, test } from "bun:test";
import { idleShare, parseStat, waitForQuiet } from "./wait-for-quiet";

test("reads the aggregate CPU line, counting iowait as idle", () => {
  const sample = parseStat(
    "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 9 10\n",
  );
  expect(sample).toEqual({ idle: 850, total: 1000 });
  expect(idleShare({ idle: 0, total: 0 }, sample)).toBe(0.85);
});

test("waits for consecutive quiet seconds, and gives up at the limit", async () => {
  // Idle shares per second: busy, busy, quiet, busy, quiet, quiet, quiet.
  const shares = [0.2, 0.5, 0.95, 0.4, 0.92, 0.97, 0.99];
  let at = 0;
  let sample = { idle: 0, total: 0 };
  const read = () => {
    const share = shares[at - 1] ?? 1;
    if (at > 0)
      sample = { idle: sample.idle + share * 100, total: sample.total + 100 };
    at++;
    return sample;
  };
  const sleep = async () => {};
  const quiet = await waitForQuiet({ read, sleep });
  expect(quiet).toMatchObject({ quiet: true, seconds: 7 });
  at = 0;
  sample = { idle: 0, total: 0 };
  const busy = await waitForQuiet({
    read: () => {
      sample = { idle: sample.idle + 10, total: sample.total + 100 };
      return sample;
    },
    sleep,
    limit: 5,
  });
  expect(busy).toMatchObject({ quiet: false, seconds: 5 });
});
