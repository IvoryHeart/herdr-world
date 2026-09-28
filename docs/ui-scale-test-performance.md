# UI scale browser matrix timing analysis

# What the matrix protects

`web/src/uiScale.test.ts` is a browser harness for nine fixture families across
21 viewport, pixel-density and interface-scale combinations. It checks more
than a scale setting: terminal cell selection and mouse coordinates; keyboard
and focus behavior; pane navigation and task actions; connection profiles;
Configuration drawer and menu layout; Terminal loading, links and file actions;
and diff viewing. The real Chrome runs catch CSS geometry and trusted-input
problems that unit tests cannot see.

The 320 px, 150% scale and short-height cases guard layouts where controls
could be clipped or unreachable. A representative mobile case also exercises
the full touch interaction behavior. Removing the entire matrix would discard
those browser-level checks.

## Where the time goes

Before this repair, the 21 cases took about 181 seconds locally. That estimate
comes from a focused run alongside `WorldTerminalHandoff.test.ts`: 228.49
seconds total minus the handoff case's 47.12 seconds. Each matrix row builds a
fixture and starts a fresh headless Chrome, but those steps were small in the
measured slow rows:

| Case | Total | Build | Chrome startup | Main cost |
| --- | ---: | ---: | ---: | --- |
| Configuration, 390 px, DPR 1.25 | 26.1 s | 32 ms | 202 ms | About 16 s before the first lazy Configuration fallback, then about 7 s after the harness releases it. |
| Terminal links, 390 px, touch | 23.3 s | 25 ms | 177 ms | About 23 s inside the browser fixture. |

The Configuration fixture runs the full mobile menu interaction sequence before
opening Configuration. It repeats swipe, cancel, expand, collapse, focus and
animation checks for both light and dark themes. The first lazy fallback appeared
about 15.96 seconds after navigation in the measured 390 px case. The harness
then deliberately tests two delayed dialog loads and a touch dismissal race.

The production Terminal long-press threshold is **450 ms**, not seconds. The
browser helper held each press for 500 ms to cross that threshold. It called
the helper 22 times and also waited 500 ms after each of four canceled or
short gestures: at least 13 seconds of deliberate waits. The same full touch
path ran at both 390 px and 320 px. Those repetitions, plus Configuration's
mobile menu gestures and lazy-dialog races, dominated the file.

The matrix repeats substantial behavior across viewport variants. The local
focused run showed Configuration at 390 px taking 28.1 seconds, 320 px taking
25.5 seconds, and its two compact menu cases taking 16.4 and 16.3 seconds.
The two narrow terminal-link cases each took about 23 seconds. This explains
why the file dominates the test stage; reducing build or Chrome startup would
barely change it.

## Implemented reduction and measured result

The 390 px case keeps the full mobile Terminal link sequence and one real
500 ms press. Later presses still use trusted CDP touch events but activate
their scheduled long-press callbacks in the fixture, following an established
pattern in `mobileTerminal.browser.tsx`. The four canceled or short gestures
still wait past the production threshold to verify they do not activate.

The 320 px Terminal link case now checks link selection, handle bounds, correct
URL activation and wrapped-link cell targeting at both interface scales.
The 320 px Configuration case checks the actual narrow drawer fit, overflow,
scrolling and increased interface scale without repeating the 390 px menu
gestures, lazy-loading races and integration mutations. The 320 px 150% and
740 px short-height menu cases remain in the matrix.

In a full focused run after these changes, all 21 cases passed in **126.22
seconds**, about **55 seconds or 30% faster** than the earlier 181-second local
estimate. The measured Terminal link rows were 13.51 seconds at 390 px and
2.54 seconds at 320 px; the 320 px Configuration row was 2.00 seconds. The
baseline rows were about 23.3, 23.3 and 25.5 seconds respectively. Different
machine load can change absolute times; the final push and CI gates will verify
the complete candidate.

The next visible cost is the 390 px full Configuration case (26.2 seconds) and
two menu-only high-scale/short-height cases (16.2 and 16.3 seconds). Any
further shortcut needs a check-by-check coverage map for those layouts before
reducing their gesture paths. The full browser suite remains in the repository
gate; this repair does not skip it locally or in CI.
