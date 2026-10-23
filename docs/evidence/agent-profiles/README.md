# Agent profiles and New agent against the character-creator prototype (#273)

Side by side: chatlab's character-creator prototype on the left, #273 on the
right, at five viewports.

| Viewport | Profile editor, Look tab | New agent |
| --- | --- | --- |
| Phone, 390 × 844, touch | `phone-390-look.webp` | `phone-390-launch.webp` |
| Tablet, 820 × 1180 | `tablet-820-look.webp` | `tablet-820-launch.webp` |
| Laptop, 1024 × 768 | `laptop-1024-look.webp` | `laptop-1024-launch.webp` |
| Desktop, 1440 × 900 | `desktop-1440-look.webp` | `desktop-1440-launch.webp` |
| Wide, 1920 × 1080 | `wide-1920-look.webp` | `wide-1920-launch.webp` |

Both sides show the Designer starter (bun, dress, pencil) on its Look tab,
then the launch dialog. #273's shots come from a throwaway Herdr 0.9.3 session
with three synthetic repositories (`harbor`, `orbit-api`, `tide-charts`) and a
neutral prompt, served by a scratch World with its own home, and captured with
headless Chrome. Every shot passed the capture's privacy scan. That scratch
home has no harness logins, so the launcher shows Claude and Codex as logged
out with **Log in**, which is how a host without a login looks.

What #273 matches: the roster with starters, the Who / Brain / Skills & tools /
Brief / Look tabs, the look's palettes, hair styles, outfits (including the
dress and the captain) and accessories drawn with Town's own sprite, Surprise
me, a live preview, the "What a launch runs" panel with the World profile
toggle, and a one-tap launch of a profile into a chosen room.

Where it differs, on purpose or for later:

- The preview animates the character on its own (walking, turning, sitting)
  rather than inside a room scene with Working, Needs you and Done poses.
- A launch writes no agent file into the checkout: Claude Code gets the same
  subagent definition inline (`--agents`, `--agent`), which also works on SSH
  hosts.
- The launcher shows one progress line, then opens the new agent's terminal;
  the service reports the outcome, not each step.
- The brief is sent when the agent is ready or not at all; the prototype's
  "put the brief in the composer for your tap" is a follow-up.
- No "Look from name" button: an agent without a profile already gets the look
  Town derives from its name.
