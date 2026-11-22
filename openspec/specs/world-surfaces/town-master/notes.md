# Town Master notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- A new visit opens the Town Master greeting at Town's figure, Board's hub or Desk's summary.
- Phone greeting is a Back-dismissable sheet; desktop waits only for overlapping windows.
- The card and Settings share Show this on start; news Try uses feature help declarations.
- TUI/core show the same scripted greeter; it has no agent or native operation authority.

**Code:**

- `web/src/world/town/legacyTownMaster.ts`
- `web/src/world/town/useTownMaster.ts`
- `web/src/world/town/useTownCenter.ts`
- `web/src/world/board/BoardHub.tsx`
- `web/src/world/officePreferences.ts`
- `web/src/world/TownMasterGreetingHost.tsx`
- `web/src/world/TownMasterCard.tsx`
- `web/src/world/townMasterGreeting.ts`
- `web/src/world/town/townMaster.ts`

**Tests:**

- `web/src/world/town/legacyTownMaster.test.ts`
- `web/src/world/town/useTownMaster.test.ts`
- `web/src/world/HostsFilter.cold.test.ts`
- `web/src/world/townMasterGreeting.test.ts`
- `web/src/world/TownMasterCard.test.ts`
- `web/src/world/town/townMaster.test.ts`

**Pitfalls:**

- The scripted greeter differs from the agent holding the Town master chime role.
- Thirty minutes hidden starts a visit; shorter backgrounding does not.
- News-seen and greeting preferences belong to the browser, not shared settings storage.
- A docked window elsewhere on desktop must not suppress the greeting.
- There is no greeting CLI; task-summary/role assignments are separate features.

## Usage reference

## Help and what's new

- **What can I do here?** opens World's help for the screen you are on: the
  **?** beside the views (desktop), the views button's menu (phone),
  **Menu → Help** (Settings at Help; the command box finds it too), Board's
  **⋯ → Help** and Chat's **⋮** tools. Tabs: **What's new**, **Town**,
  **Board**, **Code**, **Chat** and **Everywhere**. Each entry has a picture of the real
  control (phone or desktop, light or dark, as your screen), its steps, where
  it lives and **Try**.
- **Try** closes the help, switches to Town, Board or Code when the entry
  lives there, and rings the control for a moment. A Town control off camera (the
  Apartments sign below a phone's first view) is flown into view at the same
  zoom; Town itself never scrolls. A control inside a closed menu
  rings the button that opens it. **Quiet agents** opens the Town board and
  rings its line under **Busy**. When the control is not on this screen
  (Chat's controls without an open Chat, a phone-only control on a desktop,
  the quiet line while no agent is quiet), help reopens on that tab and says
  where to find it.
- **What's new from the Town Master**: after an update, the greeting lists up
  to four things new since the last version it showed in this browser, each
  with a picture and **Try**, and a link to all of them in help. A first
  visit shows **Start here**, the short first-run path, instead. Closing the
  greeting marks them seen; turning the greeting off leaves them in
  **Menu → Help → What's new**. Testing switch:
  `?whatsNewSince=0.3.0` shows what is new after 0.3.0, `?whatsNewSince=new`
  the first-run path; the address drops the parameter at once.
- The same entries make [docs/HELP.md](../../../../docs/HELP.md) and the website's help
  page. Help covers Town, Board, Code, Chat and controls on every screen;
  Desk and Spaces are not described there yet.

  - **Town Master greeting**: each visit (World opening, or its page coming
    back on screen after 30 minutes or more hidden), the Town Master, a small
    figure beside the town board, opens one card: hello with the time you
    were last here, the same **Since you left** lines as the board sign (each
    opens **Needs you** at its item; "Nothing new since you left." when there
    are none) and, when World's update check reports a newer release, one
    line whose **See update** opens **Menu** at its update entry (the greeting
    never installs anything). Board opens it at its hub beside the bin and
    Desk at its summary; a phone shows it as a sheet with **Back**. It never
    opens over an open window or sheet such as Chat or **Needs you**: on a
    phone it waits until they close; on a wide screen it waits only while one
    lies over the figure or the card's place, so an intent window or Chat
    docked on the other side does not hold it back. It also waits while
    Town's setup card (**Start Herdr** or **Set up herdr-core**) is up, and
    opens once the card is gone. **✕**, Escape, Back or a press outside closes it; tap
    the figure to open it again. Untick **Show this on start** at its foot,
    or switch **Menu → Settings → Greeting on start**, to stop it on this browser.
    Your very first visit is greeted too, without a last time. The card also
    carries [What's new](notes.md#help-and-whats-new) after an update, or **Start
    here** on a first visit.
