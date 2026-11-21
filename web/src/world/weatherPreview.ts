import { DEVTOOLS } from "./devtools/flag";

/** Development-only display fixture. No settings writes or provider requests. Reload clears it. */
export function takeWeatherUnavailablePreview(enabled = DEVTOOLS): boolean {
  if (!enabled || typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const active = url.searchParams.get("weatherPreview") === "unavailable";
  if (url.searchParams.has("weatherPreview")) {
    url.searchParams.delete("weatherPreview");
    window.history.replaceState(window.history.state, "", url);
  }
  return active;
}
