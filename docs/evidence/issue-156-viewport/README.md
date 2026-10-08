# Issue 156 viewport verification

Checked on 8 October 2026 against World main at
`50b4b408f119ea7fef15ffe45d6b1799ab6c04e5` (0.2.3 release).

The owner confirms that the reported viewport problem is no longer present.
Headless Chrome exercised the actual React World shell and Terminal components
with the existing synthetic World terminal-handoff fixture. Transport and runtime
data are fixture-controlled; these are acceptance screenshots, not live runtime
or physical-device photographs. No application source changes were made.

## Results

| State | Layout viewport | Visual viewport height | Evidence |
| --- | --- | --- | --- |
| Portrait | 390 × 844 | 844 | [Screenshot](mobile.png), [bounds](mobile.json) |
| Narrow portrait | 320 × 640 | 640 | [Screenshot](mobile-320.png), [bounds](mobile-320.json) |
| Reduced height | 390 × 650 | 650 | [Screenshot](mobile-short.png), [bounds](mobile-short.json) |
| Landscape | 844 × 390 | 390 | [Screenshot](mobile-landscape.png), [bounds](mobile-landscape.json) |
| Simulated keyboard occlusion | 390 × 844 | 564 | [Screenshot](mobile-keyboard.png), [bounds](mobile-keyboard.json) |
| Keyboard dismissed | 390 × 844 | 844 | [Screenshot](mobile-restored.png), [bounds](mobile-restored.json) |

Every visible top-bar button and the Open device keyboard button stayed within
both the horizontal viewport and the available visual viewport height. All six
capture states passed those bounds assertions. Screenshots were inspected for
clipping and private data. The keyboard screenshot includes the layout area below
the simulated visual viewport; no operating-system keyboard is rendered there.

The existing World handoff assertions also passed: keyboard occlusion reduces
the Inspector work area once, the terminal sends a smaller row count, and
keyboard dismissal restores the original height. The focused trusted mobile
terminal cases passed at both 320 px and 390 px.

```sh
bun run test ./web/src/world/WorldTerminalHandoff.test.ts \
  ./web/src/mobileTerminal.test.ts --parallel=1
```

Result: 3 passed, 0 failed, 59.52 seconds. An additional untracked capture adapter
used the harness's existing capture endpoints, added the viewport variants and
bounds assertions, and captured the keyboard and restored states. Its complete
handoff case passed in 37.37 seconds. The adapter changes only fixture capture;
it is not part of the product or a replacement for the committed regressions.

This verifies viewport resizing and orientation geometry in headless Chrome.
Actual mobile browser chrome, safe-area hardware and a native software keyboard
were not exercised. Together with the owner's confirmation, this supports closing
[issue 156](https://github.com/IvoryHeart/herdr-world/issues/156); any recurrence
should include its device/browser and current version.
