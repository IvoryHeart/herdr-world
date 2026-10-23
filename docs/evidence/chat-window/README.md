# Chat window against the v4 prototype (#262)

Side by side: the v4 prototype's agent panel (`.term`) on the left, #262's one
agent window (World's Inspector, opened on Chat from Town) on the right.

- `phone-390-side-by-side.webp`: 390 × 844, touch.
- `desktop-1440-side-by-side.webp`: 1440 × 900.

The prototype shots open its panel on a waiting agent from the needs-you
tray. #262's shots come from a throwaway Herdr 0.9.3 session with synthetic
demo repositories and prompt, captured with headless Chrome. Every shot passed
the capture harness's privacy scan.

What #262 matches: one window per agent, opened from Town on Chat; docked right
on desktop and full screen on a phone; one composer and no terminal key bar in
Chat. What it does not match yet:

- The prototype's one-row header (Back, name and where, Next).
- Its Town skin.
- Its answer and state chips.

The header and skin come with design's one-row head (#265 phase 2). The chips
are a follow-up stacked on it. The synthetic session has no agent transcript,
so Chat shows its "Conversation unavailable" state here.
