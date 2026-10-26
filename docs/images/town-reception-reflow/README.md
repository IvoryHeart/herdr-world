# Town Reception snapshot-reflow proofs

Synthetic evidence for #436 / PR #438, captured through the actual Pixi Town
renderer after applying the relocation repair. No live connection or user data
is used.

The scene starts with two idle lounge occupants, two blocked Reception visitors,
one finished visitor and three working agents. A second snapshot makes one
worker blocked and another idle. During their stand-up animation, a third
snapshot inserts a building ahead of their host, relocating that host. The
camera follows the relocated building; the captures are taken about 650 ms
later, while the new visitors are still travelling within it. Resting lounge
occupants remain in their assigned slots, the existing queue stays at its
counter, and the moving visitors remain inside the relocated building instead
of crossing the street from the previous location.

The capture harness checks every reported actor position against the current
building bounds on rendered frames and rejects renderer errors. These images
show the actual renderer, not the surrounding React controls or reception DOM
board. Synthetic status/model inputs are supplied directly to `setScene`; this
is not evidence of a live Herdr snapshot transport, all possible routes or all
animation frames. The committed actor tests independently cover exact immediate
translation, tween endpoints, walking paths, per-step building containment and
final destinations.

All images use CSS viewport dimensions with device scale factor 1. The 56 px
synthetic caption is capture context, not product UI.

| Context | Rendered post-reflow capture |
| --- | --- |
| Phone, 390 × 844 | [Reception and lounge](reception-390x844.png) |
| Laptop, 1512 × 982 | [Reception and lounge](reception-1512x982.png) |
| Portrait, 1280 × 1440 | [Reception and lounge](reception-1280x1440.png) |
| Wide, 2560 × 1440 | [Reception and lounge](reception-2560x1440.png) |
| Tall, 1440 × 2560 | [Reception and lounge](reception-1440x2560.png) |
