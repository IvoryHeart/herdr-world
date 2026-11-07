import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

// Files attached to an answer in Needs you, clicked in a DOM. React and
// happy-dom globals stay in their own runtime, as needsYouAnswers.test.ts
// keeps them.
if (process.env.HERDR_WORLD_NEEDS_YOU_FILES_DOM_TEST !== "1") {
  test("Needs you answer attachments in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_NEEDS_YOU_FILES_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 30_000);
} else {
  await registerDomTest();
}

async function registerDomTest() {
  const browser = new Window({ url: "http://localhost" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "NodeFilter",
    "DOMParser",
    "Event",
    "MutationObserver",
    "ResizeObserver",
    "MouseEvent",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? browser : browser[key],
      writable: true,
      configurable: true,
    });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { NeedsYouMessage } = await import("./NeedsYouItem");
  afterAll(async () => browser.happyDOM.close());

  const ask = {
    id: "q-1",
    at: 1_000,
    actor: { label: "crew dispatcher", verified: false },
    question: "Does the fix look right?",
    options: [],
    owner_only: true,
  };
  // Uploads the test settles one by one, by file name.
  const uploads = new Map<
    string,
    { resolve(path: string): void; reject(error: Error): void }
  >();
  const answers: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(async () =>
    root.render(
      createElement(NeedsYouMessage, {
        item: { kind: "asks", key: "ask:q-1", ask, leaf: null },
        now: 2_000,
        focused: false,
        stop: null,
        onChat: () => {},
        onOpenTerminal: () => {},
        onAnswer: async (text: string) => {
          answers.push(text);
          return null;
        },
        onAttach: (file: File) =>
          new Promise<string>((resolve, reject) =>
            uploads.set(file.name, { resolve, reject }),
          ),
        onDismiss: async () => null,
        onReviewed: async () => false,
      }),
    ),
  );
  const labelled = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const send = () => labelled("Send answer");
  const chips = () =>
    [...container.querySelectorAll<HTMLElement>(".needs-you-file")].map(
      (chip) =>
        `${chip.querySelector(".needs-you-file-name")?.textContent}: ${chip.dataset.status}`,
    );
  const pick = async (...names: string[]) => {
    const picker =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = names.map(
      (name) =>
        new File(["synthetic"], name, {
          type: name.endsWith(".png") ? "image/png" : "text/plain",
        }),
    );
    Object.defineProperty(picker, "files", {
      value: files,
      configurable: true,
    });
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const type = async (text: string) => {
    const field = container.querySelector<HTMLInputElement>(
      ".needs-you-field input:not([type])",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  test("attached files upload as chips, can be removed, and send their paths with the answer", async () => {
    expect(labelled("Attach files or screenshots")).not.toBeNull();
    await type("The header overlaps");
    await pick("screen.png", "notes.txt", "extra.png");
    expect(chips()).toEqual([
      "screen.png: uploading",
      "notes.txt: uploading",
      "extra.png: uploading",
    ]);
    // An image shows its thumbnail; another file shows a file icon.
    expect(container.querySelectorAll(".needs-you-file img")).toHaveLength(2);
    expect(container.querySelectorAll(".needs-you-file > svg")).toHaveLength(1);
    // Sending waits for the files still on their way.
    expect(send().disabled).toBe(true);
    await act(async () =>
      uploads.get("screen.png")!.resolve("/tmp/a/screen.png"),
    );
    await act(async () =>
      uploads.get("notes.txt")!.reject(new Error("File too large")),
    );
    await settle();
    expect(chips()).toEqual([
      "screen.png: done",
      "notes.txt: failed",
      "extra.png: uploading",
    ]);
    // A failed file blocks sending until it is retried or removed.
    await act(async () =>
      uploads.get("extra.png")!.resolve("/tmp/c/extra.png"),
    );
    await settle();
    expect(send().disabled).toBe(true);
    await act(async () => labelled("Retry notes.txt").click());
    expect(chips()[1]).toBe("notes.txt: uploading");
    await act(async () =>
      uploads.get("notes.txt")!.resolve("/tmp/b/notes.txt"),
    );
    await settle();
    // A file removed before sending is not sent.
    await act(async () => labelled("Remove extra.png").click());
    expect(chips()).toEqual(["screen.png: done", "notes.txt: done"]);
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    await settle();
    expect(answers).toEqual([
      "The header overlaps\n\nAttached files:\n/tmp/a/screen.png\n/tmp/b/notes.txt",
    ]);
    // Sent: the chips are gone with the answer.
    expect(chips()).toEqual([]);
  });

  test("files alone are an answer", async () => {
    answers.length = 0;
    await type("");
    expect(send().disabled).toBe(true);
    await pick("only.png");
    await act(async () => uploads.get("only.png")!.resolve("/tmp/d/only.png"));
    await settle();
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    await settle();
    expect(answers).toEqual(["Attached files:\n/tmp/d/only.png"]);
  });
}
