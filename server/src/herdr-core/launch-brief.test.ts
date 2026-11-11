import { afterEach, expect, test } from "bun:test";
import { deliverLaunchBrief } from "./launch-brief";
import { coreWorld } from "./testing/core-world";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function starting() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  const t = w.fake.create({ argv: ["pi"], foreground: null });
  await w.settle();
  return { w, t, record: w.lease().runtime.core.terminal(t)! };
}

test("a generic brief waits for native foreground and uses ordinary delivery once", async () => {
  const { w, t, record } = await starting();
  const delivery = deliverLaunchBrief(w.lease(), record, "Review the tests");
  w.fake.foreground(t, { pid: 77, name: "pi", argv: ["pi"] });
  expect(await delivery).toMatchObject({ status: "sent" });
  expect(w.fake.deliveredInput).toHaveLength(1);
});

test("a startup replacement never receives the original profile brief", async () => {
  const { w, t, record } = await starting();
  const delivery = deliverLaunchBrief(w.lease(), record, "Review the tests");
  w.fake.replaceWithShell(t, { reusePid: true });
  expect(await delivery).toMatchObject({ status: "refused" });
  expect(w.fake.deliveredInput).toHaveLength(0);
});

test("startup without foreground times out without typing anything", async () => {
  const { w, record } = await starting();
  expect(
    await deliverLaunchBrief(w.lease(), record, "Review the tests", 1),
  ).toMatchObject({
    status: "refused",
    message: expect.stringContaining("Started"),
  });
  expect(w.fake.deliveredInput).toHaveLength(0);
});

test("a retired startup lease never falls back to its reconnect", async () => {
  const { w, record } = await starting();
  const delivery = deliverLaunchBrief(w.lease(), record, "Review the tests");
  await w.service.disconnect("box");
  expect(await delivery).toMatchObject({ status: "refused" });
  expect(w.fake.deliveredInput).toHaveLength(0);
});
