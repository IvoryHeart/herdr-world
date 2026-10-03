## Context

World observes Herdr topology and agent lifecycle state. It already resolves agent session transcripts into ATIF trajectories for Agent History, and it can read a pane's visible screen through Herdr `pane.read`. Neither Herdr nor World records what an agent's turn produced. #151 records the research into Herdr and harness turn-end payloads and the preferred upstream direction.

## Decisions

- **Derive receipts, do not store them.** A turn is everything after the latest user message. The receipt carries the request (600 characters), the closing agent message (2,400 characters, or up to 32,000 on request), its timing, tool and command counts and up to 24 edited files from edit tool arguments and patch headers. Projection placeholders and trailing system records are excluded, so a late hook neither becomes the report nor changes the stop's identity. A later Herdr turn record (#151) can replace this source.
- **Lanes follow what the operator must do.** Blocked agents need an answer; done agents, idle agents whose turn ended within 12 hours, and agents this browser saw stop working need review; working agents are in flight; everything else is quiet. The question shown for a blocked agent is the bottom of its visible screen, because harnesses render approvals there rather than in transcripts.
- **Desk observes, the Inspector acts.** Every card opens the existing terminal Inspector. Desk adds no input channel, consistent with keeping terminal input in the visible Terminal Inspector.
- **Bound reads, not triage.** All admitted agents are partitioned and counted. Receipts for at most 40 agents (every 20 seconds, and on any status or activity change) and screens for at most 16 panes (every 4 seconds) are read, blocked first, then done, working and idle. Reads stop while the page is hidden and resume when it is shown.
- **Identity.** Receipts are stored per connection, generation, pane and session fingerprint, and screen excerpts per connection, generation, pane and session fingerprint, so a replaced session never shows the previous one's text and a refresh never blanks a card.
- **Review marks are browser-local for now.** A service-held, shared handled state is part of the #151 follow-up.

## Risks

- Screen excerpts depend on how each harness draws its footer; unknown chrome can appear in a live line. The filter covers Codex, Claude Code and Pi.
- Files are those edited by the agent's tools; changes made by shell commands can be missing.
