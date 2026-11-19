import { useEffect, useState } from "react";
import {
  normalizeWeatherSettings,
  type WeatherSettings,
  type WeatherSnapshot,
} from "../../../shared/weather";
import { updateWorldSource } from "./worldSources";
import { browserWeatherLocation } from "./weatherLocation";

type Run = (
  label: string,
  task: () => Promise<unknown>,
  done: string,
) => Promise<unknown>;
export function WeatherConsent() {
  return (
    <p className="integration-field-help" id="weather-consent">
      Off by default. Only turning Weather on lets the World service contact
      Open-Meteo: your typed place name goes to its geocoding service, and
      city-level coordinates go to its weather service. No account or key; the
      free API is for non-commercial use. Browser location is requested once,
      only when you press Use browser location in Weather settings; a typed
      location always wins.
    </p>
  );
}

export function WeatherSourceSettings({
  settings,
  weather,
  busy,
  run,
}: {
  settings: WeatherSettings;
  weather?: WeatherSnapshot;
  busy: boolean;
  run: Run;
}) {
  const [location, setLocation] = useState(settings.location);
  useEffect(() => setLocation(settings.location), [settings.location]);
  return (
    <>
      <form
        className="integration-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            "source:weather",
            () =>
              updateWorldSource("weather", {
                location: normalizeWeatherSettings({ location }).location,
              }),
            "Weather location saved.",
          );
        }}
      >
        <label className="form-field">
          <span>Weather location</span>
          <input
            value={location}
            maxLength={120}
            placeholder="City, country or 51.5, -0.1"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setLocation(event.currentTarget.value)}
          />
        </label>
        <p className="integration-field-help">
          Coordinates are rounded to 0.1° before storage and sending. Clear and
          save the typed location to use the browser location
          {settings.browserLocation
            ? ` (${settings.browserLocation.latitude}, ${settings.browserLocation.longitude})`
            : ""}
          . On a remote World service, this uses your browser's location, not
          the service's.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy || !!location.trim() || !!settings.location}
            onClick={() =>
              void run(
                "source:weather",
                async () => {
                  const browserLocation = await browserWeatherLocation();
                  await updateWorldSource("weather", { browserLocation });
                },
                "Coarse browser location saved.",
              )
            }
          >
            Use browser location
          </button>
          <button type="submit" disabled={busy}>
            Save weather location
          </button>
        </div>
        {settings.browserLocation ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                "source:weather",
                () => updateWorldSource("weather", { browserLocation: null }),
                "Browser location removed.",
              )
            }
          >
            Remove browser location
          </button>
        ) : null}
      </form>
      {weather?.current ? (
        <p className="integration-field-help" role="status">
          Read {new Date(weather.readAt!).toLocaleString()}.{" "}
          {weather.nextHours.length} upcoming hours available.
        </p>
      ) : null}
      <p className="integration-field-help">
        Weather data by{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        (
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        ), place names from GeoNames. The free API is for non-commercial use.
        Refreshes at most every 15 minutes; a failed read means weather
        unavailable.
      </p>
    </>
  );
}
