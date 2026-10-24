# Platform batch 1 visual checks

These synthetic scenes show the controls and evidence states introduced by
#369, #371, #372 and #378. The captured application source is commit
`49105072ca7c5c459c85bd14122fe61f5a53e740`. All images use Linux headless Chrome,
device scale 1 and the CSS viewport dimensions below; the laptop size does not
claim a native macOS run.

| Context and CSS dimensions | PR detail health | Harness readiness | Failed host in Board | Failed host in Town |
| --- | --- | --- | --- | --- |
| Phone, 390 × 844 | [PR](pr-390x844.png) | [Launcher](launcher-390x844.png) | [Board](board-390x844.png) | [Town](town-390x844.png) |
| Mac laptop, 1512 × 982 | [PR](pr-1512x982.png) | [Launcher](launcher-1512x982.png) | [Board](board-1512x982.png) | [Town](town-1512x982.png) |
| Half-width Linux, 1280 × 1440 | [PR](pr-1280x1440.png) | [Launcher](launcher-1280x1440.png) | [Board](board-1280x1440.png) | [Town](town-1280x1440.png) |
| Wide Linux, 2560 × 1440 | [PR](pr-2560x1440.png) | [Launcher](launcher-2560x1440.png) | [Board](board-2560x1440.png) | [Town](town-2560x1440.png) |
| Portrait monitor, 1440 × 2560 | [PR](pr-1440x2560.png) | [Launcher](launcher-1440x2560.png) | [Board](board-1440x2560.png) | [Town](town-1440x2560.png) |

## Scenes and interactions

- **PR details:** a synthetic PR retains its previous checks and two separately
  linked review records. One has an explicit reviewer claim; the other remains
  attribution unknown. Stale details show their original read time and require
  Refresh Sources before merge. Clicking Refresh Sources supplies current detail
  evidence but leaves the unattributed review unknown and readiness uncleared.
- **Launcher:** a timed-out Codex probe is unknown, Claude is explicitly signed
  out, and the installed Pi harness has no supported authentication probe. The
  unknown harness remains usable. Check again and Edit profiles are present;
  clicking Edit profiles opens the existing profile editor.
- **Board:** the cached failed host has Disconnected · Reconnect and static,
  unknown agent cards. A healthy sibling retains its working presentation.
- **Town:** a cold StrictMode mount contains one failed cached host and a healthy
  sibling. The failed building sign and reception both show Disconnected ·
  Reconnect. The scene reaches roof level through normal camera controls and
  keyboard zoom. Sign visibility comes from committed refs and the renderer's
  normal roof alpha, without a projection refresh, forced remount or CSS override.

All 20 captures passed viewport and horizontal document-overflow checks without
uncaught browser exceptions. Board and Town recovery buttons passed computed
visibility, viewport and center-point hit tests. Actual pointer clicks dispatched
only the selected synthetic profile's disconnect/connect pair. The phone Town
case exercised the building button; the other Town sizes exercised reception.
Screenshots precede these interactions so each image shows its initial evidence
state.

## Fixture boundaries

The capture adapter mounts the actual PR card, launcher, profile editor, BoardView
and TownView components with synthetic data and mocked World responses. Town
uses the maintained browser fixture in StrictMode. Its unused, empty phone Summary
stand-in is hidden to avoid covering the scene; production Summary is unchanged.
This fixture mask is separate from the repaired building-sign registration race.

The maintained TownCanvas recovery cases additionally cover cold signs,
normal roof hiding, camera culling and remounting, unchanged layout geometry,
and renderer disposal. They run in the repository's browser suite. These image
captures are visual and interaction evidence, not a replacement for that suite,
behavioral verification or the unchanged latency budget.

No real account, SSH host, live session or repository is represented. Mocked
Reconnect calls do not demonstrate native SSH recovery. The captures do not claim
deployment on port 8788, native Windows acceptance or release publication; those
remain separate delivery checks.
