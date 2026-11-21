import { expect, test } from "bun:test";
import { SourcesService, type StoredSourceSettings } from "../sources/service";
import { CheckoutResolver } from "../sources/links";
import {
  createSourcesHttpHandler,
  storedSourceSettings,
  withSourceSettings,
} from "../sources/http";
import { handleWeatherCliEndpoint, weatherCliHandler } from "./cli";
import { normalizeWeatherSettings } from "../../../shared/weather";
import type { GuiSettings } from "../config/gui-settings";
import forecast from "./fixtures/forecast.json";
const NOW = forecast.current.time * 1000;
function setup() {
  let saved: StoredSourceSettings = {};
  let failSave = false;
  let calls = 0;
  const run = async () => ({ code: 127, stdout: "", stderr: "" });
  const service = new SourcesService({
    settings: { github: { enabled: false }, jira: { enabled: false } },
    persistSettings: async (settings) => {
      if (failSave) throw new Error("private storage path");
      saved = structuredClone(settings);
    },
    secrets: { read: () => ({}), write() {} },
    run,
    topology: async () => [],
    resolver: new CheckoutResolver(run, () => null),
    now: () => NOW,
    fetchImpl: async () => {
      calls++;
      return Response.json(forecast);
    },
  });
  const handler = createSourcesHttpHandler(service);
  const request = (method: string, path: string, body?: unknown) =>
    handler(
      new Request(`http://world.example${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { "content-type": "application/json" },
            }),
      }),
      path,
    );
  return {
    service,
    request,
    saved: () => saved,
    calls: () => calls,
    fail: () => {
      failSave = true;
    },
  };
}

test("API opt-in persists coarse settings, returns immediately, and disables immediately", async () => {
  const f = setup();
  expect(
    (await (await f.request("GET", "/api/world/weather"))!.json()).reason,
  ).toBe("disabled");
  await f.request("PUT", "/api/world/sources/weather", {
    location: "51.507351, -0.127758",
  });
  expect(f.calls()).toBe(0);
  expect(f.saved().weather?.location).toBe("51.5, -0.1");
  const settings = await f.request("PUT", "/api/world/sources/weather", {
    enabled: true,
  });
  expect(settings?.headers.get("cache-control")).toBe("no-store");
  await f.service.weather.settled();
  const reading = await (await f.request("GET", "/api/world/weather"))!.json();
  expect(reading.state).toBe("available");
  expect(reading.current.condition).toBe("rain");
  await f.request("PUT", "/api/world/sources/weather", { enabled: false });
  expect(
    (await (await f.request("GET", "/api/world/weather"))!.json()).reason,
  ).toBe("disabled");
  expect(f.calls()).toBe(1);
});

test("invalid settings are refused before persistence and failed saves leave Weather off", async () => {
  const f = setup();
  for (const patch of [
    { enabled: "true" },
    { provider: "https://private.example" },
    { location: "91, 0" },
    { location: "x".repeat(121) },
    { browserLocation: { latitude: NaN, longitude: 0 } },
    { location: "bad\nplace" },
  ]) {
    expect(
      (await f.request("PUT", "/api/world/sources/weather", patch))?.status,
    ).toBe(400);
  }
  expect(f.saved()).toEqual({});
  f.fail();
  const response = await f.request("PUT", "/api/world/sources/weather", {
    enabled: true,
    location: "1, 2",
  });
  expect(response?.status).toBe(500);
  expect(await response!.text()).not.toContain("private storage path");
  expect(f.service.weather.settings().enabled).toBe(false);
  expect(f.calls()).toBe(0);
});

test("weather settings round-trip and corrupt saved settings fail closed", () => {
  const settings = { custom: { other: 1 } } as unknown as GuiSettings;
  const saved = withSourceSettings(settings, {
    weather: normalizeWeatherSettings({
      enabled: true,
      browserLocation: { latitude: 1.2345, longitude: 2.3456 },
    }),
  });
  expect(saved.custom.other).toBe(1);
  expect(storedSourceSettings(saved).weather).toEqual({
    enabled: true,
    location: "",
    browserLocation: { latitude: 1.2, longitude: 2.3 },
  });
  expect(
    storedSourceSettings({
      custom: { world_sources: { weather: { enabled: "true" } } },
    } as any).weather?.enabled,
  ).toBe(false);
});

test("concurrent weather patches retain location and enablement", async () => {
  const f = setup();
  await Promise.all([
    f.service.configureWeather({ location: "1, 2" }),
    f.service.configureWeather({ enabled: true }),
  ]);
  await f.service.weather.settled();
  expect(f.saved().weather).toMatchObject({ location: "1, 2", enabled: true });
  expect(f.service.weather.settings()).toMatchObject({
    location: "1, 2",
    enabled: true,
  });
});

test("Weather CLI uses loopback/token/no-Origin admission and prints a bounded fresh reading", async () => {
  const f = setup();
  let allowed = true;
  const invoke = (
    command: string,
    params: unknown,
    options: { address?: string; origin?: string } = {},
  ) =>
    handleWeatherCliEndpoint(
      new Request("http://world.example/api/world/weather/cli", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.origin ? { origin: options.origin } : {}),
        },
        body: JSON.stringify({ command, params }),
      }),
      { address: options.address ?? "127.0.0.1", port: 12345 },
      {
        serverPort: 9999,
        bearerAuth: () => (allowed ? true : null),
        handle: weatherCliHandler(f.service),
      },
    );
  for (const options of [
    { address: "192.0.2.1" },
    { origin: "http://world.example" },
  ])
    expect((await invoke("set", { enabled: true }, options)).status).toBe(403);
  allowed = false;
  expect((await invoke("set", { enabled: true })).status).toBe(401);
  expect(f.calls()).toBe(0);
  allowed = true;
  const result = await (
    await invoke("set", { enabled: true, location: "1, 2" })
  ).json();
  expect(result).toMatchObject({
    ok: true,
    result: { weather: { state: "available", current: { condition: "rain" } } },
  });
  expect(
    (await invoke("set", { browserLocation: { latitude: 1, longitude: 2 } }))
      .status,
  ).toBe(400);
});

test("weather HTTP reads and saves do not await a stalled provider", async () => {
  const never = Promise.withResolvers<Response>();
  const run = async () => ({ code: 127, stdout: "", stderr: "" });
  const service = new SourcesService({
    settings: {},
    persistSettings: async () => {},
    secrets: { read: () => ({}), write() {} },
    run,
    topology: async () => [],
    resolver: new CheckoutResolver(run, () => null),
    now: () => NOW,
    fetchImpl: () => never.promise,
  });
  const handler = createSourcesHttpHandler(service);
  try {
    const saved = await handler(
      new Request("http://world.example/api/world/sources/weather", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, location: "1, 2" }),
      }),
      "/api/world/sources/weather",
    );
    expect(saved?.status).toBe(200);
    const reading = await handler(
      new Request("http://world.example/api/world/weather"),
      "/api/world/weather",
    );
    expect((await reading!.json()).reason).toBe("refreshing");
    expect(service.weather.refreshing()).toBe(true);
  } finally {
    service.weather.close();
    await service.weather.settled();
  }
});
