import {
  coarseCoordinates,
  object,
  type WeatherCondition,
  type WeatherLocation,
  type WeatherReading,
} from "../../../shared/weather";
import { readJsonBody } from "../http/json-body";

export interface WeatherProvider {
  locate(place: string, signal: AbortSignal): Promise<WeatherLocation>;
  read(
    location: WeatherLocation,
    signal: AbortSignal,
    now: number,
  ): Promise<{ current: WeatherReading; nextHours: WeatherReading[] }>;
}
export type WeatherFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
const VARIABLES = "temperature_2m,weather_code,is_day,wind_speed_10m";
/** Fixed HTTPS endpoints, no redirects, credentials, custom hosts or unbounded bodies. */
export function openMeteoProvider(
  fetchImpl: WeatherFetch = fetch,
): WeatherProvider {
  const request = async (url: URL, signal: AbortSignal) => {
    const response = await fetchImpl(url, {
      signal,
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      void response.body?.cancel();
      throw new Error("Weather provider unavailable");
    }
    const length = Number(response.headers.get("content-length"));
    if (length > 32 * 1024) {
      void response.body?.cancel();
      throw new Error("Weather response too large");
    }
    return object(await readJsonBody(response, 32 * 1024));
  };
  return {
    async locate(place, signal) {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({
        name: place,
        count: "1",
        language: "en",
        format: "json",
      }).toString();
      const data = await request(url, signal);
      const city = object(Array.isArray(data.results) ? data.results[0] : null);
      if (typeof city.name !== "string" || !city.name.trim())
        throw new Error("Place not found");
      const label = [city.name, city.admin1, city.country]
        .filter((s): s is string => typeof s === "string" && !!s.trim())
        .join(", ")
        .slice(0, 160);
      return { ...coarseCoordinates(city), label };
    },
    async read(location, signal, now) {
      const coords = coarseCoordinates(location);
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: String(coords.latitude),
        longitude: String(coords.longitude),
        current: VARIABLES,
        hourly: VARIABLES,
        forecast_hours: "7",
        timeformat: "unixtime",
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        timezone: "GMT",
      }).toString();
      const data = await request(url, signal);
      const point = (row: Record<string, unknown>): WeatherReading => {
        const temp = row.temperature_2m;
        const time = row.time;
        const wind = row.wind_speed_10m;
        if (
          typeof temp !== "number" ||
          !Number.isFinite(temp) ||
          temp < -100 ||
          temp > 70 ||
          typeof time !== "number" ||
          !Number.isFinite(time) ||
          (row.is_day !== 0 && row.is_day !== 1) ||
          typeof wind !== "number" ||
          !Number.isFinite(wind) ||
          wind < 0 ||
          wind > 500
        )
          throw new Error("Incomplete weather");
        const [condition, intensity] = classifyWeather(row.weather_code, wind);
        return {
          condition,
          intensity,
          temperatureC: temp,
          isDay: row.is_day === 1,
          at: time * 1000,
        };
      };
      const current = point(object(data.current));
      if (current.at > now + 5 * 60_000 || current.at < now - 30 * 60_000)
        throw new Error("Weather is out of date");
      const hourly = object(data.hourly);
      const times = hourly.time;
      if (!Array.isArray(times) || times.length > 7 || times.length < 2)
        throw new Error("Incomplete hourly weather");
      const nextHours = times.flatMap((time, i) => {
        const at = typeof time === "number" ? time * 1000 : NaN;
        if (!Number.isFinite(at)) throw new Error("Invalid hourly time");
        if (at <= now || at > now + 6 * 3_600_000) return [];
        return [
          point(
            Object.fromEntries(
              ["time", ...VARIABLES.split(",")].map((key) => [
                key,
                key === "time"
                  ? time
                  : Array.isArray(hourly[key])
                    ? hourly[key][i]
                    : undefined,
              ]),
            ),
          ),
        ];
      });
      if (
        !nextHours.length ||
        nextHours.some((p, i) => i > 0 && p.at <= nextHours[i - 1]!.at)
      )
        throw new Error("Incomplete hourly weather");
      return { current, nextHours };
    },
  };
}
/** WMO severity mapped to relative 0..1 strength; wind overrides only clear/cloudy. */
export function classifyWeather(
  code: unknown,
  wind: number,
): [WeatherCondition, number] {
  if (code === 0 || code === 1 || code === 2 || code === 3) {
    if (wind >= 40) return ["wind", Math.min(1, wind / 100)];
    return code === 0 || code === 1
      ? ["clear", 0]
      : ["cloudy", code === 2 ? 0.5 : 1];
  }
  if (code === 45 || code === 48) return ["fog", code === 45 ? 0.5 : 1];
  const rain = new Map([
    [51, 0.25],
    [53, 0.5],
    [55, 0.75],
    [56, 0.25],
    [57, 0.75],
    [61, 0.25],
    [63, 0.5],
    [65, 1],
    [66, 0.25],
    [67, 1],
    [80, 0.25],
    [81, 0.5],
    [82, 1],
  ]);
  const snow = new Map([
    [71, 0.25],
    [73, 0.5],
    [75, 1],
    [77, 0.25],
    [85, 0.25],
    [86, 1],
  ]);
  if (rain.has(code as number)) return ["rain", rain.get(code as number)!];
  if (snow.has(code as number)) return ["snow", snow.get(code as number)!];
  if ([95, 96, 97, 99].includes(code as number))
    return ["storm", code === 95 ? 0.5 : 1];
  throw new Error("Unknown weather code");
}
