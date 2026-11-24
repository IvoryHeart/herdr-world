# Linux installer acceptance image

`bun run test:install-linux` builds the Ubuntu 24.04 systemd fixture and runs
the fresh, core-only, TUI, stopped and upgrade cases, including fresh-install
reboot. The package list, systemd setup, scenario files and assertions are the
same with or without a dependency cache.

`Dockerfile.base` and `apt.sh` own OS dependencies. `Dockerfile` always copies
the current checkout's scenario, boot and curl helpers onto that base. The
installer upgrade job restores an exact Actions cache of `docker save` output,
keyed by the two dependency files and architecture. There are no fallback keys.
Changing a scenario rebuilds the fixture without discarding the dependency
cache; changing the dependency recipe invalidates both identities. A successful
base is saved even if a later installer scenario fails.

This prebuilt base avoids apt downloads on cache hits and needs no registry
publishing permissions or extra image-release workflow. Docker layer caching
would also preserve the apt layer, but restoring a complete base needs no new
Buildx driver or cache authentication setup. Changing to a regional mirror would
still download packages on every run. Cache eviction or a dependency recipe
change requires a cold build; cached packages refresh when the recipe changes.

Cold apt runs use one retry, 15-second HTTP/HTTPS connection and transfer
timeouts, strict update errors, and a 300-second total deadline with a five-second
kill grace. The total deadline covers both update and installation, so a mirror
that trickles bytes cannot consume the command runner's 20-minute allowance.
That outer allowance remains available for package builds and installer cases.
Failure includes apt's diagnostics and an explicit dependency-cache error.

For CI evidence, open **Installer upgrade (linux-x64)** and its job summary.
The log records apt update/install/total seconds, dependency build or cache load,
fixture Docker build, and forced mirror failure time. A cache hit explicitly
records `apt: skipped (0s; dependency cache hit)`. Compare a cold run and a rerun
using the same recipe. The saved base is independent of the native package cache.

After an acceptance run, test a failed mirror directly with:

```sh
bun scripts/install-linux/image.ts --check-mirror-failure
```

This runs real apt inside the prepared base, outside Docker's RUN cache, with
network access disabled and an unavailable loopback proxy. It requires a nonzero
exit and the explicit apt error within 60 seconds. The CI job runs this check
after the unchanged acceptance scenarios. No preview is needed.
