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

The phone, half-width, wide and portrait captures use PR source `11204307`.
The laptop capture was retaken from `5c5495b` after the Town renderer reported
all eight desk sprites visible (`animation.monitors === 8`), then visually
checked for the room floor, building interior and desk sprites. All captures
use Chromium at a 1× device scale factor with software WebGL. They show the
synthetic closure transition; they do not claim native runtime or agent
behavior.
