import { expect, test } from "bun:test";
import {
  coarseCoordinates,
  normalizeWeatherSettings,
} from "../../../shared/weather";
import { WeatherService } from "./service";

test("off by default: reads and manual settings never contact the provider", async () => {
  let calls = 0;
  const weather = new WeatherService({
    now: () => 1_000,
    provider: {
      locate: async () => {
        calls++;
        throw new Error("must not run");
      },
      read: async () => {
        calls++;
        throw new Error("must not run");
      },
    },
  });
  weather.configure(normalizeWeatherSettings({ location: "Example City" }));
  expect(weather.snapshot().state).toBe("unavailable");
  expect(calls).toBe(0);
  expect(weather.status().enabled).toBe(false);
});

test("location precision is reduced before it can be stored or sent", () => {
  expect(
    coarseCoordinates({ latitude: 51.507351, longitude: -0.127758 }),
  ).toEqual({ latitude: 51.5, longitude: -0.1 });
  expect(
    normalizeWeatherSettings({ location: "51.507351, -0.127758" }).location,
  ).toBe("51.5, -0.1");
  expect(() => coarseCoordinates({ latitude: 91, longitude: 0 })).toThrow();
});

import forecast from "./fixtures/forecast.json";
import geocoding from "./fixtures/geocoding.json";
import {
  openMeteoProvider,
  classifyWeather,
  type WeatherProvider,
} from "./provider";
import {
  WEATHER_REFRESH_MS,
  WEATHER_MAX_AGE_MS,
} from "../../../shared/weather";
const NOW = forecast.current.time * 1000;
const enabled = (location = "Example City") =>
  normalizeWeatherSettings({ enabled: true, location });
function fixture() {
  let now = NOW;
  let offline = false;
  const calls: URL[] = [];
  const provider = openMeteoProvider(async (input, init) => {
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const url = new URL(String(input));
    calls.push(url);
    if (offline) throw new Error("private upstream failure text");
    const data = structuredClone(forecast);
    const elapsed = (now - NOW) / 1000;
    data.current.time += elapsed;
    data.hourly.time = data.hourly.time.map((t) => t + elapsed);
    return Response.json(
      url.hostname.startsWith("geocoding") ? geocoding : data,
    );
  });
  const weather = new WeatherService({
    settings: enabled(),
    provider,
    now: () => now,
  });
  return {
    weather,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    offline: () => {
      offline = true;
    },
  };
}

test("recorded responses normalize current and six upcoming hours; cache suppresses duplicate reads", async () => {
  const { weather, calls } = fixture();
  expect(weather.snapshot().reason).toBe("refreshing");
  weather.snapshot();
  await weather.settled();
  const reading = weather.snapshot();
  expect(reading).toMatchObject({
    state: "available",
    readAt: NOW,
    current: {
      condition: "rain",
      intensity: 0.5,
      temperatureC: 8.5,
      isDay: true,
    },
    location: { latitude: 51.5, longitude: -0.1 },
  });
  expect(reading.nextHours).toHaveLength(6);
  expect(reading.nextHours.at(-1)).toMatchObject({
    condition: "storm",
    isDay: false,
  });
  expect(calls).toHaveLength(2);
  expect(calls[0]!.searchParams.get("name")).toBe("Example City");
  expect(calls[1]!.searchParams.get("latitude")).toBe("51.5");
  expect(calls[1]!.searchParams.get("forecast_hours")).toBe("7");
  expect(calls[1]!.searchParams.get("longitude")).toBe("-0.1");
});

test("offline clears old weather at the next modest refresh and never exposes upstream errors", async () => {
  const f = fixture();
  f.weather.snapshot();
  await f.weather.settled();
  f.offline();
  f.advance(WEATHER_REFRESH_MS - 1);
  f.weather.snapshot();
  expect(f.calls).toHaveLength(2);
  f.advance(1);
  f.weather.snapshot();
  await f.weather.settled();
  expect(f.weather.current()).toMatchObject({
    state: "unavailable",
    reason: "provider_error",
    current: null,
    nextHours: [],
  });
  expect(JSON.stringify(f.weather.status())).not.toContain("private upstream");
  expect(f.calls).toHaveLength(3); // geocoding is cached for this configuration
  f.weather.snapshot();
  expect(f.calls).toHaveLength(3);
  f.advance(WEATHER_REFRESH_MS);
  f.weather.snapshot();
  await f.weather.settled();
  expect(f.calls).toHaveLength(4);
});

test("expired readings and missing locations are unavailable", async () => {
  const f = fixture();
  f.weather.snapshot();
  await f.weather.settled();
  f.advance(WEATHER_MAX_AGE_MS);
  expect(f.weather.current().reason).toBe("expired");
  f.weather.configure(enabled(""));
  expect(f.weather.snapshot().reason).toBe("location_required");
  expect(f.calls).toHaveLength(2);
});

test("manual location wins over browser fallback; coordinates skip geocoding", async () => {
  const f = fixture();
  f.weather.configure(
    normalizeWeatherSettings({
      enabled: true,
      location: "20.04567, 30.01234",
      browserLocation: { latitude: 1.234, longitude: 2.345 },
    }),
  );
  f.weather.snapshot();
  await f.weather.settled();
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.searchParams.get("latitude")).toBe("20");
  f.weather.configure(
    normalizeWeatherSettings({
      enabled: true,
      browserLocation: { latitude: 1.234, longitude: 2.345 },
    }),
  );
  f.weather.snapshot();
  await f.weather.settled();
  expect(f.calls[1]!.searchParams.get("latitude")).toBe("1.2");
});

test("deadline bounds a provider that ignores cancellation; reads return immediately", async () => {
  const pending = Promise.withResolvers<any>();
  const weather = new WeatherService({
    settings: enabled("1, 2"),
    now: () => NOW,
    timeoutMs: 5,
    provider: {
      locate: async () => {
        throw new Error("unexpected");
      },
      read: () => pending.promise,
    },
  });
  expect(weather.snapshot().state).toBe("unavailable");
  await weather.settled();
  expect(weather.current().reason).toBe("provider_error");
  pending.resolve({ current: { at: NOW }, nextHours: [] });
  await Promise.resolve();
  expect(weather.current().state).toBe("unavailable");
});

for (const phase of ["locate", "read"] as const) {
  for (const transition of ["disable", "location", "close"] as const) {
    test(`retired ${phase} cannot publish after ${transition}`, async () => {
      const pending = Promise.withResolvers<any>();
      let reads = 0;
      let signal: AbortSignal | undefined;
      const provider: WeatherProvider = {
        locate: (_place, s) => {
          signal = s;
          return phase === "locate"
            ? pending.promise
            : Promise.resolve({ latitude: 1, longitude: 2, label: "Example" });
        },
        read: (_location, s) => {
          reads++;
          signal = s;
          return pending.promise;
        },
      };
      const weather = new WeatherService({
        settings: enabled(),
        provider,
        now: () => NOW,
      });
      weather.snapshot();
      await Promise.resolve();
      const old = weather.settled();
      if (transition === "disable")
        weather.configure(
          normalizeWeatherSettings({
            enabled: false,
            location: "Example City",
          }),
        );
      else if (transition === "location")
        weather.configure(enabled("Other City"));
      else weather.close();
      expect(signal?.aborted).toBe(true);
      pending.resolve(
        phase === "locate"
          ? { latitude: 3, longitude: 4, label: "Retired" }
          : {
              current: {
                condition: "clear",
                intensity: 0,
                temperatureC: 10,
                isDay: true,
                at: NOW,
              },
              nextHours: [],
            },
      );
      await old;
      expect(weather.current().state).toBe("unavailable");
      if (phase === "locate") expect(reads).toBe(0);
    });
  }
}

test("a new configuration publishes while a retired request finishes late", async () => {
  const first = Promise.withResolvers<any>();
  const working = openMeteoProvider(async () => Response.json(forecast));
  let n = 0;
  const weather = new WeatherService({
    settings: enabled("1, 2"),
    now: () => NOW,
    provider: {
      locate: working.locate,
      read: (...args) => (++n === 1 ? first.promise : working.read(...args)),
    },
  });
  weather.snapshot();
  const old = weather.settled();
  weather.configure(enabled("3, 4"));
  weather.snapshot();
  await weather.settled();
  first.resolve({ current: { condition: "snow", at: NOW }, nextHours: [] });
  await old;
  expect(weather.current()).toMatchObject({
    state: "available",
    location: { latitude: 3, longitude: 4 },
    current: { condition: "rain" },
  });
});

test("every documented WMO code maps into the small condition set", () => {
  for (const [codes, condition] of [
    [[0, 1], "clear"],
    [[2, 3], "cloudy"],
    [[45, 48], "fog"],
    [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], "rain"],
    [[71, 73, 75, 77, 85, 86], "snow"],
    [[95, 96, 97, 99], "storm"],
  ] as const) {
    for (const code of codes) {
      const [actual, intensity] = classifyWeather(code, 0);
      expect(actual).toBe(condition);
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  }
  expect(classifyWeather(0, 60)).toEqual(["wind", 0.6]);
  expect(classifyWeather(63, 100)).toEqual(["rain", 0.5]);
  expect(() => classifyWeather(999, 0)).toThrow();
});

for (const fault of [
  "http",
  "json",
  "oversize",
  "stream",
  "null",
  "code",
  "old",
  "future",
  "hours",
  "no-place",
] as const) {
  test(`provider refuses ${fault} without a usable reading`, async () => {
    const data = structuredClone(forecast);
    if (fault === "null") data.current.temperature_2m = null as any;
    if (fault === "code") data.current.weather_code = 999;
    if (fault === "old") data.current.time -= 3600;
    if (fault === "future") data.current.time += 3600;
    if (fault === "hours") data.hourly.is_day = [];
    const provider = openMeteoProvider(async () => {
      if (fault === "http") return new Response("error", { status: 429 });
      if (fault === "json") return new Response("bad json");
      if (fault === "oversize")
        return new Response("{}", { headers: { "content-length": "999999" } });
      if (fault === "stream") return new Response("x".repeat(32769));
      return Response.json(fault === "no-place" ? { results: [] } : data);
    });
    if (fault === "no-place")
      await expect(
        provider.locate("Missing", new AbortController().signal),
      ).rejects.toThrow();
    else
      await expect(
        provider.read(
          { latitude: 1, longitude: 2, label: "Example" },
          new AbortController().signal,
          NOW,
        ),
      ).rejects.toThrow();
  });
}
