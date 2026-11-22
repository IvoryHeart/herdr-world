## Why

Issue #1040 authorizes an optional real-weather source for one location so Town can consume conditions separately from visuals.

## What Changes

- Add disabled-by-default Weather in Sources with manual city/coordinates and explicit one-shot browser location.
- Use Open-Meteo behind a small provider interface; bound, cache and isolate requests.
- Expose current conditions and six hours through an API, shared store and local CLI.
- Add recorded-response and lifecycle tests, limits, attribution and consumer documentation.

## Capabilities

### New Capabilities
- `world-weather`: opt-in single-location weather settings and observations.

### Modified Capabilities
None. Existing GitHub/Jira work-source behavior remains applicable to work items.

## Impact

Shared wire types, Sources service/dialog/store, authenticated HTTP and local CLI. No dependencies, additional locations or long forecasts. Issue #1041 adds Town drawing behind each browser's Sky choice; the source stays unaware of it. Authorization is the issue mandate; review remains the delivery boundary.
