# Long-session renderer OOM incident analysis

- **Incident date:** 2026-08-31
- **Analyzed origin:** `http://localhost:8791/world`
- **Status:** Root cause identified; no reproduction on the current `v0.1.0` bundle in a bounded soak
- **Related fix:** [PR #62](https://github.com/IvoryHeart/herdr-world/pull/62)
- **Tracking issue:** [#68](https://github.com/IvoryHeart/herdr-world/issues/68)

## Executive conclusion

The Herdr World server on port 8791 did not crash. Its bridge, Vite process,
and parent `npm run dev:local` process remained alive and healthy for the whole
incident. The failed component was a foreground Google Chrome renderer, which
exhausted V8's 4 GiB main heap cage after about 18.5 hours and generated a
Crashpad minidump.

The failed tab was running the vulnerable pre-PR-#62 frontend bundle. Browser
history places the tab load at 23:43 on 2026-08-30. The stability branch was
created four minutes later, the core fix was committed at 00:14, and the fix
was merged at 01:24. Port 8791 serves the static `web/dist` output; rebuilding
that directory later cannot replace JavaScript already resident in an open
tab. The next recorded navigation for the affected origin was at 18:14, after
the renderer had failed.

This incident therefore confirms the original long-session retention bug; it
does not demonstrate that the released fix regressed. A controlled current-
bundle run remained near 12--13 MiB after forced garbage collection, kept all
renderer ownership counters flat, and produced no browser errors over ten
minutes. That bounded result is encouraging but is not a substitute for a
production-bundle soak comparable to the 18.5-hour incident duration.

## Investigation method

Two independent investigations reviewed the incident separately: one focused
on the bridge/Vite/process lifecycle and one focused on browser/frontend
retention and PR #62. Their conclusions were then correlated with a separate
local inspection and a controlled current-bundle memory run. No service was
restarted and no crash artifact was modified.

## Incident timeline

Times below are Europe/London local time (`UTC+01:00`).

| Time | Evidence |
| --- | --- |
| 2026-08-30 23:36:19 | `npm run dev:local`, bridge PID 86557, and Vite PID 86621 started. The checkout was at pre-fix commit `53820c1`. |
| 23:42:34--23:43:23 | Chrome history recorded the initial `/` and `/world` visits on port 8791. |
| 23:47:15 | The `fix/runtime-resize-and-long-session-stability` branch was created. |
| 2026-08-31 00:14:46 | The core renderer-lifecycle fix was committed as `67e6702`. |
| 01:24:19 | PR #62 was merged as `a7f2803`. |
| 04:14:26 | The current fixed `web/dist` assets were built locally. This did not hot-swap the already-loaded full-app tab. |
| 18:13:24 | Chrome Crashpad captured a foreground renderer V8 OOM; the kernel recorded the renderer's fatal invalid-opcode trap. |
| 18:14:34 | Chrome history recorded the next `/world` visit after the crash. |
| 18:20 onward | The original bridge, Vite, and `dev:local` processes were still alive; port 8791 returned HTTP 200 and current bridge data. |

## Forensic evidence

### The server stack remained healthy

- `127.0.0.1:8791` remained in `LISTEN` state under the original bridge PID.
- `/` and `/world` returned HTTP 200; `/api/capabilities` and `/api/snapshot`
  returned valid protocol-20 data.
- Bridge requests completed in milliseconds, with the snapshot response taking
  roughly 27--30 ms during the investigation.
- Bridge resident memory remained around 29 MiB, with a recorded high-water
  mark around 41 MiB, 13 open file descriptors, and no restart.
- Vite and the parent `npm run dev:local` process also remained alive.
- The persistent Herdr Web bridge log contained only startup INFO records and
  no WARN or ERROR entries. The kernel and user journals contained no bridge
  crash, Vite crash, or OOM-kill event.

### Chrome exhausted its JavaScript heap

The Crashpad minidump identifies:

- product `Chrome_Linux` 151.0.7922.137;
- process type `renderer`, in the foreground;
- loaded origin `http://localhost:8791`;
- `v8-oom-location`: `MarkCompactCollector: young object promotion failed`;
- a 4096 MiB V8 main cage whose reservation was exhausted;
- about 4087 MiB allocated by V8 at failure; and
- final scavenges retaining approximately 4.0 GiB.

The last V8 messages were timestamped around 66,601,000 ms after renderer
start. Counting backward from the crash lands at approximately 23:43, matching
the browser-history record for the affected World tab.

This was a per-renderer V8 heap limit failure, not the Linux OOM killer. The
fatal kernel trap is Chrome's termination path after the V8 OOM, not evidence
that the bridge executable failed.

### The tab predated the fix

At tab load time, the repository and static output could not contain PR #62:

1. `dev:local` had started against `53820c1` at 23:36.
2. The tab loaded `/world` at 23:43.
3. The fix branch did not exist until 23:47.
4. The core fix was first committed at 00:14 and merged at 01:24.
5. Browser history contains no intervening visit or reload for port 8791 before
   the crash.

`dev:local` deliberately serves two different frontend modes. Its canonical
full-app URL uses `web/dist` through the bridge, while the separate Vite URL
provides frontend HMR. HMR on Vite's port does not update a page loaded from
the bridge's full-app port, and replacing files under `web/dist` does not
replace an already-evaluated module graph.

## Relationship to PR #62

The pre-fix application had two mutually reinforcing retention paths:

1. `WorldStage` created a fresh `conversationTargets` array on every render.
   `PixelOfficeCanvas` treated it as a renderer-update dependency, reported
   anchors into React state, and recursively caused another render/update.
2. Pixi scene redraws did not destroy scene-owned graphics contexts and text
   styles. Discarded scenes therefore remained reachable for the tab lifetime.

Pre-fix measurements found repeated renderer work while idle and about 64 MiB
retained after 46 forced redraws. PR #62 stabilized the target descriptors,
separated anchor reporting from renderer-model updates, coalesced anchor
measurement into one cancellable animation frame, and destroys scene-owned
Pixi resources without destroying shared textures. Its focused stress test
retained about 1.55 MiB after 114 redraws.

The OOM shape and duration are consistent with the old discarded-scene
retention accumulating across periodic real redraws. Terminal resize transport
was already rate-limited and was not the source of the failed renderer's heap.

## Current `v0.1.0` bundle check

A fresh headless Chromium page loaded the current production bundle from port
8791. The test forced V8 garbage collection every 30 seconds for 21 samples
over 622 seconds while the live bridge continued to publish snapshots.

| Measurement | Start | Warm-up peak | Final |
| --- | ---: | ---: | ---: |
| V8 heap used | 11,685,700 B | 12,790,336 B | 12,740,080 B |
| DOM nodes after warm-up | 554 | 554 | 554 |
| event listeners after warm-up | 289 | 289 | 289 |
| Pixi applications / tickers / observers / canvases | 1 / 1 / 1 / 1 | unchanged | unchanged |
| renderer-owned listeners | 6 | 6 | 6 |

The scene completed 21 additional genuine redraws and 61 signature skips.
There were no page errors, renderer errors, or crashes. Heap growth reversed
after warm-up and ended below its intermediate peak.

Controls showed the same bounded warm-up behavior: Spaces moved from about
4.49 MiB to 4.59 MiB over five minutes with flat node/listener counts, while
an `about:blank` page remained exactly flat at about 0.49 MiB.

This check rejects the pre-fix rapid/unbounded signature in the current bundle.
It cannot prove 18-hour stability, exercise every terminal-window workload, or
replace a long production-bundle soak.

## Root-cause assessment

| Finding | Confidence |
| --- | --- |
| The bridge/Vite/server did not crash. | Confirmed |
| The browser renderer died from V8 heap exhaustion at about 4 GiB. | Confirmed |
| The affected renderer belonged to the port-8791 World tab. | Confirmed by crash origin, V8 age, and browser history |
| The tab was running a bundle loaded before PR #62 existed. | Confirmed |
| PR #62's discarded-scene retention was the object-level cause. | High; the minidump proves OOM but is not a JavaScript heap snapshot |
| The incident is a `v0.1.0` regression. | Not supported by this incident |
| The current production bundle has no long-duration leak under every workload. | Not yet proven |

## Remaining gaps and recommended follow-up

The incident exposed a validation and diagnosability gap even though it did
not expose a new released-code root cause:

1. Add a software-runnable production-bundle heap plateau test. Warm the page,
   perform repeated real Office redraw cycles, force garbage collection, and
   assert bounded post-warm-up heap, DOM, listener, application, ticker,
   observer, canvas, graphics-context, and text-style counts.
2. Run and record a 12--24-hour current-release soak with live snapshot/event
   traffic and representative open-terminal, resize, scroll, reconnect, and
   visibility-change workloads.
3. Expose the loaded frontend version/build identity in diagnostics so an open
   tab can be distinguished from newly rebuilt static assets.
4. Decide whether the full app should detect a newer static build and offer a
   controlled reload. It must not silently reload active terminals.
5. Reproduce and document same-tab recovery after a deliberately terminated
   or memory-limited renderer. The reported need to open a new tab is plausible
   Chrome recovery behavior, but the incident artifacts do not identify an
   application recovery loop.
6. Keep the heap plateau assertion separate from hardware-sensitive FPS or GPU
   thresholds so it can run deterministically in normal CI.

The local Crashpad dump may contain process memory and is forensic evidence,
not a repository artifact. It must not be committed or attached publicly
without a separate privacy review.
