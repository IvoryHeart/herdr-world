# Desk reveal outside Hosts

Refreshed on 2026-10-31 from original PR head `4c5a0b47`, merged with
main through `e37bb130` (including #526). All hosts, agent sessions and
terminal content belong to the synthetic production-tree Hosts filter fixture.
No World or Herdr process is started.

Each pair shows the expanded read-only summary, then the owning Inspector
after the host-named Reveal & open action. Captures use Chrome 156.0.8078.79
at DPR 1 with exact CSS viewport overrides. Capture assertions verify viewport
dimensions and the reveal button's bounds and pointer hit. The complete reveal
and exit/return cancellation scenarios finish at every viewport after capture.

| Viewport | Outside-filter summary | Owning Inspector |
| --- | --- | --- |
| Phone, 390 × 844 | [Summary](summary-phone.png) | [Inspector](opened-phone.png) |
| Laptop, 1512 × 982 | [Summary](summary-mac-laptop.png) | [Inspector](opened-mac-laptop.png) |
| Half-width, 1280 × 1440 | [Summary](summary-linux-half.png) | [Inspector](opened-linux-half.png) |
| Wide, 2560 × 1440 | [Summary](summary-linux-wide.png) | [Inspector](opened-linux-wide.png) |
| Portrait, 1440 × 2560 | [Summary](summary-portrait.png) | [Inspector](opened-portrait.png) |

All ten unedited screenshots were inspected for controls and private data.
They establish synthetic browser presentation; they do not claim native
runtime or device lifecycle acceptance.
