# World weather

## Purpose

Supply one explicitly enabled, coarse-location weather observation to World consumers without delaying the rest of World or requiring a provider account.

## Requirements

### Requirement: Explicit weather opt-in and single location

World SHALL list Weather in Integrations → Sources, disabled by default.

#### Scenario: Weather consent and location privacy

- **WHEN** World configures or enables Weather
- **THEN** Only enabling Weather SHALL authorize provider requests, including place lookup. Its Connect control SHALL explain that Open-Meteo receives a typed place for geocoding and coarse coordinates for weather. World SHALL store one manual place/coordinate setting and an optional one-shot browser fallback with the other service settings. A nonempty manual setting SHALL always take precedence. Coordinates SHALL be rounded to 0.1 degrees before storage or transmission. Browser permission SHALL be requested once only after the user presses Use browser location, with no watch or automatic prompt.

#### Scenario: Configure while off
- **WHEN** the user saves a city or browser coordinates while Weather is off
- **THEN** World saves the setting without contacting either provider endpoint

#### Scenario: Manual location overrides browser
- **WHEN** a manual place exists alongside browser coordinates, including coordinates returned by an older permission request
- **THEN** weather is requested only for the manual place

#### Scenario: Browser refuses permission
- **WHEN** the user presses Use browser location and permission is denied or unavailable
- **THEN** World offers manual input and does not replace the saved location

### Requirement: Bounded nonblocking weather acquisition

World SHALL read current conditions and no more than six upcoming hours through one replaceable provider boundary.

#### Scenario: Weather refresh bounds and retirement

- **WHEN** World acquires weather observations
- **THEN** Provider requests SHALL have time, size and frequency limits. Refresh SHALL be demand-driven at most every 15 minutes per configuration, with one flight per configuration and a six-second deadline. World observation APIs SHALL immediately return cached weather or unavailable, without awaiting the provider. Weather SHALL become unavailable on a failed refresh or when cached conditions reach 30 minutes old; old data SHALL NOT masquerade as current. Disabling, changing location or stopping SHALL retire old requests so late completion cannot restore their observations. Location changes SHALL take effect only after settings persistence succeeds.

#### Scenario: Provider offline or malformed
- **WHEN** a due weather request fails, times out, is too large or lacks valid current/hourly fields
- **THEN** World carries on and exposes unavailable with no stale weather or raw provider errors

#### Scenario: Location changes during lookup or fetch
- **WHEN** a lookup or fetch finishes after its location is replaced or Weather is disabled
- **THEN** it cannot publish data or start a request for the retired location

#### Scenario: Concurrent settings saves
- **WHEN** a location save and an enablement save overlap
- **THEN** both durable changes survive in order, without fetching for settings that failed to save

### Requirement: Shared weather API and CLI

World SHALL expose a small weather value in its Sources API/store and at GET /api/world/weather: available/unavailable, one resolved coarse location, current condition (clear, cloudy, rain, snow, fog, storm or wind), intensity in 0..1, Celsius temperature, day/night at that place, provider valid time, read time, expiry and at most six hourly readings.

#### Scenario: Weather values, views and CLI admission

- **WHEN** World serves or administers weather data
- **THEN** Unavailable SHALL contain null current data and an empty hourly list. Weather SHALL NOT generate work items. Town MAY draw the current condition only while that browser's Sky choice follows real weather, and SHALL draw no weather from an unavailable or expired reading. The local CLI SHALL show/set location, turn Weather on/off and print the current reading. CLI administration SHALL use World's existing loopback, bearer-token and no-Origin rules; only explicit CLI requests MAY await the bounded provider read. Invalid coordinates, excessive text, unknown settings, multiple locations and custom provider URLs SHALL be refused.

#### Scenario: Town follows real weather
- **WHEN** a browser's Town follows real weather and the reading becomes unavailable or expires
- **THEN** Town draws no weather and looks as it does with weather off

#### Scenario: Read current weather from CLI
- **WHEN** the user enables Weather, saves a location and runs herdr-world weather
- **THEN** the CLI prints current normalized conditions or unavailable after the bounded read

#### Scenario: Remote or browser CLI request
- **WHEN** a non-loopback peer, browser Origin or invalid token calls the weather CLI endpoint
- **THEN** World refuses it without changing settings or contacting the provider
