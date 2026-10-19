## Why

Town (the default view since #208) and Board (#215) now cover what Office, Tree and Graph were for:

- **Town** is the spatial picture of agents and their state.
- **Board** is the place to arrange work and plan with notes.

The owner decided on 2026-10-19 to sunset Graph, Tree and the Pixel Office. Keeping them costs a lot:

- **Code:** about 12,400 lines across 36 source files, plus their tests and browser suites.
- **Spec:** a large share of the World surfaces spec that every shared change has to keep consistent.
- **Duplicated machinery:** three more canvases with their own input handling.

Two interaction stacks remain after retirement, Town's and Board's. They solve the same problems separately:

- **Town:** pointer and pinch handling lives in one large effect, and it already runs on World's shared frame scheduler.
- **Board:** has an explicit gesture state machine and an event trace, but runs its own animation loop outside World's scheduler. That loop doesn't pause while the user types in a terminal and doesn't yield to socket replies.

The owner asked for that shared module as a follow-up to Board. With only Town and Board left, it's small enough to do properly.

## What Changes

**Part A: retire Graph, Tree and Office**

- **Views:** remove Graph, Tree and Office from the view switcher, phone navigation, routes and keyboard view shortcuts.
- **Old addresses:** `/office` opens Town, and `/graph` and `/tree` open Board. A saved last view of office, graph or tree maps the same way.
- **Remaining views:** Town, Board, Desk and Spaces.
- **Office-only settings go:** room alignment, long-title treatment and the Office scroll position. Inspector presentation (Docked or Floating) and Town calm motion stay as shared settings.
- **Code removed:**
  - **Views:** Graph, Tree and the Pixel Office, with their canvases, renderers, drawing, layout, simulation and preference modules (36 files), plus their tests and browser suites.
  - **Kept:** the room and desk projection, room actions, selection and observability modules that Town is built on.
  - **Anchor types:** the shared line-anchor types move from `PixelOfficeCanvas` to `worldConnectorGeometry`.
- **Spec:**
  - **Removed:** the Office, Graph and Tree requirements.
  - **Rewritten:** shared requirements that list views now name Town, Board, Desk and Spaces.
  - **Carried over:** behaviour Town and Board still use (the Inspector opening preference) moves into shared requirements.
- **Docs:** update the tutorial, FEATURES, README, site screenshots and knowledge map. Add a changelog Removed entry.
- **Verification:** `verification/coverage.json` areas that name Office or Graph code move to their Town or Board owners. The inventory stays at its fixed size.

**Part B: one interaction core for Town and Board**

- **Gestures:** a World-level gesture state machine, generalised from Board's `boardGesture.ts`: press, pan, pinch, hold-to-drag (touch), drag, double tap and fling. Each view supplies only what a pointer landed on and what each effect does. Town's inline pointer code moves onto it.
- **Frames:** Board animates through World's shared frame scheduler (`registerWorldFrames`), keeping Board's guarantees:
  - frames run only when something changed, with a reason;
  - the loop keeps going while something moves;
  - a failing frame is reported, not fatal.

  Board then pauses during terminal typing, yields to ordinary tasks and stops off screen, like Town.

- **Event trace:** a World-level trace with an overlay, available in both views through `?debug=town`, `?debug=board` and a ⋯ menu toggle. Copy trace produces a bug-report JSON that can be replayed as a gesture test.

## Capabilities

### Modified Capabilities

- `world-surfaces`: Graph, Tree and Office are removed, and the shared shell, navigation, Inspector and creation requirements now describe Town, Board, Desk and Spaces. A requirement covers retired view addresses and a shared interaction core for the spatial views.

## Impact

- **Users:** bookmarks and saved views for the retired views land in Town or Board. The Office's pixel scene and its room-alignment settings are gone.
- **Code:** a large reduction in web code and in the web asset budget. Town's pointer handling and Board's frame loop change, with behaviour preserved and covered by gesture tests.
- **Tests:** the Office, Graph and Tree unit and browser suites are removed, and the browser shard inventory is updated. #223 (test redesign) benefits directly.
- **Follow-ups:** #221 (shared appearance from the terminal title bar) only has Town, Board and Spaces to serve.
