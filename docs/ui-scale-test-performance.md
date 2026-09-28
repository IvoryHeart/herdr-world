# UI scale browser test timing analysis

The 21 cases in `web/src/uiScale.test.ts` take about three minutes locally. In one
focused run alongside `WorldTerminalHandoff.test.ts`, the combined test time was
228.49 seconds; the handoff case took 47.12 seconds, leaving about 181 seconds
for the UI scale matrix. These are observations, not a measured improvement.

## Where the time goes

Each matrix row builds a browser fixture and starts a fresh headless Chrome. Those
steps are small in the measured slow rows:

| Case | Total | Build | Chrome startup | Main cost |
| --- | ---: | ---: | ---: | --- |
| Configuration, 390 px, DPR 1.25 | 26.1 s | 32 ms | 202 ms | About 16 s before the first lazy Configuration fallback, then about 7 s after the harness releases it. |
| Terminal links, 390 px, touch | 23.3 s | 25 ms | 177 ms | About 23 s inside the browser fixture. |

The Configuration fixture runs the full mobile menu interaction sequence before
opening Configuration. It repeats swipe, cancel, expand, collapse, focus and
animation checks for both light and dark themes. The first lazy fallback appeared
about 15.96 seconds after navigation in the measured 390 px case. The harness
then deliberately tests two delayed dialog loads and a touch dismissal race.

The mobile terminal-link fixture uses real CDP touch events. Its long-press helper
waits 500 ms before releasing each press. The touch path calls it 22 times and
also waits 500 ms after each of four canceled or short gestures: at least 13
seconds of deliberate timer waits, before rendering, CDP round trips and other
checks. The same full touch path runs at both 390 px and 320 px.

The matrix repeats substantial behavior across viewport variants. The local
focused run showed Configuration at 390 px taking 28.1 seconds, 320 px taking
25.5 seconds, and its two compact menu cases taking 16.4 and 16.3 seconds.
The two narrow terminal-link cases each took about 23 seconds. This explains
why the file dominates the test stage; reducing build or Chrome startup would
barely change it.

## Recommended experiment

Separate full interaction coverage from viewport coverage. Keep one full mobile
Configuration gesture case, one full mobile terminal-link touch case, and the
desktop interaction cases. At the other existing widths, run shorter checks for
the layout, clipping, focus, input and scale properties that the width can
change. Preserve the 320 px, 150% scale and short-height cases as layout checks.
Keep a real 500 ms long press in the representative touch case; shortening that
timer would stop testing the production threshold.

This is a test-design change and needs its own candidate and review. First map
the assertions in each fixture to the representative behavior case or a viewport
check. Then compare per-case and full `bun test` wall time on the same machine,
run the full gate, and review any coverage lost. The likely saving is in the
repeated mobile rows, but no speedup has been implemented or verified yet.
