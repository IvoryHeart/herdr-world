# Weather source

Open **Settings → Integrations → Sources → Weather → Settings**. Weather is off
by default; **Connect** turns it on and **Disconnect** turns it off. Turning it on
is the only action that permits the World service to contact
[Open-Meteo](https://open-meteo.com/en/docs), which needs no account/key for its
[free non-commercial API](https://open-meteo.com/en/terms).

Enter **Weather location** as a city (optionally followed by country/region) or
`latitude, longitude`, then press **Save weather location**. Place lookup uses
the first matching Open-Meteo result; check the resolved name in the status and
refine the name or use coordinates if it is wrong. The name goes to
`geocoding-api.open-meteo.com`; coarse coordinates go to `api.open-meteo.com`.
Both requests originate on the World service. No credentials, agent information
or runtime connection data are sent.

Alternatively, clear and save the typed location, then press **Use browser
location**. The browser asks for permission once, with no watch or automatic
prompt. Permission refusal, an insecure browser context or an unsupported
browser leaves manual input available. On a remote service this uses the
browser's position. Both typed and browser coordinates are rounded to 0.1°
(roughly city-level) before storage or transmission. A typed location always
wins, even if an older browser permission callback completes later. Remove the
browser fallback with **Remove browser location**. Settings live in the service's
existing `custom.world_sources.weather` block, shared across devices and retained
when Weather is switched off. Clearing the manual input and removing the browser
fallback removes both saved locations.

The service requests current model-based conditions and up to six upcoming hours.
It caches the result in memory and refreshes on demand at most every 15 minutes
per configuration, including **Refresh Sources**. Multiple browsers share one
flight.
There is no background timer when nobody reads weather. The total request budget
is six seconds, each response is limited to 32 KiB, redirects are refused and the
provider host cannot be customized. No automatic retry runs. At the next due read,
a failure clears weather immediately; cached conditions expire at 30 minutes.
An outage therefore can remain hidden by the cache until refresh is due. World
continues to work while the request runs or fails. Disabling or changing settings
aborts and retires old requests. Place lookup is cached for the active settings.
Town's sky follows the current condition when its Sky panel is set to
**Real weather**; the [appearance notes](../openspec/specs/world-surfaces/appearance/notes.md) describe what each condition looks like.

Weather data: [Open-Meteo](https://open-meteo.com/),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); place data: GeoNames.
The free endpoint is limited to non-commercial use; World does not configure a
commercial key. Provider conditions are model output, not guaranteed station
observations. This is ambient weather, unsuitable for safety decisions.

## CLI

Use the running service's existing local CLI credentials:

```sh
herdr-world weather location "Example City"
herdr-world weather on
herdr-world weather
herdr-world weather --json
herdr-world weather location "51.5, -0.1"
herdr-world weather off
```

`weather location` with no value shows the saved location. `weather location ""`
clears the typed place. Only the explicit CLI waits for an in-flight refresh,
up to the six-second budget, so the initial command can print current weather.
A provider outage prints unavailable with a successful CLI query exit; failure to
reach/save through World is an error. The CLI uses loopback/token/no-Origin
admission, not browser location permission or a runtime connection.

## Consumer contract

`GET /api/world/weather` returns immediately. The same value is
`GET /api/world/sources` → `weather` and
`useWorldSources().weather` / `worldSourcesStore.snapshot().weather` in the browser.
The Integrations registry lists `source:weather` with kind `source` and
`provides: ["weather"]`; its controls use the same source settings endpoint.
Old services missing the field decode as unavailable. Screens should draw weather
only when `state === "available"`, `current` exists and `expiresAt` is still in
the future. No work cards are created.
`PUT /api/world/sources/weather` accepts any subset of `enabled`, `location`,
`browserLocation` (a coarse coordinate pair or null), using normal settings access.
Locations are validated before any settings persist. Example available value:

```json
{
  "state": "available",
  "reason": null,
  "location": { "label": "Example City", "latitude": 51.5, "longitude": -0.1 },
  "current": { "condition": "rain", "intensity": 0.5, "temperatureC": 8.5, "isDay": true, "at": 1795089600000 },
  "nextHours": [{ "condition": "cloudy", "intensity": 1, "temperatureC": 9, "isDay": true, "at": 1795093200000 }],
  "readAt": 1795089600000,
  "expiresAt": 1795091400000
}
```

Times are epoch milliseconds; `at` is the provider valid time, `readAt` is when
World read it. `isDay` comes from the location's provider value, never the device
clock. The small condition set is `clear`, `cloudy`, `rain`, `snow`, `fog`, `storm`,
`wind`. Intensity is relative 0..1 from WMO severity: clear 0; cloudy 0.5/1;
fog 0.5/1; rain and snow 0.25/0.5/0.75/1 where applicable; storm 0.5/1.
Wind replaces only clear/cloudy at ≥40 km/h, intensity `min(1, speed/100)`.
Unknown codes or invalid required data mean unavailable rather than clear.
Hourly points use the same fields, strictly in the next six hours.

Unavailable is `{ "state": "unavailable", "reason": "provider_error",
"location": null, "current": null, "nextHours": [], "readAt": null,
"expiresAt": null }`. Other reasons are `disabled`, `location_required`,
`refreshing`, `expired`. Screens must stop showing old conditions after a failed
service read. The adapter is isolated in `server/src/weather/provider.ts`.

## Trying unavailable in a preview

In a development preview (or built preview using
`HERDR_WORLD_BUILD_DEVTOOLS=1 bun run build:web`), open `/town?weatherPreview=unavailable`, then
**Settings → Integrations → Sources → Weather → Settings**. The parameter is
removed immediately, and the status says **Weather preview: unavailable (testing
only)** for this page lifetime.
Navigate around World to check that it still works. Reload to leave the fixture.
This is a display fixture; it makes no settings changes and production builds
ignore it. Actual provider offline/deadline/late-response recovery is covered by
recorded-response service tests without network access. For a real outage test,
disconnect the service's network and read again after the 15-minute interval;
disconnecting a remote browser's network does not disconnect the World service.
