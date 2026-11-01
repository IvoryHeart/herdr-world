## MODIFIED Requirements

### Requirement: Bounded Desk observation

Desk SHALL partition and count every current actionable agent within the host filter. Each
browser's Desk SHALL choose receipts for at most 40 agents and visible screens for at most 16 panes
globally, choosing blocked, then done, working and idle agents first. Capacity SHALL be shared
fairly among hosts within each urgency tier. When the World service advertises
`world_shared_acquisition`, Desk SHALL declare its chosen targets to the service, which SHALL read
each declared target once for all browsers that declare it, with independent per-host queues.
Otherwise each browser's Desk SHALL read its chosen targets itself, with independent per-host
queues, as before this change. Failed or retired hosts SHALL NOT redirect reads to another host or
prevent healthy hosts from being read. Pending reads SHALL retain active admission until
settlement; status, activity and visibility refreshes SHALL coalesce queued work without
overlapping reads of the same kind on one host. Receipts SHALL refresh on a status or activity
change and every 20 seconds; screens SHALL refresh every 4 seconds. While its page is hidden or its
Desk is closed, a browser SHALL release its declarations, or stop its own reads including reads
already queued, and resume when shown. The service SHALL stop reading a target that no browser
declares, including reads already queued. A browser that starts declaring a target SHALL receive
its latest result only once a read exists, never a placeholder. Receipts and screen excerpts SHALL
be keyed by connection, runtime generation, pane and agent session, so a replaced session never
shows the previous session's text and a refresh does not remove a shown receipt.

#### Scenario: More agents than the read bound

- **WHEN** a host has 40 idle agents and one blocked agent
- **THEN** the blocked agent appears in Needs you and is among the agents whose screens and receipts
  are read

#### Scenario: A Desk read completes after host retirement

- **WHEN** a receipt, full report or screen read completes after its runtime is retired
- **THEN** its result is not published and healthy hosts remain independently readable

#### Scenario: Slow Desk host alongside a healthy host

- **WHEN** a filtered host's receipt or screen read remains pending
- **THEN** another host's receipts, review controls and screen reads progress independently,
  and equally urgent hosts share the bounded read admission fairly

#### Scenario: Two browsers show the same Desk

- **WHEN** two visible browsers show Desk for the same agents
- **THEN** the service reads each declared screen once every 4 seconds and each declared receipt
  once per refresh, and both browsers show the same results

#### Scenario: Service without the capability

- **WHEN** the World service does not advertise `world_shared_acquisition`, for example after a
  rollback
- **THEN** each browser's Desk reads its own chosen screens every 4 seconds and its receipts every
  20 seconds and on a status or activity change, as before this change

#### Scenario: One of two browsers stops showing Desk

- **WHEN** one of two browsers showing the same Desk is hidden or closes Desk
- **THEN** the other browser's screens and receipts keep refreshing, and the service stops a read
  once no browser declares it
