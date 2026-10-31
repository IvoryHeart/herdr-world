# Expanded Town room closure captures (#519)

Synthetic captures of the Town browser fixture at the five owner viewports.
The first Atlas room starts with 44 synthetic tabs, is expanded through the
room controls, then receives a topology update that closes 36 tabs. Each view
shows the resulting eight desks in a smaller room that remains expanded, with
Fold available where the room controls are in view. No real hosts, projects,
or agent sessions are used.

| Viewport | Capture |
| --- | --- |
| Phone, 390 × 844 | [phone](phone-390x844.webp) |
| Laptop, 1512 × 982 | [laptop](laptop-1512x982.webp) |
| Half-width, 1280 × 1440 | [half-width](half-1280x1440.webp) |
| Wide, 2560 × 1440 | [wide](wide-2560x1440.webp) |
| Portrait, 1440 × 2560 | [portrait](portrait-1440x2560.webp) |

Refreshed on 2026-10-31 from the original PR head `8a65391b` merged
with main `0f32b6a9`. The synthetic fixture mounts the current production
TownCanvas and projection, clicks Expand to reveal 44 desks, then closes 36
tabs through a topology update without remounting Town. Captures wait for the
eight remaining desks, settled camera and actors, and an available Fold control.
All five captures were inspected for furnished interiors and private data.
The phone view retains desk zoom; its right edge is clipped by the viewport.

Chrome for Testing 156.0.8078.80 runs with software WebGL, bundled reference
fonts and a fixed test clock at a 1× device scale factor. These captures show
the synthetic closure transition; they do not claim native runtime or agent
behavior. Separately, the unchanged Town golden fixture matches all five
committed references exactly (zero changed pixels).
