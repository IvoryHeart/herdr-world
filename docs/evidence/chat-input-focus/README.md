# Chat input focus

Synthetic `AgentChat` browser-fixture captures for #448. At each viewport, the
conversation loads, the message input receives focus, and Chrome's input API
types **Ready to type** without a click. The screenshots show the retained focus
ring and text. They contain no real hosts, sessions or repository contents.

| Viewport | Capture |
| --- | --- |
| 320 × 740 | [Phone](320x740.png) |
| 390 × 844 | [Phone](390x844.png) |
| 768 × 1024 | [Tablet](768x1024.png) |
| 1440 × 900 | [Desktop](1440x900.png) |
| 1920 × 1080 | [Wide desktop](1920x1080.png) |

These are standalone Chat component captures, not full-shell or native mobile
keyboard acceptance. Maintained `TerminalComposer.chat.test.ts` and
`VisualPreview.test.ts`'s AgentChat case cover opening, returning to the retained
editor, hidden Chat and transcript refreshes that leave focus elsewhere.
