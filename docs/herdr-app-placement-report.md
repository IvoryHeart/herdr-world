# Herdr app placement evidence

World issue: [#1435](https://github.com/IvoryHeart/herdr-world/issues/1435).
Sources and dispatcher handoff: [runtime notes](../openspec/specs/herdr-core-runtime/notes.md#app-placement-contract-and-dispatcher-labels).

`herdr.space` and `herdr.tab` are desktop adoption hints. The desktop app stores
its adopted spaces, names, tabs and pane membership in core's `herdr-app`
document. Phone Spaces consumes that shared layout; terminals can appear without
a desktop app, but spaces require it. `where` is output only, not a name input.
Two correctly labelled native records without an app document establish label
mapping only, not phone grouping. The earlier upstream-defect conclusion was
unsupported and is withdrawn. Q8 desktop/phone acceptance remains open.

World now observes that document read-only, uses adopted membership and names
across its shared read model, and refuses moves of adopted terminals with an
explanation to move them in Herdr's app. It retains the existing launch and
unadopted-move labels. It never writes `doc.set`. The crew's helper-parentage
change is separate dispatcher work.

## Executable evidence

- Provider tests pin two launches with a shared space ID and distinct tab IDs,
  adopted placement overriding stale labels/World placement, caption-independent
  names, document refresh/recovery and overtaken replies, and move refusal.
- The isolated real-core suite launches two harmless programs, reads the native
  labels and moves the unadopted desks without changing their programs. Every
  core and program runs in disposable state and is stopped afterwards.
- Neither the installed desktop app nor Android rendering was available here.
  These tests make no claim that labels alone create phone spaces.

## Try it

For a synthetic preview check, open World with `?coreFixture`, open **Manage
connections**, and in **Fixture core** click **Start fixture core**. Return to **Town** and
drag a desk in **web** into **api**: it should refuse with the app-ownership
explanation. The fixture now publishes a genuine app-shaped document; its
unnamed rooms still read **api**, **docs**, **infra** with derived markers.
Use **Remove fixture** afterwards. This does not exercise a phone app.

In World, open **Town** on a connected core. Rooms and desks already adopted by
Herdr's app should follow the app's names and membership even if labels disagree.
Drag an adopted desk to a different room: World should explain **Move it in
Herdr's app so the change also appears on your phone**, and leave it in place.
Move it in Herdr's desktop app, then check World and the phone's **Spaces**;
they should follow the published app layout. A core with no app document still
uses label grouping in World; it does not promise a phone space. No files or
databases need manual editing. Desktop and phone acceptance remains Q8 work.
