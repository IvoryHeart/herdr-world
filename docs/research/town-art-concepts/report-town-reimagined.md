# Town, reimagined: report

Three 2.5D art directions for the whole Town, each a live, animated page drawn in Canvas 2D with no generated images. Every direction has:

- a hero scene with Day / Dusk / Night and Clear / Rain / Snow toggles;
- a character sheet: four harnesses plus eight states (working, thinking, needs you, done, idle at the lounge, walking, on the bus, asleep);
- six close-ups;
- a night-in-the-rain scene;
- a phone frame you can drag;
- a "what's what" table.

## URLs

- Gallery: http://<host>:8811/
- Pop-Up: http://<host>:8811/paper/
- Lumen: http://<host>:8811/lumen/
- Cutaway: http://<host>:8811/cutaway/

The gallery is also reachable on the LAN at http://<host>:8811/.

- **Pop-Up in 3D (navigable prototype):** http://<host>:8811/paper-3d/

## Pop-Up in 3D: how navigation works

The whole papercraft town is a real three.js scene. three.js r134 (MIT) is vendored in `vendor/`, so nothing loads from a CDN at runtime; only the web fonts come from Google Fonts. It uses the same layout and cast as the Pop-Up stills.

- **Mouse:** drag to pan. Right-drag (or Shift-drag) turns and tilts. The scroll wheel zooms toward the cursor. Double-click dives in.
- **Trackpad:** pinch zooms, and a two-finger scroll pans. Shift-scroll turns. In Safari, the trackpad twist gesture turns the town too.
- **Touch:** one finger pans, pinch zooms, and twisting two fingers turns. Double-tap dives in.
- **Keys and buttons:** Q / E turn 90°, T cycles the tilt, R or ⌂ returns to the whole town, and arrows / WASD pan. The compass shows your heading and resets it when tapped. On-screen buttons cover turning, zoom and tilt.
- **Snapping:** turns ease to the nearest 45° when you let go, so you always land on a good isometric or straight-on view. The **snap** button switches to free orbit. Tilt is limited to 17°–75°, and panning stays on the book.
- **Readable at every angle:** agents, labels, the expenses easel, clouds and the sun are paper cards on stands that turn to face you and cast real shadows. Room plaques appear only when you're close. Cards and tags grow slightly as you zoom out so they stay legible.
- **Rooms stay open:** a tall wall or facade that stands between you and a room folds to ghost glass, so from any side you look into the rooms rather than at a back wall.
- **Themes:** **Paper day** (desk light and soft shadows), **Paper night** (moonlight, a reading lamp, lit rooms, glowing windows and lamps), and **Lumen skin**. Lumen restyles the same geometry: translucent glass with cyan edges, agents as light wisps, and amber beacons over waiting agents.

## The three directions

**1 · Pop-Up (papercraft diorama).** The town is a pop-up book open on your desk, and everything in it is cut, folded and glued by hand. Buildings are folded card. Rooms are open-top shoebox dioramas, so you look straight down into every desk. Agents are sticker cut-outs on fold stands. Questions fly to the post office as paper planes. The sea is a set of theatre wave strips, and a new host pops up off the page when you pull its tab. At night a reading lamp falls across the page and light glows through the paper. In 2026 everything on a screen is glossy and generated, so a world that looks handmade reads as warm and trustworthy. References: Tearaway, Lumino City, Paper Mario: The Origami King, Sabuda pop-up books, toy theatre.

**2 · Lumen (glass and light).** A town of clear glass on a round mirror disc floating in the dark. Every floor of a host's tower is visible through the walls: a busy floor glows in its project colour and an empty one is just an outline. Agents are wisps of light whose state is how they glow: a steady pulse when working, orbiting sparks when thinking, and a column of amber light when they need you, so a question is visible from across town. Amber arcs carry questions to a post office crowned with orbiting envelopes. The bus is a maglev circling the town hall, releases leave under sails of light, and a new host is printed by a beam from the sky. This is the material language of 2026 (frosted glass, depth, emissive light, dark-mode native), and it doubles as an ambient dashboard. References: Monument Valley, Townscaper at night, liquid-glass interfaces, Refik Anadol, TRON: Legacy.

**3 · Cutaway (clean-line cross-section).** The whole street is sliced open side-on, like a picture book, with mesas drifting by in parallax. Every room, desk and agent is in view at once. Reception is each building's ground floor, where waiting agents stand with speech balloons that contain the actual question. Pneumatic tubes under the street carry those questions to the post office. A new host arrives by airship, ships sit in lanes at three depths, and the lighthouse sweeps the town at night. This draws on the editorial-illustration revival and is the most legible of the three. On a phone it becomes a strip you scroll sideways, like reading a comic. References: Richard Scarry's Busytown, Hergé ligne claire, Moebius, Sable, Fallout Shelter.

## Notes

- The brief asked for 0.0.0.0:8811, but 127.0.0.1:8811 is already held by another agent's `town-next` preview (`herdr-world-town-next.service`). I didn't touch it. The gallery binds the Tailscale and LAN addresses on 8811 instead: same port, no conflict.
- Service: user unit `town-reimagined` (`~/.config/systemd/user/town-reimagined.service`), running `serve.py`, a small `python3 http.server` wrapper. It is started but **not enabled at boot**, because the permission check blocked `systemctl --user enable`. Run `systemctl --user enable town-reimagined` if it should survive a reboot.
- Files: `.agents/firstmate/art/town-reimagined/` (272 KB). There are no commits, pushes or PRs.
- All names are synthetic: hosts ATLAS, NIMBUS and pine; agents scout, wren, maple and others; projects world, crew and docs.

## Stop the server

```sh
systemctl --user stop town-reimagined
# to remove it entirely:
systemctl --user disable town-reimagined; rm ~/.config/systemd/user/town-reimagined.service; systemctl --user daemon-reload
```
