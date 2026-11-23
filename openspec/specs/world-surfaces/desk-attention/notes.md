# Desk Attention notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Desk or /desk for Now, Agents and Reviewed, with shared search.
- Cards open exact agent Inspectors; Answer leads to Needs you and review offers Undo.
- Wide screens dock a reading pane and support J/K/Enter/E; phones open the Inspector full-screen.
- TUI/core use the same qualified receipts and stops; missing native evidence remains explicit.

**Code:**

- `web/src/world/useReviewedWork.ts`
- `web/src/world/useReviewedWork.test.ts`
- `web/src/world/DeskView.tsx`
- `web/src/world/ArtefactList.tsx` (what the agent made, on its card)
- `web/src/world/handoffs.ts`
- `server/src/world/desk-watches.ts`
- `server/src/rpc/desk.ts`
- `server/src/storage/terminal-marks.ts`

**Tests:**

- `web/src/world/DeskView.test.ts`
- `web/src/world/DeskView.browser.test.ts`
- `server/src/world/desk-watches.test.ts`
- `server/src/rpc/desk.test.ts`

**Pitfalls:**

- Review marks belong to a stop and session, not a name or receipt polling timestamp.
- A previous report must not enable reviewing a new stop whose report is pending.
- Outside-filter summaries are read-only until explicit Reveal & open admission.
- Superseded reveal/focus work cannot revive on returning to Desk.
- There is no Desk view CLI; task summaries are covered by history.

## Usage reference

- **Desk** organizes the filtered hosts' agents by what
  they need from you rather than where they run:
  - **Needs you** lists blocked agents, oldest first, with the question and choices
    read from the agent's screen; **Answer** opens the Needs you tab at that agent.
  - **To review** lists finished turns with your request, the agent's closing
    report, how long it ran, its tool calls and the files it edited, all read from
    the session transcript. **Mark reviewed** (`E`) acknowledges a turn across
    browsers of the same World service.
  - **In flight** lists working agents with their current request and a live line
    from each terminal. Quiet agents collapse below.
  - **Agents** lists every agent in the host filter, those you recently opened from the
    Desk first, then each workspace by recent activity. **Reviewed** lists the
    latest stop you marked for each idle or done agent, newest first, with
    **Reopen**; marking offers **Undo** for that exact stop across browsers.
    Marks, observed stops and recent opens are saved in bounded World storage,
    bound to their original connection, terminal and known agent session. They
    survive reloads and service restarts, reappearing after fresh verification.
    A terminal confirmed absent or a positive session replacement clears them;
    previous browser-local Desk marks are not imported. Marks agree even when
    browsers read different receipts; later stops or native activity need review.
    Review marks survive expiry of the stop's display time. Native state-change
    progress reveals later completed work even when no browser saw it working.
    Newly detected stops refresh their receipts. An older report cannot enable
    **Mark reviewed** during refresh; unavailable reports can settle without
    blocking review.
  - On wide screens, opening a card snaps that agent's Inspector to the right (on
    Chat, or the terminal when the agent has no Chat or **Agents open** is set to
    Terminal) beside the Desk as a reading pane and folds the lanes
    into one queue. `J`/`K` preview the next agent there, `Enter` opens it using
    **Agents open** and `Esc` closes the pane. Phones open the Inspector full screen.
  - One search (`/`, `Ctrl+F` or `Cmd+F`) filters every mode by agent name, thread title, harness,
    workspace, tab, folder, request and report. Agents are named by the thread
    title their harness writes to the terminal when they have no Herdr name.
  - `J`/`K` move between cards; `Enter` opens the agent's Inspector using **Agents open** to
    answer, review, or watch. Expand an outside-filter host's summary chip to see
    its agents. **Reveal & open [agent] on [host]** explicitly adds that host to
    Hosts and opens that exact agent's Inspector while preserving existing open
    resources. Host controls remain visible beside a reading pane and wrap below
    the counts on phones. Cached, unavailable or replaced agents explain why they
    cannot open. Leaving Desk or starting another opening cancels a pending
    reveal permanently; supersession keeps current agents available to retry.
