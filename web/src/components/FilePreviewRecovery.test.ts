import { expect, mock, spyOn, test } from "bun:test";

if (process.env.FILE_PREVIEW_RECOVERY_DOM !== "1") {
  test("file preview failures recover without unmounting the surrounding panel", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, FILE_PREVIEW_RECOVERY_DOM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15000);
} else {
  for (const name of ["MutationObserver", "ResizeObserver"] as const)
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
    });
  const { act, createElement, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { FilePreviewContent } = await import("./FilePreviewContent");
  const { ResourceConnectionClientContext } = await import(
    "../useConnectionClient"
  );
  type Client = import("../api").ConnectionClient;
  type Props = import("react").ComponentProps<typeof FilePreviewContent>;
  const target: NonNullable<Client["agentWorktree"]> = {
    subject: {
      connectionId: "host-a",
      generation: 3,
      paneId: "pane-a",
      sessionFingerprint: "session-a",
    },
    revision: "observation-a",
    candidateId: "worktree-a",
  };
  const selection: Props = {
    entry: {
      name: "sample.bin",
      path: "sample.bin",
      type: "file",
      size: 8,
      mtime_ms: 0,
      hidden: false,
    },
    preview: {
      workspace_id: "w1",
      checkout_path: "/example/repo",
      repo_name: "Example",
      root: "/example/repo",
      path: "sample.bin",
      text: null,
      binary: true,
      size: 8,
      mtime_ms: 0,
      truncated: false,
    },
    loading: false,
    error: null,
  };
  const calls = mock(async () => {
    throw new Error("Unexpected file operation");
  });
  function client(worktree: Client["agentWorktree"]): Client {
    return {
      connectionId: "host-a",
      generation: 2,
      serverRuntimeGeneration: 3,
      agentWorktree: worktree,
      isCurrent: () => true,
      acceptsServerGeneration: (value) => value === 3,
      call: calls,
    };
  }
  async function mounted(
    run: (
      host: HTMLDivElement,
      render: (owner: Client, props?: Props) => Promise<void>,
    ) => Promise<void>,
  ) {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const render = async (owner: Client, props = selection) => {
      await act(async () =>
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(
              ResourceConnectionClientContext.Provider,
              { value: owner },
              createElement("input", {
                "aria-label": "Chat draft",
                defaultValue: "Keep this draft",
              }),
              createElement(
                "div",
                { hidden: true },
                createElement(FilePreviewContent, props),
              ),
            ),
          ),
        ),
      );
    };
    try {
      await run(host, render);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      errors.mockRestore();
    }
  }
  test("a retained hidden preview losing its worktree cannot crash Chat and recovers on a new binding", async () => {
    await mounted(async (host, render) => {
      await render(client(target));
      const draft = host.querySelector("input")!;
      draft.value = "Unsaved Chat text";
      expect(
        host.querySelector('[aria-label="Preview of sample.bin"]'),
      ).not.toBeNull();
      await render(client(null));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "no longer available",
      );
      expect(host.querySelector("input")).toBe(draft);
      expect(draft.value).toBe("Unsaved Chat text");
      await render(
        client({
          ...target,
          revision: "observation-b",
          candidateId: "worktree-b",
        }),
      );
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(
        host.querySelector('[aria-label="Preview of sample.bin"]'),
      ).not.toBeNull();
      expect(host.querySelector("input")).toBe(draft);
      expect(calls).not.toHaveBeenCalled();
    });
  });
  test("choosing another file clears a contained render failure without exposing its diagnostic", async () => {
    await mounted(async (host, render) => {
      const owner = client(undefined);
      const broken = {
        ...selection,
        preview: {
          ...selection.preview!,
          get text(): string {
            throw new Error("Private file-render diagnostic");
          },
        },
      };
      await render(owner, broken);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "no longer available",
      );
      expect(host.textContent).not.toContain("Private file-render diagnostic");
      await render(owner, broken);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      await render(owner, {
        ...selection,
        entry: { ...selection.entry!, path: "other.bin", name: "other.bin" },
        preview: { ...selection.preview!, path: "other.bin" },
      });
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(
        host.querySelector('[aria-label="Preview of other.bin"]'),
      ).not.toBeNull();
    });
  });
  test("retry remains contained while stale, then can refresh the same file; close is available", async () => {
    await mounted(async (host, render) => {
      let binding: Client["agentWorktree"] = null;
      const owner = client(null);
      Object.defineProperty(owner, "agentWorktree", { get: () => binding });
      const close = mock(() => {});
      let refreshed = 0;
      const props = {
        ...selection,
        onRefresh: () => {
          refreshed++;
        },
        onClosePreview: close,
      };
      await render(owner, props);
      const click = async (label: string) =>
        act(async () =>
          host
            .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
            .click(),
        );
      await click("Retry file preview");
      expect(refreshed).toBe(1);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      await click("Close file preview");
      expect(close).toHaveBeenCalledTimes(1);
      binding = target;
      await click("Retry file preview");
      expect(refreshed).toBe(2);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(
        host.querySelector('[aria-label="Preview of sample.bin"]'),
      ).not.toBeNull();
      expect(calls).not.toHaveBeenCalled();
    });
  });
}
