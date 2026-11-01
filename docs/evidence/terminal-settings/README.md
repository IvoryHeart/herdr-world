# Terminal settings visual evidence

These isolated captures for PR #558 use the production Town view, Inspector
identity, appearance popover and profile link. The host, room and agents are
synthetic. A fixture-only enlarged character inset uses the production Town
look resolver and sprite renderer; it is not a new product control.

| State | Desktop, 1440 × 900 | Mobile, 390 × 844 |
| --- | --- | --- |
| Migrated known profile | [Builder](known-1440.png) | [Builder](known-390.png) |
| Profile absent from this World | [Remote Designer](unknown-1440.png) | [Remote Designer](unknown-390.png) |

The fixture imports a legacy Builder assignment and Town master through the
real profile store and terminal-settings service against a synthetic Herdr
transport. It checks that the profile's look is unchanged, the master remains
assigned and the imported assignment is projected. The captures show the
retained Builder look and **Edit profile · Builder**.

The second terminal already carries an assignment to `remote-designer`, which
this World lacks. Its recorded name is **Remote Designer**. The browser checks
the default Town look and **Profile · Remote Designer**, with no local profile
editor target. Each capture keeps the Inspector popover open so its affected
control can be inspected alongside the character.

The capture check passed with five test assertions plus browser assertions for
both look resolutions, both Inspector labels and horizontal overflow at each
viewport. A private headless Chrome profile used an OS-assigned CDP port and
was closed afterward. The browser fixture was run through `bun run test`; its
loopback asset server was not a World service and connected to no live Herdr.
No personal paths, hosts, transcripts or session identifiers appear in the
images. All four images were inspected after capture.

These are presentation checks using a synthetic service projection. The
separate disposable-Herdr platform test establishes token acquisition, move,
key-limit and restart behavior. Regression and bounded convergence checks are
documented in the [verification contract](../../../verification/contracts/terminal-settings.md).
