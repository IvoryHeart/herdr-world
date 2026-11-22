# world-weather notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Town sky and Settings Integrations Sources Weather.

**Code:**

- `server/src/sources/`
- `web/src/world/WeatherSourceSettings.tsx`
- `web/src/world/worldSources.ts`
- `server/src/weather/weather.test.ts`
- `server/src/weather/http.test.ts`
- `web/src/world/WeatherSourceSettings.dom.test.ts`
- `server/src/weather/`

**Pitfalls:**

- Weather is opt-in, bounded and unavailable explicitly on failure.

## Usage reference

## Weather source

- **Optional and shared:** Weather is off by default. Open Settings → Integrations
  → Sources → Weather → Settings to configure it, or search Settings or Cmd+K
  for **weather** (or **location**) to reach **Weather place and source**, the
  row Town's sky button links to (`?setting=integrations.weather`).
  **Connect** turns it on and **Disconnect** turns it off. Only turning it on permits Open-Meteo requests.
  A typed place name goes to its geocoding service; city-level coordinates go to its weather service. No account
  or key; the free API is for non-commercial use.
- **One location:** type a city/country or latitude, longitude. Typed input always
  wins over the optional browser fallback. **Use browser location** requests
  permission once only when pressed; no automatic prompt, tracking or watch.
  Coordinates are rounded to 0.1° before storage/sending. Settings are service-owned
  and shared across devices, including a remote browser.
- **Bounded observations:** current model conditions and at most six upcoming
  hours, cached in memory. Demand-driven refresh at most every 15 minutes per
  configuration, including Refresh Sources; six-second total deadline, 32 KiB per
  response. Reads never wait. Failure clears weather; cached conditions expire
  after 30 minutes. World keeps running with weather unavailable.
- **Limits/refusals:** one place, first geocoding match, no long forecasts, custom
  provider hosts, keys, multiple locations or Town drawings. Invalid coordinates,
  over-120-character/control-character text and unknown settings refuse before
  saving. Disabling aborts pending reads; their late results cannot return.
- **API/CLI:** a small normalized value (condition, relative intensity, Celsius,
  local day/night, valid/read time or unavailable) is in the Sources store and
  `GET /api/world/weather`. `herdr-world weather [--json]`, `weather location
  "City"`, `weather on|off` share settings; CLI reads alone may wait six seconds.
  [Weather guide](../../../docs/weather.md) describes fields, attribution, precision,
  cache/outage behavior and a development-only unavailable fixture.
