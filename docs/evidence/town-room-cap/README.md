# Fold and expand Town rooms

A room normally folds toward 24 desks. Selected, pinned, working, recent and
needs-you desks remain visible beyond that target. **+N** counts only currently
hidden desks; each click reveals about 20 more. **Fold** is available after the
first expansion, including while more desks remain hidden, and restores the
24-desk target in one action.

These fresh synthetic captures accompany the implementation in this commit.
They replace the retired header-control captures. The maintained
`TownCanvas.browser.tsx` fixture (`mode=preview&scale=fold`) supplies a 26-desk
room: the folded state shows 24 desks and **» +2** beside the dashed new-seat
**+**; the expanded state shows all 26 and **« Fold**. The plaque stays **4/26**
in both states: 4 active agents, 26 total agent reports.

Each image is a full viewport capture at the owner's exact dimensions. The
synthetic question was answered through its normal UI to clear the phone tray,
and the ordinary camera keyboard controls frame the room actions. No UI was
composited or restyled for capture. The phone views show the bottom-right action
tiles above the needs-you strip; the wide view includes neighbouring buildings.

| Viewport | Folded | Expanded |
| --- | --- | --- |
| 390 × 844 | [Folded](390x844-folded.webp) | [Expanded](390x844-expanded.webp) |
| 1512 × 982 | [Folded](1512x982-folded.webp) | [Expanded](1512x982-expanded.webp) |
| 1280 × 1440 | [Folded](1280x1440-folded.webp) | [Expanded](1280x1440-expanded.webp) |
| 2560 × 1440 | [Folded](2560x1440-folded.webp) | [Expanded](2560x1440-expanded.webp) |
| 1440 × 2560 | [Folded](1440x2560-folded.webp) | [Expanded](1440x2560-expanded.webp) |

[Partial expansion, 1512 × 982](1512x982-partially-expanded.webp) shows the
lower action area of the separate 100-desk fixture after one expansion to 44:
new-seat **+**, **» +56** to reveal more, and a separate **«** Fold action.
Its plaque counts all 150 agent-report panes across those desks, not only the
desks or agents visible in the camera viewport.
