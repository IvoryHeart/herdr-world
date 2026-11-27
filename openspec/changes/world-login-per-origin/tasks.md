## 1. Per-World cookie and return path
- [x] Name the session cookie per World by a digest of its signing secret; move a legacy session once; logout clears both.
- [x] Bound other Worlds' cookies on a host, least recently seen first.
- [x] Carry a validated same-origin `next` through login, the login page and URL-token login.
- [x] Regress side-by-side Worlds, `/town?focusTest=1` round trips, open-redirect refusals, port swaps, full logout and cookie moves.
- [ ] Independent security review.
