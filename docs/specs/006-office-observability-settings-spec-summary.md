# Implementation summary — Office observability settings

- **Parent spec:** [`006-office-observability-settings-spec.md`](006-office-observability-settings-spec.md)
- **Implemented at:** 2026-08-11
- **Implementation status:** Downstream slice delivered; upstream boundary review remains pending

> The Office settings implementation is intentionally isolated from generic
> Herdr Web settings so the downstream slice can be removed cleanly before an
> upstream contribution.

### 2026-08-11 — Delivered implementation

- **Implemented:** Added `web/src/world/worldSettings.ts` for validation,
  per-bridge browser persistence, and bridge-boundary configuration calls;
  added `WorldSettingsDialog.tsx` and a single removable Office entry point in
  the generic Settings dialog. The bridge now exposes a bounded GET/PUT
  observability configuration route and can replace the live Prometheus
  provider without restarting. Provider health remains available through the
  Office settings surface and existing CEO boards/sidebar; the persistent
  notice strip is intentionally removed to preserve canvas real estate.
- **Evidence:** 331 frontend unit tests passed; frontend lint and production
  build passed; 15 bridge observability tests passed; bridge `cargo check` and
  formatting checks passed; the live bridge configuration route returned 400
  for an unsupported scheme and accepted clearing the provider; the browser
  refresh restoration regression passed, as did the stable conversation and
  attached-terminal regressions. Local manual verification also confirmed that
  an invalid Office Prometheus URL reports degraded provider health and a
  corrected URL recovers without a page reload.
- **Constraints / operational notes:** The bridge keeps dynamic configuration
  in memory. Browser local storage reapplies the selected value after a bridge
  reconnect; with no saved Office value, the existing environment variable
  remains the startup default. Saving `null` explicitly disables the provider
  for that browser/bridge profile. No credentials are accepted or persisted.
- **Drift from approved spec:** The live settings seam is downstream-only and
  permits operator-selected bridge profiles subject to the existing bridge
  Host/Origin policy. A future upstream proposal still needs an explicit
  authorization, remote-bridge, and native-shell review.
- **Follow-up extension:** [SUG-028](../suggestions.md#sug-028--smooth-office-terminal-refit-during-resize)
  tracks the separately observed Office terminal refit catch-up during window
  resizing. A later extension should also define any upstream settings
  protocol or durable bridge-owned persistence before that behaviour is
  proposed upstream.
