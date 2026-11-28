import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserSelectionNeedsChrome } from "./testing/browser-session";

test("unit probes mentioning Chrome do not launch it; registered browser selections do", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-selection-"));
  try {
    await writeFile(
      join(root, "probe.test.ts"),
      'const source = "launchTestBrowser --headless CHROME_BIN";',
    );
    await writeFile(join(root, "page.test.ts"), "// browser fixture");
    const inventory = ["page.test.ts"];
    expect(
      browserSelectionNeedsChrome(
        ["probe.test.ts", "--parallel=4"],
        inventory,
        root,
      ),
    ).toBe(false);
    expect(browserSelectionNeedsChrome(["page.test.ts"], inventory, root)).toBe(
      true,
    );
    expect(browserSelectionNeedsChrome([], inventory, root)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an empty web CI shard returns without launching Chrome or dropping its flaky receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "empty-web-shard-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "run-browser-tests.ts"),
        "--ci-web=1/2",
      ],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HERDR_CI_SELECTION: JSON.stringify({ web: [] }),
          CHROME_BIN: join(root, "must-not-launch"),
        },
      },
    );
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + err).toBe(0);
    expect(out + err).toContain("no affected suites");
    const receipts = [
      ...new Bun.Glob(".agents/delivery/flakes-web-*.json").scanSync({
        cwd: root,
      }),
    ];
    expect(receipts).toHaveLength(1);
    expect(await Bun.file(join(root, receipts[0]!)).json()).toEqual({
      files: [],
      flaky: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
