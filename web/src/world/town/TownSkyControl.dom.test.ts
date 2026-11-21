import { expect, test } from "bun:test";

if (process.env.TOWN_SKY_DOM !== "1") {
  test("Town's sky control in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_SKY_DOM: "1" },
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
  }, 15_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLButtonElement: browser.HTMLButtonElement,
    KeyboardEvent: browser.KeyboardEvent,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    localStorage: browser.localStorage,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TownSkyControl, townRealWeatherLine } = await import(
    "./TownSkyControl"
  );
  const { townDaylightMode, TOWN_DAYLIGHT_KEY, resetTownDaylightForTest } =
    await import("./townDaylight");
  const {
    townWeatherMode,
    setTownRealWeather,
    TOWN_WEATHER_KEY,
    resetTownWeatherForTest,
  } = await import("./townWeather");
  const { SETTINGS_OPEN_EVENT } = await import("../../settings/host");
  const { unavailableWeather } = await import("../../../../shared/weather");
  const { worldLocalStorage } = await import("../../browserStorage");

  const fresh = () => {
    worldLocalStorage.removeItem(TOWN_DAYLIGHT_KEY);
    worldLocalStorage.removeItem(TOWN_WEATHER_KEY);
    resetTownDaylightForTest();
    resetTownWeatherForTest();
  };
  const rain = () => ({
    state: "available" as const,
    reason: null,
    location: { label: "Example City", latitude: 0, longitude: 0 },
    current: {
      condition: "rain" as const,
      intensity: 0.7,
      temperatureC: 6.6,
      isDay: true,
      at: Date.now(),
    },
    nextHours: [],
    readAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  });

  async function mount() {
    const host = document.createElement("div");
    host.className = "town-zoom";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(TownSkyControl)));
    const trigger = () =>
      host.querySelector<HTMLButtonElement>(".town-zoom-daylight")!;
    const click = (target: Element) =>
      act(async () => {
        (target as HTMLButtonElement).click();
      });
    const option = (value: string) =>
      host.querySelector<HTMLButtonElement>(
        `.town-sky-option[data-value="${value}"]`,
      )!;
    return {
      host,
      trigger,
      click,
      option,
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("the button opens one panel for time of day and weather", async () => {
    fresh();
    const sky = await mount();
    expect(sky.trigger().getAttribute("aria-expanded")).toBe("false");
    expect(sky.host.querySelector(".town-sky")).toBeNull();
    await sky.click(sky.trigger());
    const panel = sky.host.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute("aria-label")).toBe("Sky");
    const groups = [...panel.querySelectorAll('[role="radiogroup"]')];
    expect(
      groups.map((g) => g.querySelectorAll('[role="radio"]').length),
    ).toEqual([4, 9]);
    // The current choices are checked, and focus lands on the first.
    expect(sky.option("clock").getAttribute("aria-checked")).toBe("true");
    expect(sky.option("real").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(sky.option("clock"));
    await sky.close();
  });

  test("choosing a time or a weather holds it, per browser", async () => {
    fresh();
    const sky = await mount();
    await sky.click(sky.trigger());
    await sky.click(sky.option("dusk"));
    await sky.click(sky.option("snow"));
    expect(townDaylightMode()).toBe("dusk");
    expect(townWeatherMode()).toBe("snow");
    expect(worldLocalStorage.getItem(TOWN_WEATHER_KEY)).toBe("snow");
    expect(sky.option("snow").getAttribute("aria-checked")).toBe("true");
    // The button now shows and names the held weather.
    expect(sky.trigger().getAttribute("aria-label")).toBe(
      "Sky: time dusk; weather snow",
    );
    await sky.click(sky.option("off"));
    expect(townWeatherMode()).toBe("off");
    expect(sky.trigger().getAttribute("aria-label")).toBe(
      "Sky: time dusk; weather off",
    );
    await sky.close();
  });

  test("real weather says what it is doing, or why it shows none", async () => {
    fresh();
    setTownRealWeather(rain());
    const sky = await mount();
    await sky.click(sky.trigger());
    expect(sky.option("real").textContent).toContain("Rain 7° · Example City");
    expect(sky.trigger().getAttribute("aria-label")).toBe(
      "Sky: time follows your clock; weather real, rain",
    );
    await act(async () => setTownRealWeather(unavailableWeather("disabled")));
    expect(sky.option("real").textContent).toContain(
      "Weather is off in Integrations",
    );
    expect(sky.trigger().getAttribute("aria-label")).toBe(
      "Sky: time follows your clock; weather real, none shown",
    );
    expect(townRealWeatherLine(unavailableWeather("location_required"))).toBe(
      "Set a place in Integrations",
    );
    await sky.close();
  });

  test("its settings link opens the Weather row in Settings", async () => {
    fresh();
    const sky = await mount();
    const opened: (string | undefined)[] = [];
    const listen = (event: Event) =>
      opened.push((event as CustomEvent<string | undefined>).detail);
    window.addEventListener(SETTINGS_OPEN_EVENT, listen);
    await sky.click(sky.trigger());
    await sky.click(sky.host.querySelector(".town-sky-settings")!);
    expect(opened).toEqual(["integrations.weather"]);
    // The panel closes behind it.
    expect(sky.host.querySelector(".town-sky")).toBeNull();
    window.removeEventListener(SETTINGS_OPEN_EVENT, listen);
    await sky.close();
  });
}
