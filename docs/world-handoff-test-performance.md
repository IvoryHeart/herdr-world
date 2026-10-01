# World handoff browser test timing

`web/src/world/WorldTerminalHandoff.test.ts` was taking about 47.5 seconds in
focused local runs. Its browser fixture deliberately waited for the full
21-second created-pane admission deadline, plus 200 ms, to verify failure and
late-focus cleanup. That single wait accounted for nearly half the test time.

The fixture build now substitutes a one-second deadline only in this browser
test. The transform requires the exact production declaration, so a change to
that declaration fails the fixture build instead of silently dropping the
override. `officeRoomActions.test.ts` still checks the production 21-second
constant and retry boundary. The browser test still checks the deadline notice,
preserved Inspector selection, and late focus completion.

Three focused runs after the change took 27.3, 27.5, and 27.7 seconds and
passed. Against three runs immediately before it at 47.4, 47.5, and 47.7
seconds, the local improvement is about 20 seconds per run, or 42%. CI timing
remains to be measured on the final head.

The intermittent scroll assertion had a separate test synchronization error:
after clicking Scroll windows right, it waited for a value above zero, which
could already be true before the click. The assertion could then see the click's
later update and attribute it to pointer focus. It now waits for an increase
from the value before the click. The prior Inspector Terminal focus fix remains
covered by the resize-handle focus assertion. These changes passed three
focused runs together; exact-head CI remains the final verification.

The remaining roughly 27 seconds covers the broad Inspector, room, tab and
terminal handoff sequence, including many state transitions. Any further
reduction should profile those transitions and split cases only where the
assertion ownership stays clear. The separate
[UI scale timing analysis](ui-scale-test-performance.md) covers the larger
browser-test cost in that matrix.
