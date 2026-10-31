# Initial Town golden-image evidence

The reference renders the production TownCanvas and DOM overlays with synthetic
data. This is visual evidence, separate from the ownership, lifecycle and gesture
claims already mapped in `verification/coverage.json`. It adds no model claim or
mandatory consumer, and removes no existing browser check. Direct pixel comparison
is the appropriate evidence for this rendering boundary; a state-machine model
cannot establish its appearance.

## Reference

- Chrome for Testing 156.0.8078.80, Linux x64, SwiftShader, sRGB, DPR 1.
- Fixed seed `0x746f776e`, wall-clock origin 1,800,000,000,000 ms, 16 ms frames.
- Motion enabled, camera/actors settled at 6,000 ms after the first drawn frame.
- Bundled Noto Sans and DejaVu Sans Mono reference fonts, loaded before layout.
- Two synthetic hosts, four rooms, sixteen desks, sixteen agents and sixteen
  shell panes, including working, blocked, finished and idle states.
- Exact decoded RGBA comparison: zero tolerance, no masks.

The local machine restricts the downloaded Chrome's user namespaces through
AppArmor. The local capture wrapper disabled Chrome's sandbox for this isolated
synthetic fixture. The CI installer uses the repository's AppArmor setup and
keeps Chrome's sandbox enabled. No World or Herdr process is started by this test.

## Local verification

The focused comparator, viewport, queue, workflow and clock checks pass, including
failure for a one-channel, one-level pixel change and mismatched dimensions.
All three TypeScript projects and the documentation site build pass.

The stability command is:

```bash
TOWN_GOLDEN=1 TOWN_GOLDEN_RUNS=20 \
  TOWN_GOLDEN_OUTPUT=.agents/town-golden-stability-final \
  bun run test scripts/town-golden.browser.test.ts
```

`CHROME_BIN` names the pinned local browser wrapper described above. Update mode
is unset: every image is compared with the already stored golden.

Verified on 2026-10-31: **20 runs, 100 captures, zero changed pixels**.
The test took 978.25 seconds; this is execution time, not a product performance benchmark.
Every viewport produced one identical PNG SHA-256 across all twenty fresh browser runs.
All five final images were inspected for presentation and private data.
The [capture receipts](town-golden-stability.json) retain each comparison result.

| Run | Captures | Changed pixels |
| --- | --- | --- |
| 1 | 5 | 0 |
| 2 | 5 | 0 |
| 3 | 5 | 0 |
| 4 | 5 | 0 |
| 5 | 5 | 0 |
| 6 | 5 | 0 |
| 7 | 5 | 0 |
| 8 | 5 | 0 |
| 9 | 5 | 0 |
| 10 | 5 | 0 |
| 11 | 5 | 0 |
| 12 | 5 | 0 |
| 13 | 5 | 0 |
| 14 | 5 | 0 |
| 15 | 5 | 0 |
| 16 | 5 | 0 |
| 17 | 5 | 0 |
| 18 | 5 | 0 |
| 19 | 5 | 0 |
| 20 | 5 | 0 |

| Viewport | PNG SHA-256 (all 20 captures) |
| --- | --- |
| phone | `1d9024f244ccedf4127c98745a94207c222cc8c0d66df4c1069341e81c4164ff` |
| mac-laptop | `1e2f6adb133ef3e5bb880aa5f6e668fbe24e427f74e2bc1e67e3aec04c4a328c` |
| linux-half | `aaaa0acf90e84e8bf5212bc84002266da93917d5a1053b5207b4de865a71d205` |
| linux-wide | `30244b0cc86ae1408b7ed3234c6cfdd4c830ab7be501a9f073b7c40df69646c2` |
| portrait | `d751368f210a8e9068a37dc79e485abf2c648a744c13d859cc563d82cb49c446` |

The final browser log ends with:

```text
[town-golden] run 20/20: five viewports captured
(pass) Town matches the stored golden images
1 pass; 0 fail
```

## Scope and inference

Verified evidence covers the fixed synthetic Town scene, five reference
viewports, this Chrome build and these fonts. It does not establish pixel
equivalence across operating systems, GPU drivers, browser versions or device
pixel ratios. It does not replace behavioral verification, browser interactions
or release screenshot capture. A stable reference provides a useful future
look-and-feel signal; broader scene coverage is a future decision.

The workflow starts advisory and is not a Delivery checks dependency. See the
[runbook](../SCREENSHOTS.md#town-golden-image-report) for artifacts, refresh
instructions and runtime/storage bounds.

## Hosted acceptance and production visual control

The committed twenty-run table above records local repeatability. Hosted
acceptance uses the explicit stability workflow mode against unchanged goldens;
its full 100-capture report retains renderer identity and source/run provenance.
The same job mutates production grass paint, requires a nonzero child-test exit
caused by changed pixels, restores the source and requires a passing baseline.
It preserves the mutation patch, child logs, reports and mismatch images in its
artifact. The runbook gives the reusable command and mode selection.

Hosted run results and their exact candidate/run/artifact links belong in the PR
review handoff. They are separate from the historical local receipts above.

The initial hosted report matched four viewports exactly, then timed out in
`Runtime.evaluate` before capturing portrait. Its report retained four
zero-difference receipts and no portrait PNG. The local cost experiment kept all
376 production scene steps but batched GPU rasterization to the first frame and
checkpoint: all five original PNGs still matched exactly, with two GPU paints
each, in 4.27 seconds versus roughly 49 seconds for full intermediate painting.
The historical twenty-run reference above used full intermediate GPU painting.
The batched fixture is guarded to at most two GPU paints and leaves production
renderer code unchanged.

The local full-path negative control passed with both full and batched GPU
painting. The production grass mutant exited 1 with respectively 92,863;
381,278; 483,424; 845,407; and 743,094 changed pixels at phone, laptop, half-width,
wide and portrait viewports. The restored child exited 0 with zero differences
at every viewport. Source SHA-256 and all reference PNG hashes were unchanged.
The batched mutant/restored check took 9.03 seconds.
