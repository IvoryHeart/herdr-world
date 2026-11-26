## 1. Per-World cookie and return path
- [x] Name the session cookie per browser-visible port; move this World's session from any other World cookie name once.
- [x] Carry a validated same-origin `next` through login, the login page and URL-token login.
- [x] Regress side-by-side Worlds, `/town?focusTest=1` round trips, open-redirect refusals and cookie moves.
- [ ] Independent security review.
