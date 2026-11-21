import type { SourcesService } from "../sources/service";
import { SourceSettingsError } from "../sources/service";
import { handleWorldCliEndpoint } from "../http/world-cli-endpoint";
import type { WorldCliResponse } from "../world/world-cli";
import { object } from "../../../shared/weather";

export const WEATHER_CLI_PATH = "/api/world/weather/cli";
/** Local administration: same loopback, bearer token and no-Origin rule as other CLI verbs. */
export function weatherCliHandler(service: SourcesService) {
  return async (body: unknown): Promise<WorldCliResponse> => {
    const request = object(body);
    try {
      if (request.command === "set") {
        const patch = object(request.params);
        if (
          !Object.keys(patch).length ||
          Object.keys(patch).some(
            (key) => !["enabled", "location"].includes(key),
          )
        )
          throw new SourceSettingsError(
            "Weather CLI takes enabled or location",
          );
        await service.configureWeather(patch);
      } else if (request.command !== "get")
        throw new SourceSettingsError("Weather command is get or set");
      service.weather.refresh();
      // Only the explicit CLI read waits (bounded to six seconds); World APIs never do.
      await service.weather.settled();
      return {
        ok: true,
        actor: { label: "local weather CLI", verified: false },
        result: {
          settings: service.weather.settings(),
          weather: service.weather.snapshot(),
        },
      };
    } catch (cause) {
      return {
        ok: false,
        code: cause instanceof SourceSettingsError ? "usage" : "unavailable",
        error:
          cause instanceof SourceSettingsError
            ? cause.message
            : "Could not save Weather settings",
      };
    }
  };
}
export function handleWeatherCliEndpoint(
  request: Request,
  peer: { address: string; port: number } | null,
  deps: {
    serverPort: number;
    bearerAuth: Parameters<typeof handleWorldCliEndpoint>[2]["bearerAuth"];
    handle: ReturnType<typeof weatherCliHandler>;
  },
) {
  return handleWorldCliEndpoint(request, peer, deps);
}
