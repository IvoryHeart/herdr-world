### Fixed

- Keep concurrent Claude limits readings from decreasing when a status line writer pauses before publishing. Recover locks only after confirmed process death, while preserving the bounded wait and the user's status output.
