import { describe, expect, test } from "bun:test";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { registerTerminalLinkProvider } from "./terminalLinkProvider";
import { TerminalFileResolutionCache } from "./terminalFileLinks";
import {
  getShortcutSnapshot,
  selectShortcutPreset,
} from "./shortcutPreferences";

function fixture(rows: string[], cols: number, wrapped: number[] = []) {
  let provider!: ILinkProvider;
  const lines = rows.map((text, index) => ({
    text,
    isWrapped: wrapped.includes(index + 1),
    get length() {
      return cols;
    },
    getCell(x: number) {
      if (x >= cols) return undefined;
      return { getChars: () => this.text[x] ?? "", getWidth: () => 1 };
    },
  }));
  const buffer = { getLine: (y: number) => lines[y] };
  const term = {
    cols,
    buffer: { active: buffer },
    registerLinkProvider(value: ILinkProvider) {
      provider = value;
      return { dispose() {} };
    },
  } as unknown as Terminal;
  const requests: string[][] = [];
  const previewed: string[] = [];
  const existing = new Set<string>();
  const cache = new TerminalFileResolutionCache(
    async (_scope, _workspace, paths) => {
      requests.push(paths);
      return paths
        .filter((path) => existing.has(path))
        .map((path) => ({ candidate: path, path }));
    },
  );
  const resolve = (paths: string[]) =>
    cache.resolve("test", "workspace", paths);
  const links = (row: number) =>
    new Promise<ILink[]>((done) =>
      provider.provideLinks(row, (found) => done(found ?? [])),
    );
  return { term, lines, requests, existing, resolve, previewed, links };
}

// These exercise the actual provider registered with xterm, including async
// resolution and the one-based, inclusive ranges used for mouse activation.
describe("terminal link provider", () => {
  test("treats a soft-wrapped absolute file as one link from either row", async () => {
    const f = fixture(["See /tmp/long/gu", "ide.md and text"], 16, [2]);
    registerTerminalLinkProvider(f.term, (path) => f.previewed.push(path));
    for (const row of [1, 2]) {
      const links = await f.links(row);
      expect(links.map((link) => link.text)).toEqual(["/tmp/long/guide.md"]);
      expect(links[0]!.range).toEqual({
        start: { x: 5, y: 1 },
        end: { x: 6, y: 2 },
      });
    }
  });

  test("resolves an entire relative path across three soft-wrapped rows", async () => {
    const f = fixture(
      "docs/very-long-folder/guide.md:42 ".match(/.{1,12}/g)!,
      12,
      [2, 3],
    );
    f.existing.add("docs/very-long-folder/guide.md");
    registerTerminalLinkProvider(f.term, () => {}, f.resolve);
    expect((await f.links(2)).map((link) => link.text)).toEqual([
      "docs/very-long-folder/guide.md",
    ]);
    expect(f.requests).toEqual([["docs/very-long-folder/guide.md"]]);
  });

  test("does not join explicit newlines in a terminal stream", async () => {
    const f = fixture(["/tmp/a.md", "/tmp/b.md"], 9);
    registerTerminalLinkProvider(f.term, () => {});
    expect((await f.links(1)).map((link) => link.text)).toEqual(["/tmp/a.md"]);
    expect((await f.links(2)).map((link) => link.text)).toEqual(["/tmp/b.md"]);
  });

  test("joins an edge-contiguous path in an endpoint repaint only after file resolution", async () => {
    const f = fixture(["See /tmp/long/gu", "ide.md          "], 16);
    f.existing.add("/tmp/long/guide.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    for (const row of [1, 2]) {
      const links = await f.links(row);
      expect(links.map((link) => link.text)).toEqual(["/tmp/long/guide.md"]);
      expect(links[0]!.range).toEqual({
        start: { x: 5, y: 1 },
        end: { x: 6, y: 2 },
      });
    }
    expect(f.requests.flat()).toContain("/tmp/long/guide.md");
  });

  test("keeps unrelated endpoint rows separate when the combined path does not exist", async () => {
    const f = fixture(["/tmp/a.md", "/tmp/b.md"], 9);
    f.existing.add("/tmp/a.md");
    f.existing.add("/tmp/b.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    expect((await f.links(1)).map((link) => link.text)).toEqual(["/tmp/a.md"]);
    expect((await f.links(2)).map((link) => link.text)).toEqual(["/tmp/b.md"]);
  });

  test("keeps padded independent rows separate unless a combined file exists", async () => {
    const f = fixture(["docs/a.md", "next/file.md"], 16);
    f.existing.add("docs/a.md");
    f.existing.add("next/file.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    expect((await f.links(1)).map((link) => link.text)).toEqual(["docs/a.md"]);
    expect((await f.links(2)).map((link) => link.text)).toEqual([
      "next/file.md",
    ]);
  });

  test.each(["standalone", "joined"])(
    "resolves all candidate batches and prefers the complete %s path",
    async (kind) => {
      const rows = Array.from({ length: 17 }, (_, i) => `docs/file${i}.md`);
      const f = fixture(rows, 40);
      for (const path of rows) f.existing.add(path);
      const joined = rows[7]! + rows[8]!;
      if (kind === "joined") f.existing.add(joined);
      registerTerminalLinkProvider(
        f.term,
        () => {},
        f.resolve,
        () => true,
      );
      expect((await f.links(9)).map((link) => link.text)).toEqual([
        kind === "joined" ? joined : rows[8]!,
      ]);
      expect(f.requests.map((paths) => paths.length)).toEqual([32, 32, 17]);
      expect(f.requests.flat()).toContain(rows[8]!);
    },
  );

  test("deduplicates repeated path candidates before resolution", async () => {
    const f = fixture(Array(17).fill("docs/file.md"), 40);
    f.existing.add("docs/file.md");
    const batches: string[][] = [];
    registerTerminalLinkProvider(
      f.term,
      () => {},
      (paths) => {
        batches.push(paths);
        return f.resolve(paths);
      },
      () => true,
    );
    expect((await f.links(9)).map((link) => link.text)).toEqual([
      "docs/file.md",
    ]);
    expect(batches.map((paths) => paths.length)).toEqual([17]);
  });

  test.each(["buffer changes", "lookup fails"])(
    "discards batch results when the last batch %s",
    async (reason) => {
      const rows = Array.from({ length: 17 }, (_, i) => `docs/file${i}.md`);
      const f = fixture(rows, 40);
      f.existing.add(rows.join(""));
      f.existing.add(rows[8]!);
      let calls = 0;
      registerTerminalLinkProvider(
        f.term,
        () => {},
        async (paths) => {
          if (++calls === 3) {
            if (reason === "lookup fails") throw new Error("resolution failed");
            f.lines[8]!.text = "docs/replaced.md";
          }
          return f.resolve(paths);
        },
        () => true,
      );
      expect(await f.links(9)).toEqual([]);
      expect(calls).toBe(3);
    },
  );

  test.each(["mac", "windows", "linux"])(
    "joins the indented Codex example and activates the complete file (%s)",
    async (preset) => {
      const path =
        ".dev/vllm-v41-compat/evidence/restore-instrumented-native3/README.md";
      const first =
        "  Restore still needs a fix. Full diagnosis and traces (.dev/vllm-v41-compat/evidence/restore-instrumented-native3/";
      const f = fixture([first, "  README.md)."], first.length + 3);
      f.existing.add(path);
      registerTerminalLinkProvider(
        f.term,
        (value) => f.previewed.push(value),
        f.resolve,
        () => true,
      );
      for (const row of [1, 2]) {
        const links = await f.links(row);
        expect(links.map((link) => link.text)).toEqual([path]);
        expect(links[0]!.range).toEqual({
          start: { x: first.indexOf(".dev/") + 1, y: 1 },
          end: { x: 11, y: 2 },
        });
        const event = {
          preventDefault() {},
          ctrlKey: preset !== "mac",
          metaKey: preset === "mac",
          shiftKey: false,
          altKey: false,
        } as MouseEvent;
        const previous = getShortcutSnapshot().preferences.active;
        try {
          selectShortcutPreset(preset);
          links[0]!.activate(event, links[0]!.text);
        } finally {
          selectShortcutPreset(previous);
        }
      }
      expect(f.previewed).toEqual([path, path]);
    },
  );

  test("finds a continued path even with adjacent prose on both sides", async () => {
    const f = fixture(
      [
        "some previous text",
        "  docs/long-folder/",
        "  README.md",
        "more following text",
      ],
      24,
    );
    f.existing.add("docs/long-folder/README.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    for (const row of [2, 3]) {
      expect((await f.links(row)).map((link) => link.text)).toEqual([
        "docs/long-folder/README.md",
      ]);
    }
  });

  test("does not bridge a blank line or turn an unresolved guessed path into a link", async () => {
    const f = fixture(["  docs/long-folder/", "", "  README.md"], 24);
    f.existing.add("docs/long-folder/README.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    expect(await f.links(1)).toEqual([]);
    f.lines[1]!.text = "  missing.md";
    expect(await f.links(1)).toEqual([]);
  });

  test("recognizes wrapped HTTP links without treating the continuation as a file", async () => {
    const f = fixture(["https://example.", "com/docs/a.md   "], 16, [2]);
    registerTerminalLinkProvider(f.term, () => {}, f.resolve);
    const links = await f.links(2);
    expect(links.map((link) => link.text)).toEqual([
      "https://example.com/docs/a.md",
    ]);
    expect(links[0]!.range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 13, y: 2 },
    });
    expect(f.requests).toEqual([]);
  });

  test("keeps a file on the next endpoint row independent of an HTTP URL", async () => {
    const f = fixture(["https://example.com", "docs/guide.md"], 30);
    f.existing.add("docs/guide.md");
    registerTerminalLinkProvider(
      f.term,
      () => {},
      f.resolve,
      () => true,
    );
    expect((await f.links(1)).map((link) => link.text)).toEqual([
      "https://example.com",
    ]);
    expect((await f.links(2)).map((link) => link.text)).toEqual([
      "docs/guide.md",
    ]);
  });

  test("keeps explicit spaces in a soft-wrapped line as path boundaries", async () => {
    const f = fixture(["docs/foo ", "bar.md"], 9, [2]);
    f.existing.add("docs/foobar.md");
    registerTerminalLinkProvider(f.term, () => {}, f.resolve);
    expect(await f.links(1)).toEqual([]);
    expect(await f.links(2)).toEqual([]);
  });

  test("rejects async results when another row in the path changes", async () => {
    const f = fixture(["docs/long-path/g", "uide.md         "], 16, [2]);
    let complete!: (value: Map<string, string>) => void;
    registerTerminalLinkProvider(
      f.term,
      () => {},
      () =>
        new Promise((done) => {
          complete = done;
        }),
    );
    const result = f.links(1);
    f.lines[1]!.text = "one.md";
    complete(new Map([["docs/long-path/guide.md", "docs/long-path/guide.md"]]));
    expect(await result).toEqual([]);
  });

  test("rejects async results when wrapping changes without changing the text", async () => {
    const f = fixture(["docs/long-path/g", "uide.md         "], 16, [2]);
    let complete!: (value: Map<string, string>) => void;
    registerTerminalLinkProvider(
      f.term,
      () => {},
      () =>
        new Promise((done) => {
          complete = done;
        }),
    );
    const result = f.links(1);
    f.lines[1]!.isWrapped = false;
    complete(new Map([["docs/long-path/guide.md", "docs/long-path/guide.md"]]));
    expect(await result).toEqual([]);
  });
});
