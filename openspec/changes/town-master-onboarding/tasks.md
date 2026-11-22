## Delivery state

The greeting is delivered, with its help news (What's new, Start here). The ? help and Try's highlight are delivered as [help that ships with each feature](../../specs/world-surfaces/settings/spec.md#requirement-help-that-ships-with-each-feature). Only the 12-step path, lessons and Guidebook in tasks 2.1–2.2 remain; they have no delivered requirement yet.

Delivered requirements are synchronized into [the current contract](../../specs/world-surfaces/town-master/spec.md#requirement-town-master-greeting).
No unsynchronized requirement delta remains in this record; unfinished tasks
and acceptance above keep the change active.

## 1. Greeting (first slice of O1)

- [x] 1.1 Visits, the once-per-visit rule, stepping aside for windows and sheets, and the last time here in `web/src/world/townMasterGreeting.ts`; verify with a fake clock in unit tests.
- [x] 1.2 The figure beside the Town board, the card at Board's hub and Desk's summary, the phone sheet with Back, and the card's lines; verify the card's content in a DOM test.
- [x] 1.3 **Show this on start** and **Menu → Town Master greeting** as one per-browser preference; verify the stored default and its reading.

## 2. Later slices

- [ ] 2.1 The 12-step path, ? marks, lessons and the highlight.
- [ ] 2.2 The Guidebook.
