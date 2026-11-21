import {
  coordinateLocation,
  normalizeWeatherSettings,
  unavailableWeather,
  WEATHER_MAX_AGE_MS,
  WEATHER_REFRESH_MS,
  type WeatherLocation,
  type WeatherSettings,
  type WeatherSnapshot,
} from "../../../shared/weather";
import type { WorldSourceStatus } from "../../../shared/worldSources";
import { openMeteoProvider, type WeatherProvider } from "./provider";

/** Optional observations only: no World read waits for a provider request. */
export class WeatherService {
  #settings: WeatherSettings;
  #provider: WeatherProvider;
  #now: () => number;
  #timeoutMs: number;
  #generation = 0;
  #flight: { abort: AbortController; done: Promise<void> } | null = null;
  #attemptAt: number | null = null;
  #snapshot = unavailableWeather("disabled");
  #resolved: WeatherLocation | null = null;
  #closed = false;
  constructor(
    options: {
      settings?: unknown;
      provider?: WeatherProvider;
      now?: () => number;
      timeoutMs?: number;
    } = {},
  ) {
    try {
      this.#settings = normalizeWeatherSettings(options.settings);
    } catch {
      this.#settings = normalizeWeatherSettings({});
    }
    this.#snapshot = unavailableWeather(
      this.#settings.enabled ? "refreshing" : "disabled",
    );
    this.#provider = options.provider ?? openMeteoProvider();
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 6_000;
  }
  settings(): WeatherSettings {
    return structuredClone(this.#settings);
  }
  configure(settings: WeatherSettings) {
    if (JSON.stringify(settings) === JSON.stringify(this.#settings)) return;
    this.#generation++;
    this.#flight?.abort.abort();
    this.#flight = null;
    this.#settings = settings;
    this.#resolved = null;
    this.#attemptAt = null;
    this.#snapshot = unavailableWeather(
      settings.enabled ? "refreshing" : "disabled",
    );
  }
  close() {
    this.#closed = true;
    this.#generation++;
    this.#flight?.abort.abort();
  }
  current(): WeatherSnapshot {
    if (!this.#settings.enabled) return unavailableWeather("disabled");
    if (!this.#settings.location && !this.#settings.browserLocation)
      return unavailableWeather("location_required");
    if (
      this.#snapshot.expiresAt !== null &&
      this.#now() >= this.#snapshot.expiresAt
    )
      return unavailableWeather("expired");
    return structuredClone(this.#snapshot);
  }
  /** A force request never exceeds the provider's 15-minute cadence. */
  snapshot(): WeatherSnapshot {
    this.refresh();
    return this.current();
  }
  refresh(): void {
    if (
      this.#closed ||
      !this.#settings.enabled ||
      (!this.#settings.location && !this.#settings.browserLocation) ||
      this.#flight
    )
      return;
    const now = this.#now();
    if (this.#attemptAt !== null && now - this.#attemptAt < WEATHER_REFRESH_MS)
      return;
    this.#attemptAt = now;
    const generation = this.#generation;
    const settings = this.settings();
    const abort = new AbortController();
    // The race also bounds a broken provider that ignores AbortSignal.
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      abort.signal.addEventListener(
        "abort",
        () => reject(new Error("Weather request retired")),
        { once: true },
      );
      timeout = setTimeout(() => abort.abort(), this.#timeoutMs);
    });
    const request = async () => {
      let location = this.#resolved;
      if (!location) {
        if (settings.location)
          location =
            coordinateLocation(settings.location) ??
            (await this.#provider.locate(settings.location, abort.signal));
        else {
          const p = settings.browserLocation!;
          location = { ...p, label: `${p.latitude}, ${p.longitude}` };
        }
      }
      if (abort.signal.aborted || generation !== this.#generation)
        throw new Error("Retired weather location");
      this.#resolved = location;
      const data = await this.#provider.read(
        location,
        abort.signal,
        this.#now(),
      );
      return { location, data };
    };
    const done = Promise.race([request(), deadline])
      .then(({ location, data }) => {
        if (generation !== this.#generation) return;
        const readAt = this.#now();
        this.#snapshot = {
          state: "available",
          reason: null,
          location,
          ...data,
          readAt,
          expiresAt: Math.min(
            readAt + WEATHER_MAX_AGE_MS,
            data.current.at + WEATHER_MAX_AGE_MS,
          ),
        };
      })
      .catch(() => {
        if (generation === this.#generation)
          this.#snapshot = unavailableWeather("provider_error");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.#flight?.done === done) this.#flight = null;
      });
    this.#flight = { abort, done };
  }
  refreshing(): boolean {
    return this.#flight !== null;
  }
  /** Only explicit CLI reads and deterministic tests await the bounded flight. */
  settled(): Promise<void> {
    return this.#flight?.done ?? Promise.resolve();
  }
  status(): WorldSourceStatus {
    const weather = this.current();
    const state = !this.#settings.enabled
      ? "disabled"
      : weather.state === "available"
        ? "connected"
        : weather.reason === "provider_error" || weather.reason === "expired"
          ? "error"
          : "not_connected";
    const detail =
      state === "disabled"
        ? "Weather is switched off. No location is sent to Open-Meteo."
        : weather.current
          ? `${weather.location!.label}: ${weather.current.condition}, ${weather.current.temperatureC} °C, ${weather.current.isDay ? "day" : "night"}.`
          : weather.reason === "location_required"
            ? "Set a place or coordinates, or press Use browser location."
            : weather.reason === "refreshing"
              ? "Reading weather from Open-Meteo…"
              : "Weather unavailable. World carries on; Open-Meteo will be tried on the next refresh.";
    return {
      id: "weather",
      label: "Weather",
      enabled: this.#settings.enabled,
      state,
      detail,
      checkedAt: this.#attemptAt ?? 0,
      lastSuccessAt: weather.readAt,
      itemCount: weather.current ? 1 : 0,
      config: { kind: "weather", ...this.settings() },
    };
  }
}
