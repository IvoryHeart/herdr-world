# World Board element data

## Purpose

Board element kinds, their durable references and bounded reads.

## ADDED Requirements

### Requirement: Agent artefact elements

The registry SHALL include a placed `artefact` kind, added from an agent's
artefact rather than from a Board form. Its source SHALL hold the artefact
record's maker: the immutable connection ID, the creator room's workspace ID,
the pane ID and harness, plus the artefact kind and exactly one of an absolute
file path or a credential-free HTTP(S) URL. The source SHALL NOT keep a maker
name; Board SHALL show the maker World names now on that connection, or its
harness when that agent is gone. The maker reference SHALL NOT grant
authority. Its element ID SHALL be the artefact's ID so the same place is
added once.

An artefact file is the one Board source that MAY be absolute: it SHALL be read
with the saved connection and an explicit current generation through the same
Files seam and authority as the agent's Inspector, with the existing bounds,
refusals and no fallback. A path with control characters or `.`/`..` parts
SHALL be refused. Links SHALL be classified and never fetched. Board SHALL NOT
store artefact content.

An artefact file, text or not, SHALL offer Open in Files: World's Files viewer
in the Inspector of a live agent on the saved connection (the maker first,
then one in the creator room), never another connection's. Without a live
agent there it SHALL say so.

#### Scenario: The artefact file is deleted
- **WHEN** Board reads an artefact element whose file is gone
- **THEN** the read SHALL be unavailable without content or filesystem details

#### Scenario: A pinned image
- **WHEN** the owner opens a pinned PNG artefact on Board
- **THEN** Board SHALL say it shows only text and offer Open in Files, which shows the image

#### Scenario: A published pull request
- **WHEN** Board reads an artefact element with a GitHub pull request URL
- **THEN** it SHALL classify it as a pull request without fetching it
