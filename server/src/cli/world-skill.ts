/** `herdr-world --skill`: the agent guide to the World CLI (cli/world.ts). */
export const WORLD_SKILL = `# herdr-world: change Herdr World from an agent

Herdr World shows your Herdr panes as Town desks and Board cards. These
commands let you arrange them, ask the owner questions and report results.
Run them inside your Herdr pane: World reads HERDR_PANE_ID and checks that
you really run in that pane. Without a pane, or in a pane World cannot
check, your changes are marked unverified. Every change is recorded with
who made it, and World-side changes can be undone.

## Examples

    herdr-world whoami
    herdr-world ls --json
    herdr-world spawned-by w1:p3                  # the pane that started you
    herdr-world colour set me teal                # your tab's colour
    herdr-world colour reset workspace:w2
    herdr-world board card pin me 120,80          # pin your card at a point
    herdr-world board card move tab:w1:t2 --by=-40,0     # use = for negatives
    herdr-world board card unpin me
    herdr-world board card group me --with pane:w1:p3
    herdr-world board card ungroup me
    herdr-world town desk move me --onto tab:w1:t1 --herdr
    herdr-world ask "Ship the fix now?" --options yes,no --wait
    herdr-world ask "Which host?" --owner-only --wait --timeout 600
    herdr-world ask "Task 7 is stuck. What next?" --key task:7:stuck --owner-only
    herdr-world ask withdraw q-example
    herdr-world ask withdraw --key task:7:stuck
    herdr-world result --task FM-42 "Fixed the login race" --pr 12 --status done
    herdr-world history --actor w1:p2
    herdr-world undo c-lq3x9-4

## Targets

  me             your pane (and its tab, for cards and colours)
  pane:ID        a pane, e.g. pane:w1:p2
  tab:ID         a tab (a Town desk, a Board card), e.g. tab:w1:t2
  workspace:ID   a workspace (a Town room)

Targets are on your own host; add --connection ID for another one.

## Commands

  whoami | ls | history [--actor A] [--limit N] | undo CHANGE
  board card move TARGET --by DX,DY     nudge (a pinned card's pin moves)
  board card pin TARGET X,Y | unpin TARGET
  board card group TARGET --with TARGET | ungroup TARGET
  board card colour TARGET COLOUR|default
  colour set TARGET COLOUR | colour reset TARGET
         colours: red orange yellow green teal blue purple pink
  town desk move TARGET --onto TARGET|--last --herdr
         changes Herdr's tab order, so it needs --herdr; World cannot undo it
  ask "QUESTION" [--key CAUSE] [--options a,b,c] [--owner-only] [--wait [--timeout S]]
  ask get ID [--wait] | ask answer ID "ANSWER" | ask withdraw ID|--key CAUSE
         another verified agent may answer, never the asker; --owner-only
         questions are answered only by the owner in World
         --key deduplicates one cause for your verified occupant. Withdraw
         your own cause when it clears; repeats then may create a fresh ask.
         --key withdrawal recovers a lost ask ID without creating a question.
         A withdrawn --wait returns withdrawn, not an invented answer.
  result --task ID "SUMMARY" [--pr N] [--status done|blocked|failed]
  result ls [--task ID]
  spawned-by PARENT_PANE   stamp your pane as spawned by PARENT_PANE
         (display-only Herdr pane metadata, so no --herdr)
  stamp CHILD_PANE PARENT_PANE
         the same stamp, written by a harness that started CHILD_PANE

The CLI never merges, deletes panes, tabs or workspaces, or sends anything
outside World.

## Reaching the owner

Use herdr-world ask from your own pane; no other channel. Ask, then move on
or --wait. Do not prompt the owner's seat, send Herdr custom notifications,
edit shared runbooks/configuration, or substitute issue comments for asking.
Your question waits at reception with ?, first in Town's Needs you list.
The owner answers there; --wait hands that answer back to your process.
Withdraw your own open ask once its cause clears.

## Output and exit codes

JSON when stdout is not a terminal, or with --json:
  {"ok":true,"actor":{...},"result":...}
  {"ok":false,"code":"refused","error":"..."}
Exit 0 ok, 1 failure or service unavailable, 2 usage, 3 refused, 4 not
found, 5 --wait timed out.

The CLI talks only to a World service on this machine (loopback), which it
finds from its service settings, with a CLI token derived from the service's
signing secret; that token cannot log a browser in. HERDR_WORLD_URL (a
loopback URL) and HERDR_WORLD_TOKEN reach another local instance.
`;
