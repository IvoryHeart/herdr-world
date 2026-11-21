import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Ban,
  Clock,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Settings,
  Sun,
  Sunset,
  Wind,
} from "lucide-react";
import { useLayer } from "../../layerStack";
import { openSettings } from "../../settings/host";
import type { WeatherSnapshot } from "../../../../shared/weather";
import {
  setTownDaylightMode,
  subscribeTownDaylight,
  TOWN_DAYLIGHT_MODES,
  townDaylightMode,
  type TownDaylightMode,
} from "./townDaylight";
import {
  setTownWeatherMode,
  subscribeTownWeather,
  TOWN_WEATHER_LABEL,
  TOWN_WEATHER_MODES,
  townRealWeather,
  townWeatherMode,
  townWeatherShown,
  type TownWeatherMode,
} from "./townWeather";
import "./townDaylight.css";

const TIME_ICON = { clock: Clock, day: Sun, dusk: Sunset, night: Moon };
const TIME_LABEL: Record<TownDaylightMode, string> = {
  clock: "Your clock",
  day: "Day",
  dusk: "Dusk",
  night: "Night",
};
const WEATHER_ICON = {
  real: CloudSun,
  clear: Sun,
  cloudy: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  fog: CloudFog,
  storm: CloudLightning,
  wind: Wind,
  off: Ban,
};

/** What the real weather is doing, in a few words, or why it is not shown. */
export function townRealWeatherLine(
  snapshot: WeatherSnapshot,
  now = Date.now(),
) {
  const current = snapshot.current;
  if (
    snapshot.state === "available" &&
    current &&
    snapshot.expiresAt !== null &&
    snapshot.expiresAt > now
  ) {
    const place = snapshot.location?.label;
    const temperature = Number.isFinite(current.temperatureC)
      ? ` ${Math.round(current.temperatureC)}°`
      : "";
    return `${TOWN_WEATHER_LABEL[current.condition]}${temperature}${place ? ` · ${place}` : ""}`;
  }
  switch (snapshot.reason) {
    case "disabled":
      return "Weather is off in Integrations";
    case "location_required":
      return "Set a place in Integrations";
    case "refreshing":
      return "Reading the weather…";
    default:
      return "Weather unavailable";
  }
}

/**
 * The sky button under ALL, and its panel: follow your clock or hold a time
 * of day, follow the real weather at the Weather source's place, hold one
 * weather, or show none. Each browser keeps its choices (townDaylight.ts,
 * townWeather.ts). The place and the source are not set here: the panel
 * links to their row in Settings (integrations.weather), which Settings
 * search and the command box find too. The button's icon shows the weather Town shows, or the
 * time of day without weather.
 */
export function TownSkyControl() {
  const daylight = useSyncExternalStore(
    subscribeTownDaylight,
    townDaylightMode,
  );
  const weather = useSyncExternalStore(subscribeTownWeather, townWeatherMode);
  const real = useSyncExternalStore(subscribeTownWeather, townRealWeather);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayer(open, () => setOpen(false), {
    element: () => panel.current,
    anchors: () => [trigger.current],
  });
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus({ preventScroll: true });
  }, [open]);

  const shown = townWeatherShown(weather, real);
  const Icon = shown ? WEATHER_ICON[shown.condition] : TIME_ICON[daylight];
  const timeWords = daylight === "clock" ? "follows your clock" : daylight;
  const weatherWords =
    weather === "real"
      ? shown
        ? `real, ${TOWN_WEATHER_LABEL[shown.condition].toLowerCase()}`
        : "real, none shown"
      : weather === "off"
        ? "off"
        : TOWN_WEATHER_LABEL[weather].toLowerCase();
  const label = `Sky: time ${timeWords}; weather ${weatherWords}`;
  const realLine = townRealWeatherLine(real);

  const option = <M extends string>(
    current: M,
    value: M,
    text: string,
    icon: typeof Clock,
    choose: (value: M) => void,
    detail?: string,
  ) => {
    const OptionIcon = icon;
    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={current === value}
        className="town-sky-option"
        data-value={value}
        onClick={() => choose(value)}
      >
        <OptionIcon size={16} aria-hidden="true" />
        <span>{text}</span>
        {detail ? <small>{detail}</small> : null}
      </button>
    );
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="town-zoom-daylight"
        data-help="town.daylight"
        data-mode={daylight}
        data-weather={weather}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={panel} className="town-sky" role="dialog" aria-label="Sky">
          <div className="town-sky-heading" id="town-sky-time">
            Time of day
          </div>
          <div
            className="town-sky-grid"
            role="radiogroup"
            aria-labelledby="town-sky-time"
          >
            {TOWN_DAYLIGHT_MODES.map((mode) =>
              option(
                daylight,
                mode,
                TIME_LABEL[mode],
                TIME_ICON[mode],
                setTownDaylightMode,
              ),
            )}
          </div>
          <div className="town-sky-heading" id="town-sky-weather">
            Weather
          </div>
          <div
            className="town-sky-grid"
            role="radiogroup"
            aria-labelledby="town-sky-weather"
          >
            {TOWN_WEATHER_MODES.map((mode: TownWeatherMode) =>
              option(
                weather,
                mode,
                TOWN_WEATHER_LABEL[mode],
                WEATHER_ICON[mode],
                setTownWeatherMode,
                mode === "real" ? realLine : undefined,
              ),
            )}
          </div>
          <button
            type="button"
            className="town-sky-settings"
            onClick={() => {
              setOpen(false);
              openSettings("integrations.weather");
            }}
          >
            <Settings size={15} aria-hidden="true" />
            <span>Weather place and source…</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
