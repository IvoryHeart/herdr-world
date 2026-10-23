## 1. Service

- [x] 1.1 Profile model, validation, starters and harness mapping in `shared/agentProfile.ts`; verify the mapping per harness and the credential refusal in unit tests.
- [x] 1.2 Profile store with assignments; verify seeding, starter marking, bounds and an unreadable file.
- [x] 1.3 Shared launcher replacing Board's start; verify shell-not-ready and name-taken retries, early exit, questions, impostors and lost replies with a fake Herdr, and against a throwaway Herdr session.
- [x] 1.4 Harness readiness and login as per-harness data; verify with fake binaries, including that account details never leave the service.
- [x] 1.5 Skill discovery on the room's host; verify with a temporary folder and an SSH argument check.

## 2. Browser

- [x] 2.1 Launcher dialog and its entry points in Town, Spaces and Board.
- [x] 2.2 Profile editor and character creator; Town draws launched agents with their profile's look.

## 3. Follow-ups

- [ ] 3.1 `herdr-world profile ls|show|create|apply` once the teams CLI lands.
- [ ] 3.2 Record `spawned-by` for launched agents once teams' relations land.
