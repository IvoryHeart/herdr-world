import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// React, the layer stack and the module mock capture globals. Isolate them
// from native sequential tests, as in the other headless World consumers.
if (process.env.WORLD_VIEW_PICKER_TEST !== "1") {
  test("phone corner menu Hosts in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_VIEW_PICKER_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://world.example.test" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement,
    CustomEvent: dom.CustomEvent,
    KeyboardEvent: dom.KeyboardEvent,
    Element: dom.Element,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  // The manager's own behaviour is ConnectionSwitcher's; here only that the
  // corner menu opens it.
  mock.module("../components/ConnectionSwitcher", () => ({
    ConnectionManagerDialog: ({ onClose }: { onClose(): void }) => (
      <div role="dialog" aria-label="Connections">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ),
  }));
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { WorldViewPicker } = await import("./WorldViewPicker");
  const { HostsControl } = await import("./HostsControl");
  const { useHostsFilter } = await import("./hostsFilter");
  const { worldHosts } = await import("../worldHosts");
  const { worldLocalStorage } = await import("../browserStorage");

  const hosts = worldHosts({
    connections: ["alpha", "beta"].map((id) => ({
      id,
      label: `Synthetic ${id}`,
      source: "test",
      is_default: id === "alpha",
      state: "ready" as const,
      generation: 7,
      type: "ssh" as const,
    })),
  });
  // The same wiring as WorldFoundationApp: one filter feeds the corner menu
  // and the topbar's Hosts control.
  function Harness({ mobile }: { mobile: boolean }) {
    const filter = useHostsFilter(hosts);
    const control = {
      connections: hosts,
      ids: filter.ids,
      explanation: filter.explanation,
      onChange: filter.setIds,
    };
    return (
      <>
        <div className="topbar">
          <HostsControl {...control} />
        </div>
        <WorldViewPicker
          view="town"
          mobile={mobile}
          onSelect={() => {}}
          onExitZen={() => {}}
          hosts={control}
        />
      </>
    );
  }
  let root: ReturnType<typeof createRoot>;
  const $ = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector);
  const button = (text: string, scope: ParentNode = document) =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.startsWith(text),
    );
  const click = (element: HTMLElement | null | undefined) => {
    if (!element) throw new Error("missing element");
    return act(() => element.click());
  };
  const saved = () => worldLocalStorage.getItem("worldHostsFilter.v1");
  const topbarLabel = () =>
    $(".topbar .connection-switcher-label")?.textContent;
  beforeEach(async () => {
    document.body.innerHTML = "<div id='root'></div>";
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    worldLocalStorage.clear();
  });

  test("a phone's corner menu filters the same Hosts as the topbar", async () => {
    await act(() => root.render(<Harness mobile />));
    await click($(".world-view-picker-fab"));
    const item = button("Hosts", $('[role="menu"]')!);
    expect(item?.getAttribute("role")).toBe("menuitem");
    expect(item?.textContent).toBe("HostsAll hosts");

    await click(item);
    expect($('[role="menu"]')).toBeNull();
    const panel = $('[role="group"][aria-label="Hosts filter"]');
    expect(panel?.closest(".world-view-picker-phone")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("All hosts");

    await click($<HTMLInputElement>('input[aria-label="Synthetic beta"]'));
    expect(saved()).toBe('["alpha"]');
    expect(topbarLabel()).toBe("1 hosts");
    expect(
      $<HTMLInputElement>('input[aria-label="Synthetic beta"]')?.checked,
    ).toBe(false);

    // Reopened, the menu reads the selection the topbar shows.
    await click($(".world-view-picker-fab"));
    expect($(".world-view-picker-hosts")).toBeNull();
    await click($(".world-view-picker-fab"));
    expect(button("Hosts", $('[role="menu"]')!)?.textContent).toBe(
      "Hosts1 hosts",
    );
    await click(button("Hosts", $('[role="menu"]')!));
    await click(button("All hosts", $(".world-view-picker-hosts")!));
    expect(saved()).toBe("null");
    expect(topbarLabel()).toBe("All hosts");

    await click(button("Manage connections", $(".world-view-picker-hosts")!));
    expect($(".world-view-picker-hosts")).toBeNull();
    expect($('[role="dialog"][aria-label="Connections"]')).not.toBeNull();
    await click(button("Close", $('[role="dialog"]')!));
    expect($('[role="dialog"]')).toBeNull();
  });

  test("Try finds every help control in the phone's corner menu through its button", async () => {
    await act(() => root.render(<Harness mobile />));
    const fab = $(".world-view-picker-fab")!;
    const opens = fab.dataset.helpOpens?.split(/\s+/) ?? [];
    await click(fab);
    const marked = Array.from(
      $('[role="menu"]')!.querySelectorAll<HTMLElement>("[data-help]"),
      (item) => item.dataset.help!,
    );
    expect(marked).toEqual(
      expect.arrayContaining(["world.phone-hosts", "world.command-box"]),
    );
    expect(button("Find or act", $('[role="menu"]')!)?.dataset.help).toBe(
      "world.command-box",
    );
    for (const control of marked) expect(opens).toContain(control);
  });

  test("Tab out of the phone's Hosts panel closes it", async () => {
    await act(() => root.render(<Harness mobile />));
    const panel = () => $(".world-view-picker-hosts");
    const tab = (element: HTMLElement | null | undefined, shiftKey = false) => {
      if (!element) throw new Error("missing element");
      element.focus();
      return act(() => {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }),
        );
      });
    };
    const openHosts = async () => {
      await click($(".world-view-picker-fab"));
      await click(button("Hosts", $('[role="menu"]')!));
      expect(panel()).not.toBeNull();
    };
    await openHosts();
    // Between its own controls, Tab stays inside.
    await tab($('input[aria-label="Synthetic alpha"]'));
    await tab($('input[aria-label="Synthetic beta"]'), true);
    await tab(button("All hosts", panel()!));
    expect(panel()).not.toBeNull();
    // Past the last control, or before the first, it closes.
    await tab(button("Manage connections", panel()!));
    expect(panel()).toBeNull();
    expect($('[role="menu"]')).toBeNull();
    await openHosts();
    await tab(button("All hosts", panel()!), true);
    expect(panel()).toBeNull();
  });

  test("the desktop view row stays without Hosts", async () => {
    await act(() => root.render(<Harness mobile={false} />));
    const row = $('.world-view-picker[role="group"]')!;
    expect(button("Hosts", row)).toBeUndefined();
    expect($(".world-view-picker-phone")).toBeNull();
  });
}
