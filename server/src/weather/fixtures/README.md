# Open-Meteo response fixtures

Recorded wire shapes from the [forecast](https://open-meteo.com/en/docs) and
[geocoding](https://open-meteo.com/en/docs/geocoding-api) documentation, fixed
to 2026-11-19 12:00 UTC. Place metadata is synthetic; numbers cover the seven
conditions and the six-hour horizon. Tests mutate these responses for refusals,
missing fields and failures. No test makes an external network request.

Weather data/response examples: Open-Meteo, CC BY 4.0; geocoding: GeoNames.
