# Notifications notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Needs you badge, hidden-page title, toasts and supported app badges share attention counts.
- OS/Web Push notifications open their exact target; outside-filter targets offer explicit Reveal.
- Settings manages device sounds, motifs and class timbres; Inspector and Group controls set interest.
- TUI/core carry qualified sender/terminal metadata; missing sender claims stay unknown.

**Code:**

- `web/src/chimes/`
- `server/src/notifications/`
- `shared/chimes.ts`
- `shared/interest.ts`
- `web/src/chimes/chimeHost.ts`
- `server/src/notifications/herdr-notification-listener.ts`
- `server/src/world/interest-prune.ts`

**Tests:**

- `shared/chimes.test.ts`
- `server/src/notifications/herdr-notification-listener.test.ts`
- `server/src/notifications/web-push.test.ts`
- `server/src/world/interest-prune.test.ts`

**Pitfalls:**

- Muting changes chimes, never Needs you items, counts or reception placement.
- Town-master needs-you bypasses Focus only, not mute/device/motif/seen policy.
- A toast dismissal cannot answer or close the underlying durable item.
- OS fallback must respect silence reported by other pages and first-install state.
- CLI asks alert through Herdr; custom notifications are not a substitute for durable asks.
