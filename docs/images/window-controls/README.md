# Visible window controls

Refreshed on 2026-10-31 from original PR head `750d23ff` merged with
main `0f32b6a9`. The production World handoff fixture supplies synthetic
hosts, agents, tabs and terminal content. These unedited captures use the five
owner viewports: 390 × 844, 1512 × 982, 1280 × 1440, 2560 × 1440 and
1440 × 2560 CSS pixels. All five images were inspected for controls and privacy.

Chrome 156.0.8078.79 uses software WebGL and DPR 1. Captures assert viewport
dimensions; the phone additionally checks that Open windows has a reachable
44px target and clears the composer. The full handoff passes, including
minimize/restore without session-stop or close RPCs, restore in the header
and the floating fallback when every Inspector is minimized.

The separate Town golden fixture matches all five stored references exactly
with pinned Chrome 156.0.8078.80; its scene has no Inspector windows.
