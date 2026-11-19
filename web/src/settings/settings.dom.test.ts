import { expect, test } from "bun:test";

// The Settings prototype (#1035): one registry, one search, the Settings
// screen and the command box, with the real catalog and a stand-in host.
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
  const { SettingsHome } = await import("./SettingsHome");
  const {
    __loadSettingsFlagForTests,
    settingsLink,
    settingsPrototypeOn,
    takeSettingsLink,
  } = await import("./flag");
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
      openConfiguration: (tab) => calls.push(`configuration:${tab}`),
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

  test("the flag lasts for the tab, and a link opens once", () => {
    __loadSettingsFlagForTests("http://localhost/?settings=next");
    expect(settingsPrototypeOn()).toBe(true);
    __loadSettingsFlagForTests("http://localhost/?setting=town.time-of-day");
    expect(takeSettingsLink()).toBe("town.time-of-day");
    expect(takeSettingsLink()).toBeNull();
    __loadSettingsFlagForTests("http://localhost/?settings=off");
    expect(settingsPrototypeOn()).toBe(false);
    expect(settingsLink("sounds.on", "http://localhost/town?view=1#x")).toBe(
      "http://localhost/town?setting=sounds.on",
    );
  });

  async function render(host: SettingsHost, initial: string | null = null) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let closed = 0;
    await act(async () => {
      root.render(
        createElement(SettingsHome, {
          host,
          initial,
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

  test("a row that opens today's dialog leaves Settings", async () => {
    const { host, calls } = makeHost();
    const view = await render(host, "integrations");
    const open = view
      .dialog()
      .querySelector<HTMLButtonElement>('[aria-label="Open Sources"]')!;
    await act(async () => open.click());
    expect(calls).toEqual(["panel:sources"]);
    expect(view.closed()).toBe(1);
    await view.unmount();
  });
}
