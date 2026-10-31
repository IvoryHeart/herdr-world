# Town idle-frame audit

The renderer formerly requested a motion frame whenever Calm Town and reduced
motion were off, even when roofs covered all animated interiors. It now requests
frames for visible motion and schedules discrete changes at their next deadline.
Visible glow, bounce, selection, walking, camera and drag motion retain the
existing frame scheduler. No blanket frame-rate cap was added.

## Verified measurements

Measurements used production Vite builds of `488682bc` and this change, with the
same temporary, behaviour-neutral correction for the duplicate camera flag in
TownCanvas (delivered separately in PR #562). Each build had a draw counter added
immediately before the production renderer call. That instrumentation is absent
from the delivered code. A private static proxy forwarded API and WebSocket
requests to the same running backend. No extra World service was started.

Each case used its own headless Chrome over a dynamically allocated CDP port,
20 seconds to settle and a 10-second measurement. Busy percentage is the change
in CDP `TaskDuration` divided by elapsed real time. DPR was 1 in every case;
1440×900 used normal CPU speed, 390×844 used 4× CPU throttle. Hardware rendering
was verified as ANGLE/Vulkan on an AMD Radeon RX 6700 XT; software rendering was
verified as ANGLE SwiftShader. Runs are individual samples on a shared machine,
with a changing live roster; the differences do not isolate every source of cost.

For the **static view**, the camera was placed at its minimum zoom, with roofs
covering the interiors, then allowed three more seconds to settle. The camera
level was verified as `town`; no Calm Town preference was needed.

| Renderer | Width | Busy before → after | Draws/s before → after | After: all rAF callbacks/s |
| --- | --- | --- | --- | --- |
| GPU | 1440 | 4.69% → 0.93% | 59.7 → 0.1 | 0.7 |
| GPU | 390, 4× | 17.67% → 2.96% | 52.7 → 0.1 | 0.8 |
| SwiftShader | 1440 | 4.90% → 1.71% | 59.5 → 0.1 | 0.8 |
| SwiftShader | 390, 4× | 15.89% → 3.27% | 54.1 → 0.1 | 0.7 |

The **default view** still contains visible ambient animation. These numbers
must remain separate from the static case:

| Renderer | Width | Busy before → after | Draws/s before → after |
| --- | --- | --- | --- |
| GPU | 1440 | 10.60% → 4.13–7.47% | 56.5 → 29.2–29.4 |
| GPU | 390, 4× | 25.97% → 9.72% | 48.3 → 56.7 |
| SwiftShader | 1440 | 7.47% → 5.31% | 56.0 → 26.4 |
| SwiftShader | 390, 4× | 24.55% → 16.44% | 48.1 → 53.0 |

The 3% target is **not universally met**: the throttled static SwiftShader
sample narrowly exceeds it, and animated default Town exceeds it. A higher
draw rate on the phone preserves visible pulses as contention falls. Treating
those scenes as zero-motion idle, or cutting their frame rate to obtain a lower
busy number, would misstate the result.

## Callback and draw owners

| Owner | When it runs |
| --- | --- |
| `worldFrameScheduler.ts` | One task/rAF queue for requested state or motion paints; its 16 ms task and 8 ms work budget are unchanged. Visibility, reduced motion and terminal input still control eligibility. |
| `townRenderer.ts`, `townAmbient.ts` | Continuous frames only for visible pulses, glows and bounces; a single cancellable timer for the next visible screen, typing or blink change. Hidden ancestry, roofs and viewport bounds suppress ambient requests. Camera, roof, actor, materialization and drag transitions retain state frames until settled. |
| `TownCanvas.tsx`: `scheduleAnchors` | One coalesced rAF after relevant React effects, camera changes, and drawn frames with Inspector targets. Equal anchors do not commit. It explains the occasional callbacks beyond renderer draws in the static samples. |
| `pixiSystemTicker.ts` | Pixi's independent system rAF remains stopped. Scheduler/GC listeners advance inside Town's drawn frames; the application ticker is also stopped. The CDP stack sample found no independent Pixi callback. |
| `TownCanvas.tsx`: `edgePan` | A separate rAF only during a pointer carry; it re-aims the carry and pans near edges, and is cancelled on completion/cleanup. It does not run in settled Town. |
| `DeskWorkBadge.tsx`: `BadgePopover` | A separate follow rAF while its pull-request popover is open, including on a phone; equal placement preserves state and it does not draw Pixi. This is a remaining callback owner, outside the closed-popover measurements above. |

A separate three-second CDP stack sample of settled default desktop Town
observed 89 shared-scheduler requests and five coalesced anchor requests.
The sampled stack locations were checked against the built modules. It was
collected after the busy-time measurement so stack collection did not inflate it.
The static samples' occasional state paints remain compatible with periodic
observation; attributing every one to a particular backend poll is an inference.

## Blocking evidence and visual comparison

`town-idle-draws` runs the production Pixi renderer and shared frame scheduler
with synthetic observations and the test clock at both widths. The work ceiling
allows zero draws in each measured test second. Renderer readiness and a positive
initial frame are required before measurement; later assertions require an
actual coalesced state paint, a smooth flight, continuous visible pulses, sleep
after covering the scene again, and no frame after destruction. There are no
wall-clock sleeps or speed-dependent thresholds in this case.

The acceptance case now mounts only its renderer, bypassing the shell's Board
and Town mounts that it previously discarded. It waits for the renderer trace
to report no camera, roof, actor, materialization or drag transition, rather
than drawing through fixed three-second tails. The flight lasts 160 ms; flight
and settled visible-pulse samples each require at least six draws in 128 ms
(eight test-clock frames). This retains a cadence check while bounding repeated
software-GL work. The three initial one-second zero-draw windows, recovery
windows, covered-again window and disposal window remain unchanged. Settling
does not wait for ambient requests to stop, so a continuously drawing static
scene still reaches and fails the draw ceiling. Renderer readiness and a
positive initial frame remain prerequisites; neither timeout nor retries changed.

Before the fix, both widths drew 64 frames in every measured test second and
failed the zero-draw ceiling. The fixed cases pass. The previous idle React
commit ceiling and stationary-camera walking-anchor case remain intact.
Unit cases cover discrete phase/rate, blink transitions and visibility through
ancestor culling and viewport bounds. All 49 cases across HostsFilter and the
five retained TownCanvas browser suites passed during the audit; the strengthened
idle-draw cases were then run again at both widths.

Paired captures use a synthetic four-desk scene with working, blocked, idle and
finished agents, rendered with SwiftShader. They show the same geometry and art;
animation phase can differ. No live world identifiers or content are present.

| Width | Before | After |
| --- | --- | --- |
| 1440 | ![Synthetic Town before, desktop](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames/town-before-1440.png) | ![Synthetic Town after, desktop](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames/town-after-1440.png) |
| 390 | ![Synthetic Town before, phone](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames/town-before-390.png) | ![Synthetic Town after, phone](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames/town-after-390.png) |

GPU context restoration is also a state-frame invalidation owned by the
renderer registration in `townFrameLifecycle.ts`. The listener is removed on
disposal. Both viewport cases use native `WEBGL_lose_context` events to lose
and restore the actual Pixi context after proving zero idle draws. They require
one recovery repaint, no repeated idle draws, no paint during controlled hidden
visibility, one paint when visibility returns, and no draw after disposal.
The context-loss event is allowed to finish a test-clock frame before requesting
restoration; there are no wall-clock sleeps or increased acceptance deadlines.
Without the listener, both cases fail with missing sleeping and visibility-return
repaints. Pixi draw errors also fail the check.

### Paired motion captures

These 14-second before/after captures use the same four-desk synthetic scene,
DPR 1, own headless Chrome over CDP and verified hardware ANGLE/Vulkan. Desktop
is 1440×900 at normal CPU speed; phone is 390×844 with 4× CPU throttle. They use
native browser time, with the original `488682bc` renderer as the baseline and
the context-restoration repair as the after renderer.

| Viewport | Side-by-side capture | Individual captures |
| --- | --- | --- |
| Desktop | [Before / after](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-paired-1440.mp4) | [Before](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-before-1440.mp4), [after](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-after-1440.mp4) |
| Phone, 4× CPU | [Before / after](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-paired-390.mp4) | [Before](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-before-390.mp4), [after](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-after-390.mp4) |

The sequence shows working/blocked glows, bouncing/typing bubbles and blinks for
0–5 s; camera flight out and back at 5–8 s; a desk carry at 8–10 s; cancel/shake
and spring return at 10–11.3 s; then ambient motion until 14 s. The fixture calls
production renderer camera/drag APIs; trusted pointer and presented-camera
behavior remain covered by the retained full TownCanvas suites.

[Capture metadata](https://raw.githubusercontent.com/IvoryHeart/herdr-world/pr-assets/town-idle-frames-motion/motion-evidence.json)
records per-phase draw counts and intervals. Desktop drew 841 before versus 840
after; phone drew 812 in each. Median draw intervals are 16.7 ms on desktop and
17.0–17.4 ms on the throttled phone in both builds. CDP source-frame timestamps
are preserved when encoding into 60 fps video containers; the container rate is
not a claim that the renderer drew 60 frames each second. These are observed
capture results, not timing gates or proof for every device/load. Blink/bubble
phase and dust can differ; the recordings supply motion evidence alongside the
static-view work ceiling.

The rendering/lifetime boundary remains Q39 in `verification/coverage.json`.
Actual browser rendering, frame counts and destruction are the appropriate
evidence here; no ordering, authority, runtime ownership or recovery contract
changes, so a new Quint model would not establish the claim. Q39 now maps the
HostsFilter recovery consumer and records its native context-restoration evidence. Existing user
steps, controls, art and preferences remain accurate in README, FEATURES and
the tutorial. Contributor rendering guidance is updated in
`web/src/world/README.md`.
