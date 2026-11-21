import { afterEach, expect, test } from "bun:test";
import { createWeatherCommand } from "./weather";
import { createTestCli, type TestCli } from "./test-context";
import { unavailableWeather } from "../../../shared/weather";
let cli: TestCli | undefined;
afterEach(() => cli?.cleanup());

test("weather CLI shows/sets location and toggles without unrequested commands", async () => {
  cli = createTestCli();
  const requests: unknown[] = [];
  const command = createWeatherCommand(async (verb, params) => {
    requests.push({ verb, params });
    return {
      ok: true,
      result: {
        settings: { enabled: true, location: "1, 2", browserLocation: null },
        weather: unavailableWeather(),
      },
    };
  });
  for (const args of [
    [],
    ["location"],
    ["location", "Example City"],
    ["location", "1.234, 2.345"],
    ["on"],
    ["off"],
    ["--json"],
  ])
    expect(await command.run(args, cli.context)).toBe(0);
  expect(requests).toEqual([
    { verb: "get", params: {} },
    { verb: "get", params: {} },
    { verb: "set", params: { location: "Example City" } },
    { verb: "set", params: { location: "1.2, 2.3" } },
    { verb: "set", params: { enabled: true } },
    { verb: "set", params: { enabled: false } },
    { verb: "get", params: {} },
  ]);
  expect(cli.output.join("\n")).toContain("Weather unavailable");
  expect(cli.output.join("\n")).toContain("Open-Meteo receives");
  expect(JSON.parse(cli.output.at(-1)!)).toHaveProperty("weather");
});

test("weather help and invalid arguments make no service requests", async () => {
  cli = createTestCli();
  let calls = 0;
  const command = createWeatherCommand(async () => {
    calls++;
    return { ok: false };
  });
  await command.run(["--help"], cli.context);
  expect(cli.output.join("\n")).toContain("non-commercial");
  for (const args of [
    ["on", "surprise"],
    ["location", "91, 0"],
    ["--unknown"],
    ["forecast"],
  ])
    await expect(command.run(args, cli.context)).rejects.toThrow();
  expect(calls).toBe(0);
  expect(await command.run([], cli.context)).toBe(1);
});

test("current weather prints the normalized reading and observation time", async () => {
  cli = createTestCli();
  const at = 1795089600000;
  const command = createWeatherCommand(async () => ({
    ok: true,
    result: {
      settings: { enabled: true, location: "1, 2" },
      weather: {
        state: "available",
        reason: null,
        location: { label: "Example", latitude: 1, longitude: 2 },
        current: {
          condition: "snow",
          intensity: 0.5,
          temperatureC: -1,
          isDay: false,
          at,
        },
        readAt: at,
        expiresAt: at + 1000,
        nextHours: [],
      },
    },
  }));
  await command.run([], cli.context);
  expect(cli.output.join("\n")).toContain(
    "Example: snow (0.5), -1 °C, night; read",
  );
});
