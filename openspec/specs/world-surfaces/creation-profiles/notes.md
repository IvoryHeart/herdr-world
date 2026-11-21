# Creation Profiles notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Actions New workspace/tab/agent, Town room +, Board New tab/note launcher and Spaces reach creation.
- Shared tab-strip, mobile creation and Inspector shortcuts use the same preparation/completion path.
- Settings, Actions, launcher and Board reach profile editing and harness readiness/login guidance.
- TUI uses bounded native starts and first-prompt delivery; core uses its own launch admission.

**Code:**

- `web/src/creationRequests.ts`
- `web/src/world/agentProfiles.ts`
- `web/src/world/ProfileEditor.tsx`
- `server/src/rpc/launcher.ts`
- `server/src/agent/profile-launch.ts`
- `server/src/rpc/launcher-probe.ts`

**Tests:**

- `web/src/world/SharedViewCreation.test.ts`
- `web/src/worldCreation.test.ts`
- `shared/agentProfile.test.ts`
- `server/src/rpc/launcher-tap.test.ts`
- `server/src/rpc/launcher-probe.test.ts`

**Pitfalls:**

- A method advertisement is not this browser's prepared source attachment.
- Global creation confirms one host; All hosts never means broadcast.
- A lost reply may mean creation happened; do not automatically relaunch.
- Readiness/login commands are host-specific; World shows login text rather than typing it.
- Profile definitions are World-owned, but current assignments are Herdr-owned; see appearance.
- No profile-management CLI is specified here; CLI integration commands manage skills.
