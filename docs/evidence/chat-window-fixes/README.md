# Chat in the agent window against Live Blocks

Side by side: FirstMate's Live Blocks chat concept on the left, an agent's
window opened on Chat from Town on the right, after Chat moved onto History's
window.

- `phone-390x844-side-by-side.webp`
- `laptop-1280x800-side-by-side.webp`
- `half-960x1080-side-by-side.webp`
- `wide-1920x1080-side-by-side.webp`
- `portrait-1080x1920-side-by-side.webp` (wide and portrait are at half scale)

The window shots come from a throwaway Herdr session with synthetic demo
repositories, prompt and Claude transcripts (one of them about 15 MB and still
being written), captured with headless Chrome. Every shot passed the capture
harness's privacy scan.

At every size the window's conversation scrolls inside it and the composer
sits at the window's bottom, docked (phone full screen). Measured on the same
page: 40 bubbles and tool cards rendered, the list's scroll height several
times its height, and the composer inside both the window and the screen.

What matches Live Blocks: one frame per agent with its selector on top, the
conversation filling the middle, one composer at the bottom. What it does not
match yet: Live Blocks' live step cards, numbered answers and status bar, which
are concept features, not part of this fix.
