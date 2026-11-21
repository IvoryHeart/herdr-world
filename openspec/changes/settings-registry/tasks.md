# Tasks

## 1. Preview (#1035, PR #1062)

- [x] 1.1 Registry, categories, stable IDs and feature catalogs (first behind `?settings=next`, now the default).
- [x] 1.2 One search for Settings and the command box; the command box publishes its commands with its admission.
- [x] 1.3 Settings screen with tabs, All and search; phone sheet; `?setting=` links.
- [x] 1.4 View controls (Board, Town lenses, Manage connections) listed and opened on their view; Runtime section reachable.
- [x] 1.5 Live availability for dependent rows.
- [x] 1.6 DOM tests for search, links, command admission, view controls and availability (`web/src/settings/settings.dom.test.ts`).

## 2. Later slices (crew:idea)

The change remains active for these unchecked slices. Its already-synchronized
requirement is rebased as MODIFIED against the current spec, so eventual archive
can apply it without a duplicate ADDED requirement.

- [ ] 2.1 Move the remaining categories whole into Settings pages (#1063).
- [x] 2.2 Make the short Menu the default and retire the Configuration dialog (#1064, done in #1062); every old Menu and Configuration path moved into Settings first; delta synchronized into `world-surfaces`; FEATURES.md and the tutorial updated.
- [ ] 2.3 Shared stores for view-only controls so Settings changes them directly (#1065).
- [ ] 2.4 One Town master setting (#1066).
- [ ] 2.5 Upstream settings proposal (#1067).
