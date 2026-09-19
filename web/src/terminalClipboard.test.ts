import { describe, expect, test } from "bun:test";
import {
  ClipboardAddon,
  type ClipboardSelectionType,
} from "@xterm/addon-clipboard";
import type { Terminal } from "@xterm/xterm";
import {
  copyTextFromUserGesture,
  createTerminalClipboardProvider,
  decodeTerminalClipboard,
  MAX_TERMINAL_CLIPBOARD_BASE64_CHARS,
  MAX_TERMINAL_CLIPBOARD_CHARS,
} from "./terminalClipboard";

const systemClipboard = "c" as ClipboardSelectionType;
const primaryClipboard = "p" as ClipboardSelectionType;

function flushClipboardWrite() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("terminal OSC 52 clipboard access", () => {
  test("decodes only safe Herdr clipboard messages", () => {
    expect(decodeTerminalClipboard("dGVzdA==")).toBe("test");
    expect(
      decodeTerminalClipboard(Buffer.from("中文\ntext").toString("base64")),
    ).toBe("中文\ntext");
    expect(decodeTerminalClipboard("bad\x07payload")).toBeNull();
    expect(decodeTerminalClipboard("/w==")).toBeNull();
    expect(
      decodeTerminalClipboard(
        "A".repeat(MAX_TERMINAL_CLIPBOARD_BASE64_CHARS + 4),
      ),
    ).toBeNull();
    expect(decodeTerminalClipboard("")).toBeNull();
  });

  test("decodes a Pi-style OSC 52 payload through the xterm addon", async () => {
    const writes: string[] = [];
    let oscHandler: ((data: string) => boolean | Promise<boolean>) | undefined;
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
        },
      },
    });
    const addon = new ClipboardAddon(undefined, provider);
    addon.activate({
      parser: {
        registerOscHandler(
          ident: number,
          handler: (data: string) => boolean | Promise<boolean>,
        ) {
          expect(ident).toBe(52);
          oscHandler = handler;
          return { dispose() {} };
        },
      },
    } as unknown as Terminal);

    const text = "selected tree message\nwith multiple lines";
    const encoded = Buffer.from(text).toString("base64");
    const handled = oscHandler?.(`c;${encoded}`);

    expect(handled).toBe(true);
    expect(writes).toEqual([text]);
  });

  test("does not block terminal parsing on a pending browser permission", () => {
    let finishWrite: (() => void) | undefined;
    let oscHandler: ((data: string) => boolean | Promise<boolean>) | undefined;
    const addon = new ClipboardAddon(
      undefined,
      createTerminalClipboardProvider({
        clipboard: {
          writeText: () =>
            new Promise<void>((resolve) => {
              finishWrite = resolve;
            }),
        },
      }),
    );
    addon.activate({
      parser: {
        registerOscHandler(
          _ident: number,
          handler: (data: string) => boolean | Promise<boolean>,
        ) {
          oscHandler = handler;
          return { dispose() {} };
        },
      },
    } as unknown as Terminal);

    const handled = oscHandler?.(`c;${Buffer.from("copy").toString("base64")}`);

    expect(handled).toBe(true);
    expect(finishWrite).toBeFunction();
    finishWrite?.();
  });

  test("writes system clipboard requests through the browser API", async () => {
    const writes: string[] = [];
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
        },
      },
      fallback: () => false,
    });

    provider.writeText(systemClipboard, "copied from Pi");
    await flushClipboardWrite();

    expect(writes).toEqual(["copied from Pi"]);
  });

  test("uses the compatibility fallback when clipboard permission is denied", async () => {
    const fallbacks: string[] = [];
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      fallback: (text) => {
        fallbacks.push(text);
        return true;
      },
    });

    provider.writeText(systemClipboard, "tree branch");
    await flushClipboardWrite();

    expect(fallbacks).toEqual(["tree branch"]);
  });

  test("ignores non-system writes and refuses clipboard reads", async () => {
    let writes = 0;
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async () => {
          writes += 1;
        },
      },
    });

    provider.writeText(primaryClipboard, "ignored");

    expect(writes).toBe(0);
    expect(await provider.readText(systemClipboard)).toBe("");
  });

  test("ignores empty writes and writes from an inactive pane", async () => {
    const writes: string[] = [];
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
        },
      },
      canWrite: () => false,
    });

    provider.writeText(systemClipboard, "background pane");
    provider.writeText(systemClipboard, "");
    await flushClipboardWrite();

    expect(writes).toEqual([]);
  });

  test("reports failure without rejecting terminal output parsing", async () => {
    const errors: Error[] = [];
    const provider = createTerminalClipboardProvider({
      clipboard: null,
      fallback: () => false,
      onWriteError: (error) => errors.push(error),
    });

    provider.writeText(systemClipboard, "cannot copy");
    await flushClipboardWrite();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("unavailable");
  });

  test("rejects oversized payloads without retaining retry text", () => {
    let writes = 0;
    const errors: Array<{ error: Error; retryText: string | null }> = [];
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: async () => {
          writes += 1;
        },
      },
      onWriteError: (error, retryText) => errors.push({ error, retryText }),
    });

    provider.writeText(
      systemClipboard,
      "x".repeat(MAX_TERMINAL_CLIPBOARD_CHARS + 1),
    );

    expect(writes).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].retryText).toBeNull();
    expect(errors[0].error.message).toContain("100,000");
  });

  test("suppresses a stale failure after a newer copy starts", async () => {
    let callCount = 0;
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    const errors: Error[] = [];
    const provider = createTerminalClipboardProvider({
      clipboard: {
        writeText: () => {
          callCount += 1;
          if (callCount === 1) {
            return new Promise<void>((_resolve, reject) => {
              rejectFirst = reject;
            });
          }
          return Promise.resolve();
        },
      },
      fallback: () => false,
      onWriteError: (error) => errors.push(error),
    });

    provider.writeText(systemClipboard, "older copy");
    provider.writeText(systemClipboard, "newer copy");
    rejectFirst?.(new Error("older request denied"));
    await flushClipboardWrite();

    expect(callCount).toBe(2);
    expect(errors).toEqual([]);
  });

  test("retries from a user gesture with a synchronous HTTP fallback", async () => {
    const copied: string[] = [];
    let browserWrites = 0;

    await copyTextFromUserGesture("remote tree", {
      clipboard: {
        writeText: async () => {
          browserWrites += 1;
        },
      },
      fallback: (text) => {
        copied.push(text);
        return true;
      },
    });

    expect(copied).toEqual(["remote tree"]);
    expect(browserWrites).toBe(0);
  });

  test("uses Clipboard API when the user-gesture fallback is unavailable", async () => {
    const copied: string[] = [];

    await copyTextFromUserGesture("secure tree", {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
        },
      },
      fallback: () => false,
    });

    expect(copied).toEqual(["secure tree"]);
  });
});
