## 1. One runtime grouping

- [x] 1.1 Group runtimes setting under This World, stored in the service's UI settings with a read-through browser cache and a one-time move of the earlier Town choice.
- [x] 1.2 Shared grouping derivation over the host catalogue (`worldHostGroups`, `hostGroupOf`, `runtimeGroupKey`).
- [x] 1.3 Town buildings, the navigator and Desk's other-host summaries read the shared derivation.
- [x] 1.4 Unit tests for the setting, the derivation, the navigator groups and Desk summaries.
- [x] 1.5 Storage catalog rows and capability notes.
- [x] 1.6 Board zones follow the shared derivation (one zone per group, a row per runtime, per-runtime anchors and operations kept).
- [x] 1.7 Service answers and pushes carry commit revisions; the earlier Town choice moves as an only-if-absent write inside the serialized writer.
- [x] 1.8 Bounded exhaustive schedule check of competing saves, pushes, acknowledgements, migrations and refusals (`server/src/bridge/runtime-grouping-schedules.test.ts`).
