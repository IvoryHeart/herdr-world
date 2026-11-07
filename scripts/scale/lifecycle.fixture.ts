import { mock, spyOn } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated unit process: no browser, service, source or measurement is launched.
const [mode, root] = process.argv.slice(2) as [string, string];
if (mode === "chrome-spawn") {
  process.env.CHROME_BIN = join(root, "missing-synthetic-browser");
  process.env.TMPDIR = root;
  const { browserCase } = await import("./browser");
  let error = "";
  try {
    await browserCase(
      {} as never,
      {} as never,
      "town",
      { id: "synthetic", width: 390, height: 844, throttle: 4 },
      join(root, "capture"),
      false,
      2,
    );
  } catch (cause) {
    error = String(cause);
  }
  console.log(JSON.stringify({ error, files: readdirSync(root) }));
} else {
  const waiting = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<void>();
  let releases = 0,
    measurements = 0,
    spawns = 0;
  mock.module(
    fileURLToPath(new URL("../check-lock.ts", import.meta.url)),
    () => ({
      acquireAllCheckSlots: async () => {
        waiting.resolve();
        await admission.promise;
        return () => {
          releases++;
        };
      },
    }),
  );
  mock.module(
    fileURLToPath(new URL("./persistence.ts", import.meta.url)),
    () => ({
      largeBoardSaves: async () => {
        measurements++;
        throw new Error("synthetic unit stop before measurements");
      },
    }),
  );
  spyOn(Bun, "spawnSync").mockImplementation(() => {
    spawns++;
    return { stdout: Buffer.from("1") } as ReturnType<typeof Bun.spawnSync>;
  });
  mkdirSync(join(root, "server"));
  mkdirSync(join(root, "scripts/scale"), { recursive: true });
  writeFileSync(join(root, "server/herdr-world"), "synthetic identity bytes");
  writeFileSync(join(root, "bun.lock"), "synthetic lock bytes");
  process.chdir(root);
  const out = join(root, "evidence");
  process.argv = [process.execPath, "run.ts", "--board-only", `--out=${out}`];
  delete process.env.CI;
  process.env.CHROME_BIN = "synthetic-unexecuted-browser";
  const result = import("./run").then(() => "completed", String);
  await waiting.promise;
  if (mode === "output-reuse") {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "complete.json"), '{"complete":true,"rows":120}');
    writeFileSync(join(out, "identity.json"), '{"run":"original"}');
    writeFileSync(join(out, "results.json"), '[{"run":"original"}]');
  }
  admission.resolve();
  const error = await result;
  const files = readdirSync(out).sort();
  const contents = Object.fromEntries(
    files.map((file) => [file, readFileSync(join(out, file), "utf8")]),
  );
  console.log(
    JSON.stringify({ error, files, contents, releases, measurements, spawns }),
  );
}
