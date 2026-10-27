# Chat input focus

Synthetic `AgentChat` browser-fixture captures for #448. At each viewport, the
conversation loads, the message input receives focus, and Chrome's input API
types **Ready to type** without a click. The screenshots show the retained focus
ring and text. They contain no real hosts, sessions or repository contents.

| Viewport | Capture |
| --- | --- |
| 390 × 844 | [Phone](390x844.png) |
| 1512 × 982 | [Desktop](1512x982.png) |
| 1280 × 1440 | [Portrait desktop](1280x1440.png) |
| 2560 × 1440 | [Wide desktop](2560x1440.png) |
| 1440 × 2560 | [Portrait wide desktop](1440x2560.png) |

These five captures cover the owner's reference contexts. Earlier supplemental
captures remain available at [320 × 740](320x740.png), [768 × 1024](768x1024.png),
[1440 × 900](1440x900.png) and [1920 × 1080](1920x1080.png).

These are standalone Chat component captures, not full-shell or native mobile
keyboard acceptance. Maintained `TerminalComposer.chat.test.ts` and
`VisualPreview.test.ts`'s AgentChat case cover opening, returning to the retained
editor, hidden Chat and transcript refreshes that leave focus elsewhere.
The browser cases also cover a newer Chat winning an out-of-order load and
focus moved during loading. `DeskView.browser.test.ts` previews a real
Inspector Chat while J/K, Enter and Escape keep operating on the queue.
The real mobile view-selector DOM regression checks menu-close focus restoration;
the AgentChat browser also covers the focused Town opener being removed before
the conversation loads. Later user focus, keys and pointer input still cancel.
