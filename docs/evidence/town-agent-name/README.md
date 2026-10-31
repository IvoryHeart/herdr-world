# Town desk agent names (#467)

Refreshed on 2026-10-31 from original PR head `11dce84a` merged with
main `0f32b6a9`, adapting the label rule to the extracted `officeRoom.ts`
constructor. The synthetic fixture mounts the current production TownCanvas
and projection with eight tabs, each containing one named agent. Nameplates
show `example-seat-1` through `example-seat-8` rather than tab labels `Task 1`
through `Task 8`. Hosts, rooms and activity are synthetic.

Captures use pinned Chrome for Testing 156.0.8078.80, software WebGL, bundled
reference fonts, a fixed clock and DPR 1. They wait for settled actors/camera;
projection receipts assert all eight agent names. All five viewport screenshots
were visually inspected and exported as lossless WebP. Phone framing clips the
right edge at desk zoom. These are synthetic presentation captures, not evidence
of native runtime operations. The separate unchanged Town golden scene matches
all five stored references exactly.

| Viewport | Capture |
| --- | --- |
| Phone, 390 × 844 | [phone](phone-390x844.webp) |
| Mac laptop, 1512 × 982 | [laptop](laptop-1512x982.webp) |
| Half-width Linux, 1280 × 1440 | [half-width](half-width-1280x1440.webp) |
| Wide Linux, 2560 × 1440 | [wide](wide-2560x1440.webp) |
| Portrait, 1440 × 2560 | [portrait](portrait-1440x2560.webp) |
