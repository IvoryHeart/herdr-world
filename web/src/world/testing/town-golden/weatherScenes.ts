import type { WeatherCondition } from "../../../../../shared/weather";
import type { TownDaylightMode } from "../../town/townDaylight";

/**
 * Town's weather goldens: each weather held by hand (townWeather.ts) at a
 * time of day that shows it, captured on a laptop and a phone. The night
 * scene without weather keeps its own five goldens, unchanged by weather.
 */
export const TOWN_GOLDEN_WEATHER: readonly {
  scene: string;
  weather: WeatherCondition;
  time: Exclude<TownDaylightMode, "clock">;
}[] = [
  { scene: "weather-clear-day", weather: "clear", time: "day" },
  { scene: "weather-cloudy-day", weather: "cloudy", time: "day" },
  { scene: "weather-rain-day", weather: "rain", time: "day" },
  { scene: "weather-snow-day", weather: "snow", time: "day" },
  { scene: "weather-fog-dusk", weather: "fog", time: "dusk" },
  { scene: "weather-wind-dusk", weather: "wind", time: "dusk" },
  { scene: "weather-storm-night", weather: "storm", time: "night" },
];

/** The viewports each weather scene is captured at. */
export const TOWN_GOLDEN_WEATHER_VIEWPORTS = ["phone", "mac-laptop"];
