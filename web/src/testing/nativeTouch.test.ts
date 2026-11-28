import { expect, test } from "bun:test";
import { nativeTouchDriver } from "./nativeTouch";

function touch(target: EventTarget, type: string, count: number) {
  const event = new Event(type);
  Object.assign(event, { touches: { length: count } });
  target.dispatchEvent(event);
}

test("CDP acknowledgement and capture delivery cannot advance time before the event drains", async () => {
  const target = new EventTarget();
  const signal = new AbortController();
  const drained = Promise.withResolvers<void>();
  const driver = nativeTouchDriver(
    target,
    async () => {},
    () => drained.promise,
    () => signal.signal,
  );
  let advanced = false;
  const pending = driver.send("touchStart", [{ x: 1, y: 2 }]).then(() => {
    advanced = true;
  });
  await Promise.resolve();
  expect(advanced).toBe(false);
  touch(target, "touchstart", 1);
  await Promise.resolve();
  expect(advanced).toBe(false);
  drained.resolve();
  await pending;
  expect(advanced).toBe(true);
  driver.close();
});

test("cancellation is delivered before time advances and a cancelled sequence needs no end event", async () => {
  const target = new EventTarget();
  const signal = new AbortController();
  const driver = nativeTouchDriver(
    target,
    async () => {},
    async () => {},
    () => signal.signal,
  );
  const start = driver.send("touchStart", [{ x: 1, y: 2 }]);
  touch(target, "touchstart", 1);
  await start;
  let advanced = false;
  const cancel = driver.send("touchCancel").then(() => {
    advanced = true;
  });
  await Promise.resolve();
  expect(advanced).toBe(false);
  touch(target, "touchcancel", 0);
  await cancel;
  expect(advanced).toBe(true);
  await driver.send("touchEnd");
  driver.close();
});

test("missing native input fails at its existing bound, independently of fixture time", async () => {
  const target = new EventTarget();
  const signal = new AbortController();
  const driver = nativeTouchDriver(
    target,
    async () => {},
    async () => {},
    () => signal.signal,
  );
  const pending = driver.send("touchStart", [{ x: 1, y: 2 }]);
  signal.abort();
  await expect(pending).rejects.toThrow("Native touchStart was not delivered");
  driver.close();
});
