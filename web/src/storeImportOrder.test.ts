import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

test("asks can load before the application store with browser preferences present", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    globalThis.localStorage = {
      getItem: key => key.endsWith(":taskNotificationsEnabled") ? "true" : null,
      setItem(){}, removeItem(){}, clear(){}, key:()=>null, length:0,
    };
    await import("./web/src/world/worldAsks");
    const {store} = await import("./web/src/store");
    console.log(JSON.stringify({enabled:store.get().taskNotificationsEnabled}));
  `,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ enabled: true });
  } finally {
    clearTimeout(timeout);
  }
}, 15000);
