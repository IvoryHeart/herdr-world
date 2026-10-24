### Fixed

- Restored Chat typing, Send and attachment uploads in the full app while
  keeping drafts isolated by host, runtime and conversation.
- Agent Files and Changes now share an evidenced worktree target rather than
  silently using the launch checkout. The location popover shows sources and
  alternate worktrees; stale or ambiguous evidence requires a current choice.
  Unreadable transcript evidence does not hide a usable live worktree, replaced
  bindings retire pending previews, and agent windows omit unrelated launch-tree
  Changes counts.

### Added

- Chat shows compact pull request cards beneath an agent's known PR announcement
  or current work claim. Open the details to inspect CI and reviews; **Ask the
  author to fix** sends a `↳ #N` message when this conversation owns the claim.
- Chat's Now status uses a small state circle, with its status word available
  to screen readers and on hover; reduced motion keeps the working dot still.
- Chat now uses the full shared Compose editor, attachments and harness command
  palette. Enter sends and Shift+Enter adds a line, with drafts kept per
  conversation. Slash commands have honest unchecked receipts, and native
  working-state sends show queued bubbles until their transcript receipt.
- The current quest takes one slim title/progress row inside the conversation;
  expand it for objectives without adding a fixed toolbar.
- While reading back in Chat, the existing catch-up button counts new agent
  messages and clears at the bottom. Own messages and queued bubbles do not count.
