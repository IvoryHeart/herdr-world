## Decisions

Open-Meteo forecast and geocoding endpoints require no account/key for the free non-commercial tier. The interface isolates lookup and weather acquisition. Only enabled Weather may call either endpoint. Settings persist under custom.world_sources.weather; coordinates are rounded to 0.1 degrees before storage or transmission. A nonempty manual location always wins over the one-shot browser fallback.

Weather reads start a background single flight and immediately return cache/unavailable. Refreshes are demand-driven every 15 minutes, with a 30-minute cache ceiling, a six-second total deadline, a 32 KiB response limit per request and no redirects. A failed refresh clears the reading. Settings changes abort and retire the old generation; no late response can restore it. No automatic retry or independent timer.

The existing source snapshot carries an optional weather value for backward compatibility; its browser parser supplies unavailable when absent. GET /api/world/weather reads the same value. Local CLI shares loopback/token/no-Origin admission and alone may wait for the bounded six-second refresh, so a first command can print a reading. Tests exhaust finite disable/location/read completion schedules plus real provider fixtures and admission tests; this isolated cache does not need a new Quint model.
