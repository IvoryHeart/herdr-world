# Fold and expand Town rooms

A folded room shows the first 24 tabs in the same native order as Spaces.
**+N** counts only hidden desks; each click appends the next 20 tabs. **Fold**
is available after the first expansion, including while more desks remain
hidden, and restores the first 24 in one action. Status, pins and selection
never pull later tabs across that boundary.

A red **!** in the tile's top-left marks hidden desks that need you. A green
**✓** in its top-right marks hidden unreviewed completions. These icons use
shared rail calls and qualified Ask identities, carry accessible descriptions,
and disappear as desks are revealed or the attention is resolved. They add no
visible counts to the existing **+N** hidden-tab count.

These fresh synthetic captures accompany the implementation in this commit.
They replace the retired header-control captures. The maintained
`TownCanvas.browser.tsx` fixture (`mode=preview&scale=fold`) supplies a 26-desk
room: the folded state shows 24 desks and **» +2** beside the dashed new-seat
**+**, with red **!** and green **✓** corners for tabs 25 and 26; the expanded
state shows all 26 and **« Fold**, with both hidden-attention icons cleared. The plaque stays **5/26**
in both states: 5 active agents, 26 total agent reports.

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
