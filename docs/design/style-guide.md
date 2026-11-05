# World style guide

**Status: proposed, awaiting owner approval.** Use it for new UI and for
anything you touch. Token and component changes come in separate PRs after
approval. This guide doesn't change product code.

World is one Bun service with a React web app. Its look comes from
[Roamgate](../../UPSTREAM.md): colour tokens in
[`web/src/styles/tokens.css`](../../web/src/styles/tokens.css) and primitives in
[`web/src/styles/base.css`](../../web/src/styles/base.css). World adds three
views, Town, Board and Desk, plus floating windows and trays. This guide says
how they all look like one product.

The images are a static specimen rendered from the real `tokens.css` and
`base.css`, with synthetic names. They are not product screenshots.

## Contents

- [Principles](#principles)
- [Skins](#skins)
- [Tokens](#tokens)
- [Components](#components)
- [Layout and phone rules](#layout-and-phone-rules)
- [Motion](#motion)
- [Accessibility](#accessibility)
- [Dos and don'ts](#dos-and-donts)
- [Checklist for a UI change](#checklist-for-a-ui-change)

## Principles

1. **One anatomy, several skins.** A component has one structure, spacing,
   type and set of control sizes. A skin changes token values, never structure.
2. **Town is a place, and Board and Desk are tools.** Town is skeuomorphic:
   pixel art, framed boards, gold accents. Board and Desk are utility surfaces
   for scanning and acting quickly. They meet in the floating surfaces (agent
   windows, Needs you, trays, peeks), which take the skin of the view they
   float over.
3. **Tokens, not values.** Colours come only from tokens. No new hex values,
   and no `var(--x, #hex)` fallbacks. Every token is always defined.
4. **Reuse before adding.** Use an existing button, card, badge or tray before
   inventing one. Add no new bar or header button when an existing control can
   carry the action.
5. **Phones are first-class.** Every tappable control has a hit area of at
   least 44 px. Back is always at the top left. No action is reachable only by
   a swipe.
6. **Roamgate-derived files change only when touched.** Most off-scale values
   live in Roamgate-derived `web/src/components/`. Mass-editing them makes
   upstream sync harder. Apply this guide to World-owned files
   (`web/src/world/`) and new code first.

## Skins

| Skin | Where | How |
| --- | --- | --- |
| **Shell** (default) | Board, Desk, Spaces, Chat, dialogs, settings | `tokens.css` as is; accent colours from the user's accent setting |
| **Town** | the Town view and every surface floating over it | a scope that re-maps the shell tokens to Town values, as `.world-managed-window.is-town-skin` does in [`windows.css`](../../web/src/world/windows/windows.css), plus a 2 px edge ring |

- Town re-maps `--panel`, `--text`, `--text-strong`, `--muted`, `--accent`,
  `--accent-soft` and `--panel-2`.
- Town's fonts are Rubik for UI text and Silkscreen for plaques and window
  titles. Never use Silkscreen for body text, names or buttons.
- Components never read `--town-*` tokens or hard-code Town colours. A
  component written in shell tokens is automatically right in both skins.

| Shell | Town |
| --- | --- |
| ![The same card in the shell skin](images/card-shell.png) | ![The same card in the Town skin](images/card-town.png) |

## Tokens

### Colour roles

Use the role, not the colour.

| Role | Token |
| --- | --- |
| App background | `--shell-bg` |
| Card, panel, tray | `--panel` (`--shell-panel` where the shell takes the accent tint) |
| Raised control, hover | `--panel-2` |
| Field, well, code, terminal preview | `--input-bg` (`--viewer-content-bg` in viewers) |
| Title, name, primary label | `--text-strong` |
| Body text | `--text` |
| Meta, secondary, placeholder | `--muted` |
| Card and control edge | `--border` |
| Divider inside a card | `--border-soft` |
| Focus, link, selected edge, count-badge fill | `--accent` |
| Primary and selected fills | `--accent-soft`, `--accent-hover`, `--accent-active` |
| Shadows | `--shadow-lg` (trays), `--shadow-tooltip` (hover cards), `--shadow-modal` |

A **solid `--accent` fill is for indicators only**: count badges, the switch-on
state, progress and drop markers. It is never a button fill.

### State colours

One map for every view:

| Meaning | Edge or icon | Fill | Strong text |
| --- | --- | --- | --- |
| Needs you, waiting on a person | `--yellow` | `--warning-soft` | `--warning-text` |
| Working | `--blue` | `--accent-soft` | `--info-text` |
| Done, to review | `--green` | `--success-soft` | `--success-text` |
| Error, failed, disconnected | `--red`, `--danger-border` | `--danger-soft` | `--danger-text` |
| Idle, quiet, settled | `--muted` | none | `--muted` |

Town's `--town-wait`, `--town-work` and `--town-done`, Desk's lanes and Board's
`--s-*` are those views' values for the same meanings. Never show state by colour
alone: pair it with an icon shape or a word.

### Spacing

Use **2, 4, 6, 8, 10, 12, 16 or 24 px**.

| Use | px |
| --- | --- |
| Icon to label | 6 |
| Between controls in a row | 8 |
| Between zones in a card | 8 |
| Card padding | 12 |
| Between cards in a list | 8 |
| Tray or list body padding | 12 |
| Between sections | 16 |

### Type

Use **11, 12, 13, 14, 16 or 20+ px.** Weights are **400** for body text,
**600** for labels and buttons, and **700** for names and titles.

| px | Use | Line height |
| --- | --- | --- |
| 11 | caption, meta, timestamps, pill text, inline counts | 1.3 |
| 12 | secondary text, compact button labels, helper and error text | 1.4 |
| 13 | buttons, menu items, list rows, card names (700), dense card body | 1.3 for controls, 1.45 for text |
| 14 | reading text in cards, inputs, tray titles (700), phone button labels | 1.55 |
| 16 | dialog and sheet titles (700) | 1.3 |
| 20+ | display numbers only (Desk counters, Town board stats) | 1.1 |

- Text never goes below 11 px. The one exception is count-badge digits, which
  always sit on an icon that carries the meaning.
- Code, paths, IDs and run facts use `var(--mono-font)`.

### Radius and control heights

| Radius | Use |
| --- | --- |
| 4 | keycaps, tiny chips |
| 8 | buttons, inputs, inner blocks (code, previews) |
| 12 | cards, panels, windows |
| 16 | dialogs, sheets |
| 999 | pills and badges |

Never nest a radius equal to or larger than its container's.

| Height | Use |
| --- | --- |
| 28 | compact: desktop toolbars, dense rows, tray headers |
| 32 | default desktop control |
| 44 | every content control in the phone layout (`html[data-layout="mobile"]`) |

## Components

### Button

All variants are in `base.css`.

![Primary, secondary, quiet, destructive and link buttons at 32 and 28 px](images/buttons.png)

| Variant | Look | Use |
| --- | --- | --- |
| Primary | `--accent-soft` fill; border `color-mix(in srgb, var(--accent) 58%, var(--border))`; `--text-strong`, 600 | the single recommended action |
| Secondary (`button`) | `--panel-2` fill, `--border`, `--accent` border on hover | other actions |
| Quiet (`.ghost`) | transparent, `--panel-2` on hover | low-stakes actions: Dismiss, Less, ⓘ, close |
| Destructive (`.danger`) | `--danger-soft`, `--danger-border`, `--danger-text` | irreversible actions only |
| Link | `--accent` text, underline on hover | More, Read all, inline navigation |

- At most **one primary per card or dialog**. In a row of answer choices, the
  first choice is the agent's recommended one and is the primary.
- In a footer, quiet or destructive actions go at the start and the primary
  goes last.
- Focus: an accent border plus a `0 0 0 3px var(--accent-soft)` ring. In
  `forced-colors` mode, a 2 px Highlight outline.
- Disabled: opacity 0.45. Keep a briefly unavailable button visible.
- Sizes:
  - **Compact:** 28 px, padding 0 10, 12 px label.
  - **Default:** 32 px, padding 0 12, 13 px label.
  - **Touch:** 44 px, padding 0 14, 14 px label.
- Icon-only buttons are square at the same heights.

### Inline input with action

- One row holds the field and only its own submit button:
  - **Field:** flexible width, `--input-bg`, radius 8, 14 px text, padding 0 12.
  - **Submit button:** the same height as the field, 8 px gap. It keeps its
    label and never wraps below the field.
- Submit is disabled while the field is empty. Enter submits, and on phones the
  button stays visible.
- Errors go under the row, 12 px `--danger-text`, announced with `aria-live`.
- Other actions (Dismiss, Chat) go in the card footer, never in the input row.

### Card

| Desktop | Phone |
| --- | --- |
| ![Card anatomy on desktop](images/card-shell.png) | ![Card anatomy on a phone, with 44 px controls; the dashed outline is the hit area](images/card-phone.png) |

A card has up to four zones, 8 px apart, inside 12 px padding, with radius 12 and
a 1 px `--border` on `--panel`:

1. **Header**, one line: kind icon (16 px, shape and colour from the state
   map), name (13/700 `--text-strong`, may be a link), meta (12 `--muted`,
   ellipsis) and an optional quiet icon button at the end.
2. **Body:** reading text clamped to three lines with More/Less. Inner blocks
   use `--input-bg`, radius 8 and padding 8 10.
3. **Answer zone** (optional): answer choices (wrapping, 8 apart), then the
   inline input row.
4. **Footer** (optional): quiet or destructive actions at the start, then the
   main action last. Leave it out when it would be empty. Spacing separates the
   zones, not dividers.

States:

- **Focused or selected:** `--accent` border.
- **Needs attention** in a mixed list: a 3 px start bar,
  `inset 3px 0 0 var(--yellow)`.
- **Settled:** `--muted` text, collapsed to the header plus one line.

In the Town skin the 1 px border becomes the 2 px Town edge ring with a 1 px
inner highlight.

### Badges and counters

![Count badges on icons, inline counts and status pills](images/badges.png)

1. **Count badge on an icon** (header, dock, view picker). There is one look:
   the Hosts badge (`.world-hosts-count` in
   [`world-shell.css`](../../web/src/world/world-shell.css)).
   - Size and position: 14 px tall, minimum 14 px wide, padding 0 2, radius 7,
     offset `-7px` top and `-9px` right.
   - Colour and text: `--accent` fill, `--bg` text, 9 px/700.
   - Hidden at 0 and capped at 99+. Its parent must not clip it.
2. **Inline count in a label** ("Now 32"): 11/600, padding 0 6, 16 px tall,
   radius 999, `color-mix(in srgb, var(--text) 12%, transparent)` fill and
   `--muted` text. Work waiting on the owner uses `--warning-soft` and
   `--warning-text`.
3. **Status pill or tag** (`.badge`): 11 px, padding 1 7, radius 999, 1 px
   border, tinted by the state map. A neutral tag uses `--border` and `--muted`.

### Panel and tray

![A side tray: a 44 px header, a 12 px body, and cards 8 px apart](images/tray.png)

A tray is a surface on a screen edge, such as Needs you, an agent or Chat
window, or the hosts list.

- **Header:** at least 44 px high, padding 0 12, 1 px `--border` underneath.
  From the left:
  1. `‹ Back`, on phones;
  2. the title, 14/700, with an optional inline count;
  3. compact quiet actions;
  4. close (×), on desktop.
- **Body:** scrolls, with padding 12 and cards 8 apart.
- **Footer** (optional, sticky): a `--border-soft` top edge, padding 8 12, and
  actions at the end.
- **Surface:** `--panel`, with a border on the inner edge only.
  - Over the view: `--shadow-lg`.
  - Docked beside the view: no shadow.
- **Side tray width:** `clamp(320px, 24vw, 360px)`.
- **Skin:** a tray takes the skin of its host view.
- **Closing:** Esc closes it on desktop.
- **Phone:** a tray is a full-screen sheet with `‹ Back` at the top left.
  Windows opened from it sit above it, and Back closes them first.

### Dialogs

Use `.modal` and `.modal-actions` from `base.css`:

- radius 16;
- 16 px title at 700;
- actions end-aligned and 8 apart, with the primary last.

On phones, dialog buttons are 44 px.

## Layout and phone rules

### Phone header

![Phone header: view name, Needs you with its count, Hosts, command menu and Menu; and a sheet header with Back](images/phone-header.png)

- **Bar:** 40 px plus the safe-area top, padding 6 10, gap 8. Sticky and
  opaque.
- **No second bar under the header.** Notices go to Needs you or a toast.
- **Left:** the view name, then the Needs you icon with its count badge. On a
  detail screen, `‹ Back` and the title instead.
- **Right:** icon buttons only, such as Hosts, the command menu and Menu. At
  most four icon buttons in the whole bar at 360 px.
- **Icon buttons:** 36 px drawn, 44 px hit area, radius 8, the
  `--topbar-control-*` tokens. When pressed or open: an `--accent` border and
  `--topbar-control-active-bg`.
- `‹ Back` is the only text button in the phone header.
- The header collapses while the keyboard is up for terminal input.

### Hit areas

On phones, every tappable thing has a 44 × 44 px hit area. That includes link
buttons, ⓘ, dock icons and header icons. A control drawn smaller extends its hit
area with a transparent pseudo-element (`::before { inset: -4px }` or more)
without moving its neighbours.

### Viewports

Check UI changes at the five
[screenshot viewports](../SCREENSHOTS.md#pr-screenshot-viewports): phone 390 × 844,
laptop 1512 × 982, half 1280 × 1440, wide 2560 × 1440 and portrait 1440 × 2560.

## Motion

- **Micro feedback** (hover, press, focus): 120–140 ms ease.
- **Entering surfaces** (tray, dialog, toast): 160–190 ms ease-out, with a
  small rise or slide.
- Nothing moves under `prefers-reduced-motion: reduce`.
- Town's sprites and scene animation follow the Town renderer's own frame rules.

## Accessibility

- Text contrast meets WCAG AA (4.5:1) against its surface in both themes and in
  the Town skin. `--muted` is for secondary text only.
  - Known gap: today `--muted` reaches only 3.7:1 on `--panel` in the dark
    theme and 3.4:1 in the light theme.
  - Light-theme `--accent` links on `--panel` reach 2.9:1.
  - A token fix waits for the owner's decision. Until then, don't use `--muted`
    for text a person must read to act.
- Every control has a visible `:focus-visible` style. Never set
  `outline: none` without a replacement ring.
- Icon-only buttons have an `aria-label`. Counts are part of the label
  ("Needs you, 2 waiting").
- State is never shown by colour alone.
- Hit areas are 44 px on phones, and live errors use `aria-live`.

## Dos and don'ts

| Don't | Do |
| --- | --- |
| Fill a button with solid `--accent` | Use the soft primary |
| Draw a new count-badge style | Use the one count badge |
| Put Dismiss or Chat in the input row | Keep only the submit button there |
| Hard-code Town colours in a component | Write it in shell tokens and let the skin re-map them |
| Use `var(--border, #343942)` | Use `var(--border)` |
| Use 10, 7 or 9 px text | Use 11 px or larger |
| Use a 28 px phone button | Use 44 px, or a 36 px button with a 44 px hit area |
| Add a bar under the header | Use Needs you or a toast |

![Don't: a solid accent fill. Do: the soft primary.](images/dont-primary.png)

![Don't: four count-badge styles. Do: one.](images/dont-badges.png)

![Don't: Dismiss in the input row.](images/dont-input.png)

## Checklist for a UI change

Before you ask for review:

- [ ] Colours come from the role tokens. No new hex values and no hex
      fallbacks.
- [ ] Spacing is from 2, 4, 6, 8, 10, 12, 16 or 24, and type is from 11, 12,
      13, 14, 16 or 20+, with weights 400, 600 or 700.
- [ ] Radii are 8 for controls, 12 for cards and 16 for dialogs, plus pills.
- [ ] Buttons use the five variants, with at most one primary, placed last.
- [ ] Cards follow header, body, answer zone, footer.
- [ ] Counts use the one count badge, and status uses the state map plus an
      icon or word.
- [ ] A surface over Town wears the Town skin.
- [ ] Phone: 44 px hit areas, Back at the top left, no new header bar.
- [ ] Focus is visible, icon buttons have labels, and the change honours
      reduced motion.
- [ ] Screenshots of what changed at the five viewports, synthetic data only.
