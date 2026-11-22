## Decisions

Reuse the numeric harness collector; aggregate before its transport detail cap.
Use opaque Git-common-directory project identities, qualified by connection.
Keep observed status intervals separately from transcript observation spans and
never interpret idle as waiting on the owner. Only explicit blocked status counts
as observed waiting. Persist numeric daily intervals locally; restart never
resumes an open interval. Unknown prices remain unknown; optional existing price
estimates are separately named. Work-source PR creation/merge timestamps count
distinct known PRs, with catalogue coverage disclosed and ambiguous agent links
left unattributed. Both runtime kinds share the same service and response.

## Bounds and acceptance

Keep the existing today/seven-day UTC window and source collection budgets.
Bound status history, project reads and response groups. Refuse unknown parameters,
unqualified pane/room filters and invalid windows. Numeric cache corruption or
unavailable sources must not produce fresh zeros. A CLI-only synthetic fixture
allows deterministic trials without editing logs or running a provider.
