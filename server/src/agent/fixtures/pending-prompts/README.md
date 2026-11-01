# Captured prompt layouts

These plain-text pane captures came from real Codex 0.164.0 and Claude Code
2.1.312 prompts in an isolated Herdr 0.9.5 session. The tasks, choices, commands
and replies were synthetic. Harness headers and unrelated terminal history were
removed; the generated plan filename was replaced by `/project/demo/plan.md`.
The dialog layout and control footers are retained for parser regressions.

- Codex approval shows the current `y`, `p` and Escape hints, its environment,
  justification and command.
- Codex questions show descriptions without approval hints. A logical digit
  submits a choice. Pasting the same digit opens notes, as the notes capture
  shows; an open notes editor must not offer answer buttons.
- Claude question and plan captures include the initial choices, a selected
  empty inline editor and typed text replacing its placeholder. Enter submits
  the text; an empty answer declines the question.
- Claude inline and plan draft captures also show the cursor moved back to an
  ordinary choice. The typed draft remains in its editable slot even though the
  inline-editor footer disappears.
- Claude's discussion choice closes the question and returns to the composer;
  the discussion capture shows its typed reply before submission. The empty and
  multiline composer captures distinguish an empty prompt from a blank first row
  followed by an existing draft.

Herdr 0.9.5 reported Codex as `blocked` with `osc_title_blocked` matching and
`screen_detection_skipped: false`. World resolved the same pane through its
Codex title binding and read its pending prompt without Codex turn hooks.
The live World answer path selected Blue after logical-key dispatch was fixed.
Existing session admission is retained; these captures grant no authority to an
unbound or inferred Codex conversation and claim no other native platform.

## Command menus

The `menu-*` captures came from Claude Code 2.1.312 and Codex 0.164.0 in an
isolated Herdr 0.9.3 session, in a scratch project. Paths, the user and host
were replaced (`/project/demo`, `dev@example`); blank runs were squeezed.

- Claude Code `/model` in its full-screen rendering (top edge `▔`, with the
  status text Claude draws into it) and inline (`─`), and scrolled to option
  11. The list holds 13 models, so `1` is never a digit choice. A digit saves
  the default for new sessions at once; `s` uses the model for this session.
- Claude Code `/permissions`: tabs, a search field and its rules, then
  **Add a new rule…** with its entry field and the save-location step.
- Codex `/model` and its reasoning-level step, `/permissions` and the
  full-access confirmation, which Codex draws above its idle composer. A Codex
  digit selects without Enter.
- `menu-claude-permissions-list` is the same list after ↓ moves the cursor
  onto a rule; Herdr 0.9.3's `live_blocked_form` screen rule then reports
  Claude Code `blocked`.
- `menu-claude-closed` and `menu-codex-closed` show the screens after Escape
  or a choice. Otherwise Herdr reported Claude Code `idle` and Codex `done`.
