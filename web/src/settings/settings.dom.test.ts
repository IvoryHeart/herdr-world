import { expect, spyOn, test } from "bun:test";

// Settings (#1035): one registry, one search, the Settings screen, its pages
// and the command box, with the real catalog and a stand-in host.
if (process.env.SETTINGS_HOME_DOM !== "1") {
  test("settings in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, SETTINGS_HOME_DOM: "1" },
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
  }, 30_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
    location: browser.location,
    history: browser.history,
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    PopStateEvent: browser.PopStateEvent,
    MouseEvent: browser.MouseEvent,
    CSS: { escape: (value: string) => value.replace(/[^\w-]/g, "\\$&") },
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  await import("./catalog");
  const { registryEntries, registryEntry, defineSettings } = await import(
    "./registry"
  );
  const { searchSettings } = await import("./search");
  const { settingsCommandGroups } = await import("./commandBoxSettings");
  const { useCommandBoxRegistry } = await import("./commandBoxRegistry");
  const { openViewControl, useViewControlRequest } = await import(
    "./viewControls"
  );
  const { SettingsHome } = await import("./SettingsHome");
  const { __loadSettingsLinkForTests, settingsLink, takeSettingsLink } =
    await import("./links");
  const { townDaylightMode } = await import("../world/town/townDaylight");
  const { chimeDevice } = await import("../chimes/chimeCenter");
  type SettingsHost = import("./registry").SettingsHost;

  function makeHost(patch: Partial<SettingsHost> = {}) {
    const calls: string[] = [];
    const host: SettingsHost = {
      appearance: {
        theme: "dark",
        setTheme: (theme) => calls.push(`theme:${theme}`),
        accentColor: "neutral",
        setAccentColor: (accent) => calls.push(`accent:${accent}`),
        blackBackground: false,
        setBlackBackground: (on) => calls.push(`black:${on}`),
        uiScale: 100,
        setUiScale: (scale) => calls.push(`ui:${scale}`),
        terminalFontScale: 100,
        setTerminalFontScale: (scale) => calls.push(`terminal:${scale}`),
      },
      zen: { on: false, available: true, set: (on) => calls.push(`zen:${on}`) },
      openPanel: (panel) => calls.push(`panel:${panel}`),
      mobile: false,
      mac: false,
      signedIn: false,
      ...patch,
    };
    return { host, calls };
  }

  const ids = (query: string) =>
    searchSettings(registryEntries(), query).map((match) => match.entry.id);

  test("every category has entries and ids are unique", () => {
    const entries = registryEntries();
    const categories = new Set(entries.map((entry) => entry.category));
    expect([...categories]).toEqual([
      "appearance",
      "town",
      "notifications",
      "agents",
      "keyboard",
      "integrations",
      "system",
      "help",
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(() =>
      defineSettings("someone-else", [
        { ...registryEntry("town.time-of-day")! },
      ]),
    ).toThrow("already defined");
  });

  test("search finds font size, sounds, lighting and night", () => {
    expect(ids("font size").slice(0, 3).sort()).toEqual([
      "appearance.chat-text",
      "appearance.interface-scale",
      "appearance.terminal-font-size",
    ]);
    expect(ids("sounds")[0]).toBe("sounds.on");
    expect(ids("lighting")[0]).toBe("town.time-of-day");
    const night = searchSettings(registryEntries(), "night")[0];
    expect(night.entry.id).toBe("town.time-of-day");
    expect(night.option?.label).toBe("Night");
    expect(ids("zzqx")).toEqual([]);
  });

  test("searching memory opens the Library", () => {
    expect(ids("memory")[0]).toBe("memory.library");
    expect(ids("CLAUDE.md")[0]).toBe("memory.library");
    const opened: unknown[] = [];
    const listener = (event: Event) =>
      opened.push((event as CustomEvent).detail);
    window.addEventListener("herdr-world:memory", listener);
    const library = registryEntry("memory.library");
    if (library?.kind !== "panel") throw new Error("Library is a panel");
    library.open?.(makeHost().host);
    window.removeEventListener("herdr-world:memory", listener);
    expect(opened).toEqual([{}]);
  });

  test("search and the command box find the Weather place and source", () => {
    // #1111: the Sky panel's place and source live in Settings, findable.
    for (const query of ["weather", "weather place", "location", "open-meteo"])
      expect(ids(query)[0]).toBe("integrations.weather");
    const weather = registryEntry("integrations.weather");
    if (weather?.kind !== "panel") throw new Error("Weather is a panel");
    expect(weather.page?.focus).toBe("source:weather");
    expect(weather.alsoOn).toBe("Town: the sky button under ALL");

    const { host } = makeHost();
    const action = settingsCommandGroups(registryEntries(), host, "weather")[0]
      .actions[0];
    expect(action.title).toBe("Weather place and source");
    const opened: unknown[] = [];
    const listener = (event: Event) =>
      opened.push((event as CustomEvent).detail);
    window.addEventListener("herdr-world:settings-open", listener);
    action.run();
    window.removeEventListener("herdr-world:settings-open", listener);
    expect(opened).toEqual(["integrations.weather"]);
  });

  test("the command box changes a setting from a result", () => {
    const { host } = makeHost();
    const groups = settingsCommandGroups(registryEntries(), host, "night");
    const first = groups[0].actions[0];
    expect(groups[0].heading).toBe("Settings");
    expect(first.title).toBe("Town time of day: Night");
    first.run();
    expect(townDaylightMode()).toBe("night");

    const sounds = settingsCommandGroups(registryEntries(), host, "sounds");
    const toggle = sounds[0].actions[0];
    const before = chimeDevice().on;
    expect(toggle.title).toBe(
      `Sounds on this device: turn ${before ? "off" : "on"}`,
    );
    toggle.run();
    expect(chimeDevice().on).toBe(!before);

    const { host: sized, calls } = makeHost();
    const font = settingsCommandGroups(registryEntries(), sized, "font size");
    const larger = font[0].actions.find(
      (action) => action.key === "setting:appearance.terminal-font-size:up",
    )!;
    larger.run();
    expect(calls).toEqual(["terminal:105"]);

    const empty = settingsCommandGroups(registryEntries(), host, "");
    expect(empty[0].actions.map((action) => action.title)).toEqual([
      "Open Settings",
    ]);
    expect(settingsCommandGroups(registryEntries(), null, "night")).toEqual([]);
  });

  test("entries show only where they mean something", () => {
    const desktop = makeHost().host;
    const phone = makeHost({ mobile: true }).host;
    const shown = (host: SettingsHost, query: string) =>
      settingsCommandGroups(registryEntries(), host, query).flatMap((group) =>
        group.actions.map((action) => action.key),
      );
    expect(shown(desktop, "inspector")).toContain(
      "setting:views.inspector-opening:docked",
    );
    expect(shown(phone, "inspector")).not.toContain(
      "setting:views.inspector-opening:docked",
    );
    expect(shown(desktop, "log out")).not.toContain("setting:system.log-out");
    expect(shown(makeHost({ signedIn: true }).host, "log out")).toContain(
      "setting:system.log-out",
    );
  });

  test("a link opens once, and the preview's old switch opens nothing", () => {
    __loadSettingsLinkForTests("http://localhost/?setting=town.time-of-day");
    expect(takeSettingsLink()).toBe("town.time-of-day");
    expect(takeSettingsLink()).toBeNull();
    __loadSettingsLinkForTests("http://localhost/?settings=next");
    expect(takeSettingsLink()).toBeNull();
    expect(settingsLink("sounds.on", "http://localhost/town?view=1#x")).toBe(
      "http://localhost/town?setting=sounds.on",
    );
  });

  async function render(
    host: SettingsHost,
    initial: string | null = null,
    focus?: string,
  ) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let closed = 0;
    await act(async () => {
      root.render(
        createElement(SettingsHome, {
          host,
          initial,
          focus,
          onClose: () => (closed += 1),
        }),
      );
    });
    const dialog = () =>
      document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Settings"]',
      )!;
    const type = async (text: string) => {
      const input = dialog().querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value",
        )!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const rows = () =>
      [...dialog().querySelectorAll<HTMLElement>("[data-setting]")].map(
        (row) => row.dataset.setting,
      );
    const selectedTab = () =>
      dialog().querySelector('[role="tab"][aria-selected="true"]')!.textContent;
    const unmount = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { dialog, type, rows, selectedTab, unmount, closed: () => closed };
  }

  test("Settings lists every category and changes Town's time of day from a search", async () => {
    const { host } = makeHost();
    const view = await render(host);
    expect(view.selectedTab()).toContain("All");
    expect(
      [...view.dialog().querySelectorAll("h3")].map((h) => h.textContent),
    ).toEqual([
      "Appearance",
      "Town & views",
      "Notifications & sounds",
      "Agents",
      "Keyboard",
      "Integrations",
      "This World",
      "Help",
    ]);
    await view.type("lighting");
    expect(view.rows()[0]).toBe("town.time-of-day");
    const row = view
      .dialog()
      .querySelector<HTMLElement>('[data-setting="town.time-of-day"]')!;
    const day = [...row.querySelectorAll("button")].find(
      (button) => button.textContent === "Day",
    )!;
    await act(async () => day.click());
    expect(townDaylightMode()).toBe("day");
    expect(day.getAttribute("aria-pressed")).toBe("true");
    await view.type("font size");
    expect(view.rows().slice(0, 3).sort()).toEqual([
      "appearance.chat-text",
      "appearance.interface-scale",
      "appearance.terminal-font-size",
    ]);
    await view.type("sounds");
    expect(view.rows()[0]).toBe("sounds.on");
    await view.unmount();
  });

  test("a link opens Settings at its setting's category", async () => {
    const view = await render(makeHost().host, "sounds.volume");
    expect(view.selectedTab()).toContain("Notifications & sounds");
    expect(
      view
        .dialog()
        .querySelector('[data-setting="sounds.volume"]')
        ?.classList.contains("is-highlighted"),
    ).toBe(true);
    await view.unmount();
    const category = await render(makeHost().host, "help");
    expect(category.selectedTab()).toContain("Help");
    await category.unmount();
  });

  test("a row that opens a dialog leaves Settings", async () => {
    const { host, calls } = makeHost();
    const view = await render(host, "keyboard");
    const open = view
      .dialog()
      .querySelector<HTMLButtonElement>(
        '[aria-label="Open Keyboard shortcuts"]',
      )!;
    await act(async () => open.click());
    expect(calls).toEqual(["panel:shortcut-editor"]);
    expect(view.closed()).toBe(1);
    await view.unmount();
  });

  test("everything the old Configuration and Menu held has a home here", () => {
    // Pages open inside Settings; Integrations' rows open it at their row.
    for (const id of [
      "integrations.all",
      "integrations.terminal-transport",
      "system.runtime",
      "system.name",
      "agents.speech",
      "agents.worktree-command",
    ]) {
      const entry = registryEntry(id);
      expect(entry?.kind === "panel" && !!entry.page).toBe(true);
    }
    const focusOf = (id: string) => {
      const entry = registryEntry(id);
      return entry?.kind === "panel" ? entry.page?.focus : undefined;
    };
    expect(focusOf("integrations.sources")).toBe("source:github");
    expect(focusOf("integrations.metrics")).toBe("source:metrics");
    expect(focusOf("integrations.weather")).toBe("source:weather");
    expect(focusOf("integrations.agents")).toBe("harness:");
    expect(ids("upgrade herdr")[0]).toBe("system.runtime");
    expect(ids("connection details")).toContain("system.runtime");
    expect(ids("vault")[0]).toBe("integrations.all");
  });

  test("a page opens inside Settings, and Back returns to its row", async () => {
    const seen: (string | undefined)[] = [];
    let closePage = () => {};
    defineSettings("page-test", [
      {
        kind: "panel",
        id: "test.page",
        category: "system",
        title: "Test page",
        description: "A page for this test",
        scope: "world",
        page: {
          focus: "row:first",
          load: async () => ({
            default: ({ focus, close }) => {
              seen.push(focus);
              closePage = close;
              return createElement("p", { id: "test-page" }, "Page body");
            },
          }),
        },
      },
    ]);
    const view = await render(makeHost().host, "system");
    const open = view
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Open Test page"]')!;
    await act(async () => open.click());
    await act(async () => {});
    expect(view.dialog().querySelector("#test-page")?.textContent).toBe(
      "Page body",
    );
    expect(seen[seen.length - 1]).toBe("row:first");
    expect(view.dialog().textContent).toContain("Applies to: All browsers");
    // The list stays mounted under the page, hidden, so Back keeps its place.
    expect(
      view.dialog().querySelector('input[type="search"]')?.closest("[hidden]"),
    ).not.toBeNull();
    // Escape goes back first, then closes.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(view.dialog().querySelector("#test-page")).toBeNull();
    expect(document.activeElement).toBe(
      view
        .dialog()
        .querySelector('[data-setting="test.page"] .settings-home-go'),
    );
    expect(view.closed()).toBe(0);
    await view.unmount();

    // A link or an element's Connect opens the page at once, at its row.
    const linked = await render(makeHost().host, "test.page", "row:second");
    await act(async () => {});
    expect(linked.dialog().querySelector("#test-page")).not.toBeNull();
    expect(seen[seen.length - 1]).toBe("row:second");
    const back = linked
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Back to Settings"]')!;
    await act(async () => back.click());
    expect(linked.rows()).toContain("test.page");
    await linked.unmount();

    // A page can close Settings itself (Upgrade Herdr does).
    const closing = await render(makeHost().host, "test.page");
    await act(async () => {});
    await act(async () => closePage());
    expect(closing.closed()).toBe(1);
    await closing.unmount();
    defineSettings("page-test", []);
  });

  test("view settings change subscribed consumers through search and Cmd+K", async () => {
    const { useBoardAppearance } = await import(
      "../world/board/useBoardAppearance"
    );
    const { boardPulses, subscribeBoardPulses } = await import(
      "../world/board/boardPulses"
    );
    const { useTownLensState } = await import("../world/town/TownLenses");
    const { useSyncExternalStore } = await import("react");
    let appearance: ReturnType<typeof useBoardAppearance>;
    let lens: ReturnType<typeof useTownLensState>;
    let pulses = true;
    function Views() {
      appearance = useBoardAppearance();
      lens = useTownLensState();
      pulses = useSyncExternalStore(subscribeBoardPulses, boardPulses);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Views)));
    const { host } = makeHost();
    const view = await render(host);
    await view.type("surface");
    const row = view.dialog().querySelector('[data-setting="board.surface"]')!;
    const whiteboard = [...row.querySelectorAll("button")].find(
      (button) => button.textContent === "Whiteboard",
    )!;
    await act(async () => whiteboard.click());
    expect(appearance!.appearance.surface).toBe("whiteboard");
    expect(whiteboard.getAttribute("aria-pressed")).toBe("true");
    const run = async (query: string, key: string) => {
      const action = settingsCommandGroups(registryEntries(), host, query)
        .flatMap((group) => group.actions)
        .find((action) => action.key === key)!;
      expect(action).toBeDefined();
      await act(async () => action.run());
    };
    await run("blackboard", "setting:board.surface:blackboard");
    expect(appearance!.appearance.surface).toBe("blackboard");
    await run("pulses", "setting:board.pulses");
    expect(pulses).toBe(false);
    await run("lens idle", "setting:town.lenses:idle");
    expect(lens!.lens).toBe("idle");
    await view.type("lens");
    expect(
      view
        .dialog()
        .querySelector<HTMLSelectElement>('[data-setting="town.lenses"] select')
        ?.value,
    ).toBe("idle");
    await act(async () => lens!.pick("spend"));
    expect(
      view
        .dialog()
        .querySelector<HTMLSelectElement>('[data-setting="town.lenses"] select')
        ?.value,
    ).toBe("spend");
    expect(location.pathname).not.toBe("/board");
    await view.unmount();
    await act(async () => root.unmount());
  });

  test("view stores persist valid values, suppress unchanged notifications and survive refused storage", async () => {
    const appearance = await import("../world/board/useBoardAppearance");
    const pulses = await import("../world/board/boardPulses");
    const lensStore = await import("../world/town/townLensStore");
    const { worldLocalStorage } = await import("../browserStorage");
    const { BOARD_APPEARANCE_KEY } = await import(
      "../world/board/boardAppearance"
    );
    appearance.setBoardAppearance({
      surface: "whiteboard",
      statusColors: { working: "#abcdef" },
    });
    pulses.setBoardPulses(true);
    let changes = 0;
    const off = appearance.subscribeBoardAppearance(() => {
      changes++;
    });
    const offPulses = pulses.subscribeBoardPulses(() => {
      changes++;
    });
    appearance.setBoardAppearance(appearance.boardAppearanceSnapshot());
    pulses.setBoardPulses(true);
    expect(changes).toBe(0);
    const surface = registryEntry("board.surface")!;
    if (surface.kind !== "setting" || surface.control.type !== "choice")
      throw new Error("surface control");
    surface.control.set(makeHost().host, "blackboard");
    expect(appearance.boardAppearanceSnapshot().statusColors).toEqual({
      working: "#abcdef",
    });
    expect(
      JSON.parse(worldLocalStorage.getItem(BOARD_APPEARANCE_KEY)!),
    ).toEqual(appearance.boardAppearanceSnapshot());
    pulses.setBoardPulses(false);
    expect(worldLocalStorage.getItem(pulses.BOARD_PULSES_KEY)).toBe("off");
    expect(changes).toBe(2);
    off();
    offPulses();
    const write = spyOn(worldLocalStorage, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    try {
      appearance.setBoardAppearance({ surface: "theme", statusColors: {} });
      pulses.setBoardPulses(true);
      lensStore.setTownLens("harness");
      lensStore.townLensActions.close();
      lensStore.townLensActions.open();
      expect(lensStore.townLensSnapshot().lens).toBe("harness");
      lensStore.townLensActions.close();
      const again = appearance.subscribeBoardAppearance(() => {});
      const againPulses = pulses.subscribeBoardPulses(() => {});
      expect(appearance.boardAppearanceSnapshot().surface).toBe("theme");
      expect(pulses.boardPulses()).toBe(true);
      again();
      againPulses();
    } finally {
      write.mockRestore();
    }
    appearance.setBoardAppearance({ surface: "theme", statusColors: {} });
    pulses.setBoardPulses(true);
  });

  test("the development migration switch removes itself and seeds only the retired name", async () => {
    const { seedLegacyTownMasterPreview } = await import(
      "../world/town/legacyTownMaster"
    );
    const { worldLocalStorage } = await import("../browserStorage");
    const {
      OFFICE_PREFERENCES_KEY,
      forgetLegacyTownMaster,
      readOfficePreferences,
    } = await import("../world/officePreferences");
    history.replaceState(null, "", "/board?legacyTownMaster=Lead&keep=yes");
    seedLegacyTownMasterPreview();
    expect(location.search).toBe("?keep=yes");
    expect(
      JSON.parse(worldLocalStorage.getItem(OFFICE_PREFERENCES_KEY)!).townMaster,
    ).toBe("Lead");
    expect(readOfficePreferences(worldLocalStorage)).not.toHaveProperty(
      "townMaster",
    );
    forgetLegacyTownMaster(worldLocalStorage);
    seedLegacyTownMasterPreview();
    expect(
      JSON.parse(worldLocalStorage.getItem(OFFICE_PREFERENCES_KEY)!),
    ).not.toHaveProperty("townMaster");
    history.replaceState(null, "", "/town");
  });

  test("Town master has one synced row leading to the existing agent picker", () => {
    const entry = registryEntry("town.master")!;
    expect(entry.title).toBe("Town master");
    expect(ids("Town master")).toEqual(["town.master"]);
    expect(entry.kind !== "command" && entry.scope).toBe("world");
    expect(entry.kind).toBe("panel");
    const { host, calls } = makeHost();
    if (entry.kind === "panel") entry.open?.(host);
    expect(calls).toEqual(["panel:sounds"]);
    expect(
      registryEntries().filter((entry) => entry.title === "Town master"),
    ).toHaveLength(1);
  });

  test("controls that require their view are found and opened there", async () => {
    expect(ids("status pulses")[0]).toBe("board.pulses");
    expect(ids("whiteboard")[0]).toBe("board.surface");
    expect(ids("town lens")[0]).toBe("town.lenses");
    const opened: string[] = [];
    function BoardMenu() {
      useViewControlRequest("board.colours", () => opened.push("board"));
      return null;
    }
    history.replaceState(null, "", "/town");
    const entry = registryEntry("board.status-colours")!;
    if (entry.kind !== "panel") throw new Error("status colours is a panel");
    entry.open?.(makeHost().host);
    expect(location.pathname).toBe("/board");
    // Board mounts after the address changes and answers the request once.
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(BoardMenu)));
    expect(opened).toEqual(["board"]);
    await act(async () => root.render(createElement("div")));
    await act(async () => root.render(createElement(BoardMenu)));
    expect(opened).toEqual(["board"]);
    // Already on the view: the request is answered at once.
    openViewControl("board", "board.colours");
    expect(opened).toEqual(["board", "board"]);
    await act(async () => root.unmount());

    // Hosts and connections opens Manage connections on whichever view is shown.
    function Hosts() {
      useViewControlRequest("connections.manage", () => opened.push("hosts"));
      return null;
    }
    const hostsRoot = createRoot(document.createElement("div"));
    await act(async () => hostsRoot.render(createElement(Hosts)));
    const hosts = registryEntry("integrations.hosts")!;
    if (hosts.kind !== "panel")
      throw new Error("integrations.hosts is a panel");
    hosts.open?.(makeHost().host);
    expect(location.pathname).toBe("/board");
    expect(opened).toEqual(["board", "board", "hosts"]);
    await act(async () => hostsRoot.unmount());
  });

  test("World name is a page that keeps its own scope and drops an unsaved draft", async () => {
    const { instanceNameClient } = await import("../instanceName");
    const load = spyOn(instanceNameClient, "load").mockResolvedValue({
      title_suffix: "Home",
    });
    const save = spyOn(instanceNameClient, "save").mockResolvedValue({
      title_suffix: "Work",
    });
    try {
      const view = await render(makeHost().host, "system.name");
      for (let i = 0; i < 5; i += 1) await act(async () => {});
      const input = () =>
        view
          .dialog()
          .querySelector<HTMLInputElement>(".instance-name-settings input")!;
      expect(view.dialog().textContent).toContain("Applies to: All browsers");
      expect(view.dialog().textContent).toContain(
        "Saved on this Herdr World server",
      );
      expect(input().value).toBe("Home");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input()),
          "value",
        )!.set!.call(input(), "Unsaved");
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
      // Back leaves the page; opening it again shows the saved name.
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(view.dialog().querySelector(".instance-name-settings")).toBeNull();
      const open = view
        .dialog()
        .querySelector<HTMLButtonElement>('[aria-label="Open World name"]')!;
      await act(async () => open.click());
      for (let i = 0; i < 5; i += 1) await act(async () => {});
      expect(input().value).toBe("Home");
      expect(save).not.toHaveBeenCalled();
      expect(view.closed()).toBe(0);
      await view.unmount();
    } finally {
      load.mockRestore();
      save.mockRestore();
    }
  });

  test("Task notifications says how it delivers, or why it cannot", async () => {
    const { __storeTesting, store } = await import("../store");
    const before = store.get();
    try {
      const status = (patch: Partial<ReturnType<typeof store.get>>) => {
        __storeTesting.replaceState({ ...before, ...patch });
        return registryEntry("notifications.tasks")!;
      };
      const read = (patch: Partial<ReturnType<typeof store.get>>) => {
        const entry = status(patch);
        return entry.kind === "setting" ? entry.status?.() : undefined;
      };
      expect(read({ taskNotificationPermission: "denied" })).toBe(
        "Blocked by browser permissions",
      );
      expect(
        read({
          taskNotificationPermission: "granted",
          taskNotificationsEnabled: true,
          taskNotificationTransport: "push",
        }),
      ).toBe("On · Background push");
      __storeTesting.replaceState({
        ...before,
        taskNotificationPermission: "granted",
        taskNotificationsEnabled: true,
        taskNotificationBusy: true,
      });
      const view = await render(makeHost().host, "notifications.tasks");
      const toggle = view
        .dialog()
        .querySelector<HTMLButtonElement>(
          'button[role="switch"][aria-label="Task notifications"]',
        )!;
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
      expect(view.dialog().textContent).toContain("Saving...");
      // The save finishes without changing the value: the open row follows.
      await act(async () =>
        __storeTesting.replaceState({
          ...before,
          taskNotificationPermission: "granted",
          taskNotificationsEnabled: true,
          taskNotificationTransport: "push",
          taskNotificationBusy: false,
        }),
      );
      expect(toggle.getAttribute("aria-disabled")).toBeNull();
      expect(view.dialog().textContent).not.toContain("Saving...");
      expect(view.dialog().textContent).toContain("On · Background push");
      const setEnabled = spyOn(
        store,
        "setTaskNotificationsEnabled",
      ).mockImplementation(async () => {});
      try {
        await act(async () => toggle.click());
        expect(setEnabled).toHaveBeenCalledWith(false);
      } finally {
        setEnabled.mockRestore();
      }
      await view.unmount();
    } finally {
      __storeTesting.replaceState(before);
    }
  });

  test("the command box's commands are in Settings, with its admission", async () => {
    const ran: string[] = [];
    function CommandBox() {
      useCommandBoxRegistry(
        [
          {
            heading: "Workspaces",
            actions: [
              {
                key: "create-workspace",
                icon: null,
                title: "Create workspace",
                detail: "Open a new Herdr workspace",
                keywords: ["new workspace", "add workspace"],
                run: () => ran.push("create-workspace"),
              },
              {
                key: "create-tab",
                icon: null,
                title: "Create tab",
                keywords: ["new tab"],
                disabledReason: "This connection cannot create tabs",
                run: () => ran.push("create-tab"),
              },
            ],
          },
        ],
        [],
        true,
        (action) => {
          ran.push("through the box");
          action();
        },
      );
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(CommandBox)));
    expect(ids("new workspace")[0]).toBe("command.create-workspace");
    // Cmd+K lists its own commands itself, ranked by the same search.
    expect(
      settingsCommandGroups(registryEntries(), makeHost().host, "new workspace")
        .flatMap((group) => group.actions)
        .map((action) => action.key),
    ).not.toContain("setting:command.create-workspace");

    const view = await render(makeHost().host);
    await view.type("new workspace");
    expect(view.rows()[0]).toBe("command.create-workspace");
    const run = view
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Create workspace"]')!;
    await act(async () => run.click());
    expect(ran).toEqual(["through the box", "create-workspace"]);
    await view.type("new tab");
    const tab = view
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Create tab"]')!;
    expect(tab.disabled).toBe(true);
    expect(view.dialog().textContent).toContain(
      "This connection cannot create tabs",
    );
    await view.unmount();

    // The box goes (another connection): so do its commands.
    await act(async () => root.unmount());
    expect(registryEntry("command.create-workspace")).toBeUndefined();
  });

  test("a row that depends on another setting appears as soon as it is on", async () => {
    let enabled = false;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    defineSettings("availability-test", [
      {
        kind: "setting",
        id: "test.parent",
        category: "notifications",
        title: "Parent switch",
        scope: "browser",
        subscribe,
        control: {
          type: "toggle",
          get: () => enabled,
          set: (_host, on) => {
            enabled = on;
            for (const listener of listeners) listener();
          },
        },
      },
      {
        kind: "setting",
        id: "test.child",
        category: "notifications",
        title: "Child switch",
        scope: "browser",
        subscribe,
        available: () => enabled,
        control: { type: "toggle", get: () => false, set: () => {} },
      },
    ]);
    const view = await render(makeHost().host, "notifications");
    expect(view.rows()).not.toContain("test.child");
    const parent = view
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Parent switch"]')!;
    await act(async () => parent.click());
    expect(view.rows()).toContain("test.child");
    await act(async () => parent.click());
    expect(view.rows()).not.toContain("test.child");
    await view.unmount();
    defineSettings("availability-test", []);
  });
}
