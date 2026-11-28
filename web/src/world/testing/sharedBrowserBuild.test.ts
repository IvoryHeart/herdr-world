import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedBrowserBuild } from "./sharedBrowserBuild";

test("cases share immutable bundle bytes after the first output folder is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-browser-build-"));
  try {
    const entry = join(root, "entry.ts");
    await Bun.write(entry, "console.log(BUILD_VARIANT)");
    let builds = 0;
    const base = {
      entrypoints: [entry],
      target: "browser" as const,
      plugins: [
        {
          name: "count-build",
          setup() {
            builds++;
          },
        },
      ],
      define: { BUILD_VARIANT: '"alpha"' },
    };
    const [left, right] = await Promise.all([
      sharedBrowserBuild(import.meta.path, {
        ...base,
        outdir: join(root, "left"),
      }),
      sharedBrowserBuild(import.meta.path, {
        ...base,
        outdir: join(root, "right"),
      }),
    ]);
    expect(builds).toBe(1);
    await rm(join(root, "left"), { recursive: true, force: true });
    expect(await right.outputs[0]!.text()).toBe(await left.outputs[0]!.text());
    expect(right.outputs[0]!.path).toBe(join(root, "right/entry.js"));
    const changed = await sharedBrowserBuild(import.meta.path, {
      ...base,
      outdir: join(root, "changed"),
      define: { BUILD_VARIANT: '"beta"' },
    });
    expect(builds).toBe(2);
    expect(await changed.outputs[0]!.text()).toContain("beta");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
