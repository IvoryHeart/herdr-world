/** Service-owned, single-location weather. Temperatures are Celsius, times epoch ms. */
export const WEATHER_CONDITIONS = [
  "clear",
  "cloudy",
  "rain",
  "snow",
  "fog",
  "storm",
  "wind",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];
export type Coordinates = { latitude: number; longitude: number };
export type WeatherLocation = Coordinates & { label: string };
export type WeatherSettings = {
  enabled: boolean;
  location: string;
  browserLocation: Coordinates | null;
};
export type WeatherReading = {
  condition: WeatherCondition;
  /** Relative strength, 0..1. Clear is 0; other conditions use WMO severity/wind speed. */
  intensity: number;
  temperatureC: number;
  isDay: boolean;
  /** Provider's valid time, independent of when World read it. */
  at: number;
};
export type WeatherSnapshot = {
  state: "available" | "unavailable";
  reason:
    | "disabled"
    | "location_required"
    | "refreshing"
    | "provider_error"
    | "expired"
    | null;
  location: WeatherLocation | null;
  current: WeatherReading | null;
  nextHours: WeatherReading[];
  readAt: number | null;
  expiresAt: number | null;
};
export const WEATHER_REFRESH_MS = 15 * 60_000;
export const WEATHER_MAX_AGE_MS = 30 * 60_000;
export function unavailableWeather(
  reason: WeatherSnapshot["reason"] = "provider_error",
): WeatherSnapshot {
  return {
    state: "unavailable",
    reason,
    location: null,
    current: null,
    nextHours: [],
    readAt: null,
    expiresAt: null,
  };
}

/** Never retain or transmit precise browser/typed coordinates. */
export function coarseCoordinates(value: unknown): Coordinates {
  const p = object(value);
  if (!finite(p.latitude, -90, 90) || !finite(p.longitude, -180, 180))
    throw new Error(
      "Weather coordinates need latitude -90..90 and longitude -180..180",
    );
  const round = (n: number) => Number(n.toFixed(1));
  return {
    latitude: round(p.latitude as number),
    longitude: round(p.longitude as number),
  };
}
export function coordinateLocation(text: string): WeatherLocation | null {
  const match =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/u.exec(
      text,
    );
  if (!match) return null;
  const p = coarseCoordinates({
    latitude: Number(match[1]),
    longitude: Number(match[2]),
  });
  return { ...p, label: `${p.latitude}, ${p.longitude}` };
}
export function normalizeWeatherSettings(value: unknown): WeatherSettings {
  const p = object(value);
  if (
    Object.keys(p).some(
      (k) => !["enabled", "location", "browserLocation"].includes(k),
    )
  )
    throw new Error(
      "Weather settings take enabled, location and browserLocation",
    );
  if (p.enabled !== undefined && typeof p.enabled !== "boolean")
    throw new Error("Weather enabled must be true or false");
  if (p.location !== undefined && typeof p.location !== "string")
    throw new Error("Weather location must be text");
  let location = (p.location as string | undefined)?.trim() ?? "";
  if (location.length > 120 || /[\p{Cc}\p{Cf}]/u.test(location))
    throw new Error(
      "Weather location must be a place name or coordinates, up to 120 characters",
    );
  const coords = coordinateLocation(location);
  if (coords) location = coords.label;
  // Numeric-looking malformed coordinate pairs must never become a geocoding query.
  else if (/^[+\-\d.\s,]+$/u.test(location) && location)
    throw new Error("Weather coordinates use latitude, longitude");
  return {
    enabled: p.enabled === true,
    location,
    browserLocation:
      p.browserLocation == null ? null : coarseCoordinates(p.browserLocation),
  };
}
export function parseWeatherSnapshot(value: unknown): WeatherSnapshot {
  const p = object(value);
  if (p.state !== "available")
    return unavailableWeather(
      ["disabled", "location_required", "refreshing", "expired"].includes(
        String(p.reason),
      )
        ? (p.reason as WeatherSnapshot["reason"])
        : "provider_error",
    );
  const point = (value: unknown): WeatherReading | null => {
    const p = object(value);
    if (
      !(WEATHER_CONDITIONS as readonly unknown[]).includes(p.condition) ||
      !finite(p.intensity, 0, 1) ||
      !finite(p.temperatureC, -100, 70) ||
      typeof p.isDay !== "boolean" ||
      !finite(p.at, 1, Number.MAX_SAFE_INTEGER)
    )
      return null;
    return {
      condition: p.condition as WeatherCondition,
      intensity: p.intensity as number,
      temperatureC: p.temperatureC as number,
      isDay: p.isDay,
      at: p.at as number,
    };
  };
  const current = point(p.current);
  const location = object(p.location);
  if (
    !current ||
    !finite(p.readAt, 1, Number.MAX_SAFE_INTEGER) ||
    !finite(
      p.expiresAt,
      (p.readAt as number) + 1,
      (p.readAt as number) + WEATHER_MAX_AGE_MS,
    ) ||
    typeof location.label !== "string" ||
    location.label.length > 160
  )
    return unavailableWeather();
  try {
    return {
      state: "available",
      reason: null,
      location: { ...coarseCoordinates(location), label: location.label },
      current,
      nextHours: (Array.isArray(p.nextHours) ? p.nextHours : [])
        .slice(0, 6)
        .map(point)
        .filter(
          (p): p is WeatherReading =>
            p !== null &&
            p.at > current.at &&
            p.at <= current.at + 6 * 3_600_000,
        ),
      readAt: p.readAt as number,
      expiresAt: p.expiresAt as number,
    };
  } catch {
    return unavailableWeather();
  }
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function finite(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
