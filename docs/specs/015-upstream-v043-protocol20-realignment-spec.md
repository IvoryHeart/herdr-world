# Herdr Web v0.4.3 and Herdr protocol 20 realignment

- **Spec ID:** `015-upstream-v043-protocol20-realignment`
- **Status:** Approved
- **Created:** 2026-08-20
- **Owner:** Herdr Web compatibility / Herdr World downstream
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart
- **Approved at:** 2026-08-20

> This specification succeeds the completed Spec 013 synchronization slice; it
> does not rewrite that immutable protocol-19 delivery record. It addresses the
> compatibility change introduced after that work was approved.

## 1. Purpose

Herdr v0.8.2 is the current stable release and uses terminal protocol 20.
Herdr Web v0.4.3 and this downstream still require protocol 19, so both reject
the current stable daemon. Upstream Herdr Web issue
[#65](https://github.com/kcosr/herdr-web/issues/65) records the same failure.

At the same time, Herdr Web v0.4.2 and v0.4.3 added a supervised development
workflow, contribution policy, IME fixes, focus improvements, and optional
terminal screen-reader text after the downstream's last synchronization.

This specification defines one compatibility-first refresh. It upgrades the
narrow vendored wire/API slice to stable Herdr v0.8.2/protocol 20, adopts the
compatible Web changes as focused commits, and preserves downstream behavior.
It does not combine the refresh with package extraction or surface composition.

## 2. Audited baselines

| Project | Audited revision | Release/protocol |
| --- | --- | --- |
| Downstream Herdr World integration | `ad5fe9a` | based on Herdr Web v0.4.1-compatible code; Herdr v0.8.0/protocol 19 |
| Herdr Web upstream | `cff6335683acc20cbb76c24b67d03f9e75dd78e6` | post-v0.4.3 main; v0.4.3 release commit `5ad48ed42507dd0b50c07183cabdec8b391c2512` |
| Herdr stable | `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` | v0.8.2; protocol 20 |
| Herdr observed master | `ffc4e263168f9e81d5bbc14db4b16ca9818d684a` | observed 2026-08-20; not the vendoring baseline |

The implementation SHALL fetch both canonical upstreams again immediately
before work. If Herdr Web has already resolved issue #65 or released a newer
version, the implementation SHALL update this draft before approval or create
an extension after approval rather than silently competing with the upstream
fix.

## 3. Scope

This feature includes:

- updating the vendored Herdr compatibility source and metadata from v0.8.0 to
  v0.8.2;
- admitting exact terminal protocol 20 and rejecting protocol 19 or unknown
  future protocols with a clear error;
- handling every protocol-20 wire-shape change needed for safe decoding;
- retaining `ClientLaunchMode::TerminalAttach` for browser terminal sessions;
- defining safe behavior for terminal bell and direct-graphics-only messages;
- live bridge validation against an unmodified Herdr v0.8.2 daemon;
- replaying compatible Herdr Web v0.4.2/v0.4.3 changes with focused conflict
  review and regression tests;
- updating active compatibility, release, packaging, and vendoring docs; and
- coordinating the compatibility fix through Herdr Web issue #65 and its
  current contribution policy.

## 4. Non-goals

- No support for protocol 19 and 20 in one binary. That requires two deliberate
  codecs/clients and a separate compatibility specification.
- No protocol 21 speculation or support for Herdr master-only behavior.
- No direct Kitty graphics forwarding through the browser.
- No browser implementation of SGR pixel-coordinate mouse input.
- No private Herdr TUI UI behavior, Herdr core code change, or Herdr pull
  request.
- No generic extension registry, plugin discovery UI, surface composition,
  package extraction, provider refactor, or Office redesign.
- No unreviewed merge of upstream main into the downstream integration branch.

## 5. Protocol 20 delta

The vendored protocol representation SHALL include the complete v0.8.2 wire
shape, including:

- `PROTOCOL_VERSION = 20`;
- `ClientLaunchMode::AppDirectGraphics`, inserted before `TerminalAttach`;
- client messages `GraphicsTransmissionResult`, `InputPixels`, and
  `GraphicsTransmissionStarted`;
- `sgr_pixels` on `ServerMessage::MouseCapture`;
- server messages `TerminalBell`, `GraphicsFile`, and
  `GraphicsTransmissionRetired`; and
- the protocol-20 frozen input-envelope and round-trip fixtures.

The enum insertion changes bincode discriminants even for existing terminal
attach handshakes. Merely changing the version constant is therefore invalid.

## 6. Requirements

### Requirement: Vendor from the stable Herdr release reproducibly

The compatibility refresh SHALL copy only the bridge-required source from the
Herdr v0.8.2 release commit
`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`. The vendor manifest and refresh
documentation SHALL record the release tag, resolved commit, source paths,
local adaptations, copied-file hashes, license, and exact refresh command.

The implementation MUST compare the current compatibility tree with upstream
before copying so downstream-only API/schema additions are either justified
and retained or removed explicitly. It MUST NOT replace the narrow crate with
the whole Herdr repository.

#### Scenario: A reviewer repeats the vendor check

- **GIVEN** a clean Herdr v0.8.2 source checkout and this repository
- **WHEN** the documented vendor verification runs
- **THEN** every copied file and deliberate local adaptation is accounted for
  and no mutable remote input is required.

### Requirement: Admit only the implemented protocol

The bridge SHALL require a valid Herdr version of v0.8.2 or newer and an exact
daemon protocol value of 20. A v0.8.2 daemon reporting 20 SHALL be admitted. A
daemon reporting 19, 21, no protocol, or an invalid version SHALL fail before
terminal connection with a bounded diagnostic that names expected protocol 20
and the supported stable baseline.

A later Herdr version MAY be admitted while it continues to report protocol 20;
semantic compatibility outside the wire protocol remains covered by snapshot,
command, and live smoke tests.

#### Scenario: Current stable Herdr starts

- **GIVEN** an unmodified Herdr v0.8.2 daemon reporting protocol 20
- **WHEN** the bridge performs startup admission
- **THEN** it starts successfully and reports the updated compatibility in
  `/api/capabilities` and diagnostics.

#### Scenario: An old daemon remains running

- **GIVEN** a Herdr v0.8.0 daemon reporting protocol 19
- **WHEN** the updated bridge starts
- **THEN** it rejects the daemon before attach and tells the operator to update
  Herdr rather than attempting to decode both protocols.

### Requirement: Refresh the complete wire shape

The compatibility layer SHALL reproduce all protocol-20 enum variants, field
order, data types, framing bounds, round-trip tests, and frozen fixtures used by
the bridge. Exhaustive bridge matches SHALL be updated explicitly so a new
server message is not hidden by a wildcard arm.

Tests MUST prove that `TerminalAttach` serializes with its protocol-20
discriminant and that `MouseCapture` with `sgr_pixels` decodes without changing
the browser attach behavior.

#### Scenario: The version constant is changed alone

- **GIVEN** the vendored `PROTOCOL_VERSION` is 20 but `TerminalAttach` retains
  its protocol-19 enum layout
- **WHEN** frozen handshake fixtures run
- **THEN** validation fails before a malformed client can connect.

### Requirement: Keep browser terminals in terminal-attach mode

Browser terminal sockets SHALL continue to identify as
`ClientLaunchMode::TerminalAttach` with zero pixel cell dimensions. They MUST
NOT select `AppDirectGraphics`, read a Herdr-supplied graphics file path, write
Kitty commands to an outer terminal, or send graphics transmission results.

The bridge SHALL ignore `GraphicsFile` and `GraphicsTransmissionRetired` on a
terminal-attach connection and SHALL keep the socket open. On the first
occurrence of each unexpected message type in a connection, it SHALL emit
exactly one local warning and suppress later warnings of that type for the same
connection. The warning MUST contain only the message type and the fact that it
was ignored; it MUST NOT contain the path, control payload, image/transfer
identifiers, or any other message field. The bridge MUST NOT open, stat, expose,
log, or forward a supplied path or control payload, and it MUST NOT send a
browser message or a graphics transmission response.

#### Scenario: A direct graphics message reaches an attach test double

- **GIVEN** a test server sends repeated `GraphicsFile` and
  `GraphicsTransmissionRetired` messages to a browser terminal attach
- **WHEN** the bridge handles the message
- **THEN** no filesystem access or browser payload occurs, the socket remains
  usable, and each message type produces exactly one payload-free local warning
  for that connection.

### Requirement: Preserve terminal bell behavior safely

The bridge SHALL represent `ServerMessage::TerminalBell` through the existing
binary terminal-output path, not a new typed WebSocket event. It SHALL enqueue
`min(count, 16)` BEL (`0x07`) bytes as one bounded byte sequence. A zero count
enqueues nothing; counts from one through sixteen preserve their exact count;
larger counts are reduced to sixteen. The existing terminal-output coalescer
owns WebSocket frame boundaries and MAY concatenate the sequence with adjacent
ordinary terminal bytes. No dedicated-frame boundary is promised. The
coalescer MUST preserve the byte sequence's order relative to terminal output
received before and after the bell. The frontend SHALL feed the resulting byte
stream through the existing terminal renderer without a parallel bell protocol.

#### Scenario: Herdr reports three bells

- **GIVEN** an attached terminal receives `TerminalBell { count: 3 }`
- **WHEN** the bridge forwards terminal behavior
- **THEN** the browser terminal byte stream contains exactly three consecutive
  BEL bytes at the bell's ordered position and the terminal connection remains
  usable, regardless of WebSocket frame boundaries.

#### Scenario: Bell count is zero or excessive

- **GIVEN** attached terminals receive bell counts of zero and 65,535
- **WHEN** the bridge forwards terminal behavior
- **THEN** zero enqueues no bytes, 65,535 enqueues a sequence of sixteen BEL
  bytes, and neither case allocates in proportion to the input count or
  requires a dedicated WebSocket frame.

#### Scenario: Bells preserve order across coalescing modes

- **GIVEN** ordinary terminal bytes `A`, a two-count terminal bell, and ordinary
  terminal bytes `B` arrive in that order
- **WHEN** terminal output is exercised with coalescing enabled and disabled
- **THEN** the browser observes the byte sequence `A`, BEL, BEL, `B` in both
  modes, even though the enabled mode MAY deliver them in one combined frame.

### Requirement: Adopt upstream Web changes as focused units

The implementation SHALL review and replay the post-sync Herdr Web changes by
concern rather than merge the upstream tree over downstream work. At minimum it
SHALL assess:

- the supervised `npm run dev` workflow, static-asset cache policy, and tests;
- the focused `CONTRIBUTING.md` policy;
- desktop IME composition/cancellation/focus fixes;
- dialog/menu activation and focus restoration; and
- optional terminal screen-reader text and settings.

Each concern SHALL be marked `adopted`, `already-equivalent`, `conflicted`, or
`not-applicable` with a reason and source commit/PR. Adopted behavior SHALL keep
upstream authorship/provenance and its focused tests. Downstream CI, World
files, security policy, multi-bridge behavior, and accessibility tests MUST NOT
be deleted merely because they do not exist upstream.

#### Scenario: An upstream change overlaps World code

- **GIVEN** the v0.4.3 focus work and downstream Office both changed
  `App.tsx`
- **WHEN** the concern is replayed
- **THEN** the intended upstream focus behavior is reconstructed with its tests
  while existing World behavior is preserved and revalidated.

### Requirement: Validate the real supported combination

Acceptance SHALL include an unmodified Herdr v0.8.2 daemon, the updated bridge,
and the browser. Automated or recorded live tests SHALL cover startup,
capability probe, snapshot, event observation, command routing, terminal attach,
input, resize, scroll, detach/reattach, multiple terminals, and at least one
bell. Existing multi-bridge isolation tests SHALL run with protocol-20 fixtures.

Mocks alone do not prove compatibility. Test-only protocol fixtures MUST be
generated or verified against the v0.8.2 source shape and MUST not retain a
protocol-19 handshake by accident.

#### Scenario: Unit tests pass but the live daemon rejects attach

- **GIVEN** all local serializer tests pass
- **WHEN** the bridge is exercised against stock Herdr v0.8.2
- **THEN** the acceptance gate remains failed until the real startup and
  terminal path succeed.

### Requirement: Coordinate with Herdr Web upstream before proposing code

The project SHALL monitor issue #65 and search current Herdr Web main before
implementing or proposing the generic compatibility fix. If upstream publishes
the fix first, World SHALL adopt and validate that fix rather than submit a
duplicate. If the issue remains unresolved, any contribution SHALL be one
focused protocol-20 compatibility branch reconstructed from current upstream
main with tests and changelog, and SHALL follow `CONTRIBUTING.md`.

World-only surface, provider, packaging, CI, and art changes MUST NOT appear in
that branch. A downstream implementation MAY proceed after this spec is
approved, but opening an upstream pull request requires issue alignment and a
fresh check of upstream policy and state.

#### Scenario: Upstream merges protocol 20 while World is implementing

- **GIVEN** issue #65 is resolved by a new upstream commit
- **WHEN** the downstream branch is refreshed
- **THEN** the implementation adopts or rebases onto the upstream solution,
  records any remaining downstream delta, and does not open a competing PR.

### Requirement: Update all active compatibility documentation

After implementation, active setup, release, packaging, vendoring, tarball,
capability, and troubleshooting documentation SHALL consistently name Herdr
v0.8.2 or newer with exact protocol 20. `UPSTREAM.md` SHALL append a dated
audit with the exact Herdr and Herdr Web revisions and adopted commits.

Historical approved specs and implementation summaries, including Spec 013,
MUST remain unchanged and MAY continue to record protocol 19 as historical
fact.

#### Scenario: A user follows the packaged README

- **GIVEN** the protocol-20 bridge artifact
- **WHEN** the user follows its compatibility instructions
- **THEN** the instructions select a supported Herdr version and do not tell
  them to install the rejected protocol-19 baseline.

## 7. Privacy and security

- Direct-graphics file paths and control payloads MUST never reach browser
  output, logs, diagnostics, fixtures derived from a real workstation, or
  filesystem access in terminal-attach mode.
- Existing frame-size, terminal input, resize, scroll, upload, host/origin, and
  command allow-list bounds MUST remain enforced.
- Protocol errors MUST be bounded and MUST NOT echo terminal content or local
  socket paths to the browser.
- Upstream replay MUST retain provenance and MUST not overwrite downstream
  security/CI controls through a bulk merge.

## 8. Acceptance evidence

The implementation summary SHALL include:

- fetched upstream heads and the selected immutable release commits;
- the vendor manifest/diff and protocol-20 frozen fixtures;
- tests for every new enum/field and exhaustive bridge handling;
- explicit direct-graphics exclusion plus bell count/order tests with ordinary
  output before and after bells and coalescing enabled and disabled;
- stock Herdr v0.8.2 live bridge/browser evidence;
- multi-bridge and terminal regression results;
- a per-concern v0.4.2/v0.4.3 adoption matrix with source attribution;
- current issue #65/upstream disposition;
- updated active documentation and a scan proving stale protocol-19
  instructions remain only in historical records; and
- the full repository check required by the resulting code changes.

## 9. Deferred decisions

- Multi-protocol codecs or a compatibility proxy for protocol 19.
- Browser direct graphics and SGR pixel-coordinate input.
- Replacing the private compatibility client with Herdr's public terminal
  session observe/control facade; Spec 010 requires that later comparison.
- Protocol or API work beyond stable Herdr v0.8.2.
