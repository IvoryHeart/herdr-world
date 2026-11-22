# Apartments notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town's green building sign, town center ring and Board's hub open one Apartments dialog.
- Search opens resident detail, Read history, Resume in room and confirmed Evict on desktop/phone.
- ?apartments-preview=avatars supplies one-load synthetic appearance cases and removes itself.
- TUI resume opens the new terminal; core reports it back. Claude/Codex resume on the original host.

**Code:**

- `shared/apartments.ts`
- `server/src/world/apartments.ts`
- `server/src/world/apartment-census.ts`
- `server/src/world/apartment-resume.ts`
- `server/src/storage/apartments.ts`
- `web/src/world/apartments/ApartmentsDialog.tsx`
- `web/src/features/apartments/mount.tsx`

**Tests:**

- `server/src/world/apartments.test.ts`
- `server/src/world/apartment-census.test.ts`
- `server/src/world/apartment-history.test.ts`
- `web/src/world/apartments/ApartmentsDialog.dom.test.ts`
- `web/src/world/apartments/residentLook.test.ts`

**Pitfalls:**

- Disconnect/restart is not an observed ending; census is a separate admission route.
- One session is one resident; a running session hides its asleep record.
- Eviction forgets the record, not the transcript, and suppresses census rediscovery.
- Fallback looks disclose their basis instead of inventing captured appearance.
- No Apartments CLI is specified; resume uses the shared launcher.
