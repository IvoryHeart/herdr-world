# workspace-assistant notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Ranger in workspace and agent Inspector contexts.

**Code:**

- `server/src/assistant/service.ts`
- `server/src/assistant/service.test.ts`
- `server/src/assistant/`

**Pitfalls:**

- Read and mutation actions keep their selected workspace and agent context.

## Usage reference

## Ranger and workspace tools

- Ranger reads explicitly permitted workspaces across local and SSH connections,
  chats with a configured model, and proposes actions for manual confirmation.
  An explicit high-permission mode can execute supported operations automatically.
- Ranger can use the service account's signed-in Claude Code CLI as a provider,
  alongside the existing model providers. Its tools retain World's workspace
  permissions, connection/runtime qualification and action confirmations.
- Ranger can show a workspace or session in the asking browser's shared Inspector;
  other windows stay where they are, and unavailable targets report an error.
- Scheduled tasks can explicitly follow all authorized workspaces, including new
  ones, with a fresh captured scope for each run.
- While Ranger answers, **Steer** or Enter adds a message after its current step;
  **Queue** or Alt+Enter (Option+Enter on macOS) waits for the next answer. Up to
  eight waiting messages can be edited or removed. Stop, failure or a chat switch
  holds them until **Send next**. A replaced runtime requires a refreshed scope.
- When the model provides reasoning, a collapsible **Thinking** section shows it
  above its reply. Selecting Ranger text is preserved while terminals repaint.
- Background tasks run once, at intervals or daily, with separate conversations
  and optional monitoring alerts. Saved schedules retain endpoint and workspace
  identity; interactive requests capture their runtime generation.
- Inspect Git commit history, keep file-preview tabs, pin and reorder native tabs,
  and move or swap panes within their owning connection.
- Configure terminal fonts and direct/composer input, upload files to the captured
  host, and set a distinct browser instance title.
- Login is required on localhost and other listeners, using a generated token or
  a configured 15–1024-character password, with throttling for failed attempts.

## Created workspaces and fixed tasks

Ranger can continue in a workspace it created
in that chat without widening global task grants. Fixed-scope tasks skip closed
original workspaces with a notice, refuse replaced identities, and re-check the
original workspace before a fresh run after Herdr restarts. An interrupted run
never resumes against a replacement server. World keeps its schema-v4 task store.

Scope extension: `server/src/assistant/scope-extension.ts`; task context and recovery: `server/src/assistant/task-run-context.ts`, `server/src/assistant/task-scope-recovery.ts`. Consumers: `server/src/assistant/context.test.ts`, `server/src/assistant/service.test.ts`, `server/src/assistant/task-scope-recovery.test.ts`.
