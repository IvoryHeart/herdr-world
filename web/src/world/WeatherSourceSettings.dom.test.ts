import { expect, test } from "bun:test";
if (process.env.HERDR_WEATHER_DOM !== "1") {
  test("Weather settings in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, HERDR_WEATHER_DOM: "1" },
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
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { SourcesDialog } = await import("./SourcesDialog");
  const { worldSourcesStore, parseWorldSources } = await import(
    "./worldSources"
  );
  const { browserWeatherLocation } = await import("./weatherLocation");
  const { takeWeatherUnavailablePreview } = await import("./weatherPreview");
  const { normalizeWeatherSettings, unavailableWeather } = await import(
    "../../../shared/weather"
  );
  test("explicit permission button, privacy disclosure, typed precedence and saved coarse location", async () => {
    let permissions = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          success: PositionCallback,
          _failure: PositionErrorCallback,
          options: PositionOptions,
        ) {
          permissions++;
          expect(options).toEqual({
            enableHighAccuracy: false,
            maximumAge: 0,
            timeout: 10000,
          });
          success({
            coords: { latitude: 1.23456, longitude: 2.34567 },
          } as GeolocationPosition);
        },
      },
    });
    let settings = normalizeWeatherSettings({});
    const requests: Record<string, unknown>[] = [];
    const snapshot = () =>
      parseWorldSources({
        sources: [
          {
            id: "weather",
            label: "Weather",
            enabled: settings.enabled,
            state: settings.enabled ? "not_connected" : "disabled",
            detail: "Weather unavailable",
            config: { kind: "weather", ...settings },
          },
        ],
        weather: unavailableWeather("disabled"),
      });
    worldSourcesStore.useFetch(async (_input, init) => {
      if (init?.method === "PUT") {
        const patch = JSON.parse(String(init.body));
        requests.push(patch);
        settings = normalizeWeatherSettings({ ...settings, ...patch });
      }
      return Response.json(snapshot());
    });
    worldSourcesStore.publishSettled(snapshot());
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(createElement(SourcesDialog, { onClose() {} })),
      );
      expect(permissions).toBe(0);
      expect(host.textContent).toContain("Only turning Weather on");
      expect(host.textContent).toContain("geocoding service");
      expect(host.textContent).toContain("city-level coordinates");
      const button = () =>
        [...host.querySelectorAll("button")].find(
          (b) => b.textContent === "Use browser location",
        )!;
      await act(async () => button().click());
      expect(permissions).toBe(1);
      expect(requests).toEqual([
        { browserLocation: { latitude: 1.2, longitude: 2.3 } },
      ]);
      await act(async () =>
        (host.querySelector('[role="switch"]') as HTMLButtonElement).click(),
      );
      expect(requests[requests.length - 1]).toEqual({ enabled: true });
      const input = host.querySelector("input") as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "19.3456, 40.5678");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        host
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(requests[requests.length - 1]).toEqual({ location: "19.3, 40.6" });
      settings = normalizeWeatherSettings({
        ...settings,
        location: "Example City",
      });
      await act(async () => worldSourcesStore.publishSettled(snapshot()));
      expect(button().disabled).toBe(true);
      expect((host.querySelector("input") as HTMLInputElement).value).toBe(
        "Example City",
      );
      expect(permissions).toBe(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  test("permission refusal is plain guidance with no raw browser error", async () => {
    await expect(
      browserWeatherLocation({
        getCurrentPosition(_success, failure) {
          failure?.({
            message: "private platform error",
          } as GeolocationPositionError);
        },
      } as Geolocation),
    ).rejects.toThrow("Type a city or coordinates");
  });
  test("development unavailable fixture consumes its URL parameter once", () => {
    window.history.replaceState(
      null,
      "",
      "/town?weatherPreview=unavailable&keep=1",
    );
    expect(takeWeatherUnavailablePreview(false)).toBe(false);
    expect(takeWeatherUnavailablePreview(true)).toBe(true);
    expect(window.location.search).toBe("?keep=1");
    expect(takeWeatherUnavailablePreview(true)).toBe(false);
  });
}
