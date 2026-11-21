import {
  normalizeWeatherSettings,
  parseWeatherSnapshot,
  object,
} from "../../../shared/weather";
import {
  type CliCommand,
  type CliContext,
  EXIT_FAILURE,
  EXIT_OK,
  UsageError,
  parseCommandArgs,
  wantsHelp,
} from "./command";
import { httpTransport, type WorldCliTransport } from "./world";

const help =
  () => `Weather for one place (off by default). Requires a running World service.
Usage:
  herdr-world weather [--json]                 show settings and current reading
  herdr-world weather location ["<city>"|"<latitude>, <longitude>"] [--json]
  herdr-world weather on|off [--json]

Turning Weather on lets the service send the place name to Open-Meteo's
geocoding service and coarse coordinates to its weather service. No account/key.
Free Open-Meteo is for non-commercial use. Weather data: Open-Meteo (CC BY 4.0).
A typed place wins over browser location; location "" clears the typed place.
CLI reads wait at most six seconds; World screens always return immediately.
Refreshes are at most every 15 minutes; failed requests report unavailable.
`;
export function createWeatherCommand(
  transport?: WorldCliTransport,
): CliCommand {
  return {
    name: "weather",
    summary: "set one location and read optional Open-Meteo weather",
    actions: ["location", "on", "off"],
    flags: ["--json"],
    help,
    async run(args: string[], context: CliContext) {
      if (wantsHelp(args)) {
        context.log(help());
        return EXIT_OK;
      }
      const { values, positionals } = parseCommandArgs(
        args,
        { json: { type: "boolean" } },
        2,
      );
      const [action, location] = positionals;
      let patch: Record<string, unknown> | null = null;
      if (!action) {
        /* show */
      } else if (action === "location") {
        if (location !== undefined) {
          try {
            patch = {
              location: normalizeWeatherSettings({ location }).location,
            };
          } catch (cause) {
            throw new UsageError((cause as Error).message);
          }
        }
      } else if (
        (action === "on" || action === "off") &&
        location === undefined
      )
        patch = { enabled: action === "on" };
      else
        throw new UsageError(
          "weather takes location, on or off; see weather --help",
        );
      const reply = await (
        transport ?? httpTransport(context, "/api/world/weather/cli")
      )(patch ? "set" : "get", patch ?? {});
      if (!reply.ok) {
        context.error(reply.error ?? "Weather unavailable");
        return EXIT_FAILURE;
      }
      if (values.json) {
        context.log(JSON.stringify(reply.result, null, 2));
        return EXIT_OK;
      }
      const result = object(reply.result);
      const settings = normalizeWeatherSettings(result.settings);
      const weather = parseWeatherSnapshot(result.weather);
      context.log(
        `Weather: ${settings.enabled ? "on" : "off"}; location: ${settings.location || (settings.browserLocation ? `${settings.browserLocation.latitude}, ${settings.browserLocation.longitude} (browser)` : "not set")}`,
      );
      if (action === "on")
        context.log(
          "Open-Meteo receives the place name/coarse coordinates. Free API: non-commercial use.",
        );
      context.log(
        weather.current
          ? `${weather.location!.label}: ${weather.current.condition} (${weather.current.intensity}), ${weather.current.temperatureC} °C, ${weather.current.isDay ? "day" : "night"}; read ${new Date(weather.readAt!).toISOString()}`
          : `Weather unavailable (${weather.reason}).`,
      );
      return EXIT_OK;
    },
  };
}
