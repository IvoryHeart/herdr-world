/** `herdr-world --skill`: the agent guide to the World CLI (cli/world.ts). */
export const WORLD_SKILL = `# herdr-world: change Herdr World from an agent

Herdr World shows your Herdr panes as Town desks and Board cards. These
commands let you arrange them, ask the owner questions and report results.
Run them inside your Herdr pane: World reads HERDR_PANE_ID and checks that
you really run in that pane. Without a pane, or in a pane World cannot
check, your changes are marked unverified. Board changes have history and
conditional undo. Groups keep the latest 128 changes with the sender claim
and its reported/inferred basis (unknown when absent), including deletion;
this recent attribution is not a complete audit and has no CLI undo.

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
    herdr-world pod create Chat
    herdr-world pod add Chat agent://connection-a/builder
    herdr-world pod reviewers Chat agent://connection-a/reviewer
    herdr-world pod now Chat "Review first" "Ship"
    herdr-world group list --kind room --json

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
         A withdrawn --wait returns withdrawn, not an invented answer;
         one the owner dismissed returns dismissed, and its --key stays
         closed, like an answered one, until you withdraw it.
         The service commits a question and its owner-alert intent to
         world.sqlite, then sends through the captured Herdr connection.
         JSON "recorded" says whether World kept it; "notified" carries
         Herdr's reply (null when a repeated cause sent no new alert).
         Exit 6 (not_delivered) keeps the ID: no alert is confirmed yet.
         "retrying": true means World scheduled a temporary-failure retry
         with backoff; don't add a retry loop. Closing the ask cancels it.
         If World could not record the question, the CLI still alerts via
         your Herdr, names the failure, and exits 1. A lost service reply
         can therefore produce a harmless duplicate owner alert.
         ask get ID --json exposes delivery evidence, including uncertain
         interrupted alerts. Retrieve answers with ask get or --wait.
         Automatic pane delivery without --wait is a planned follow-up;
         uncertain pane sends must never auto-replay.
  result --task ID "SUMMARY" [--pr N] [--status done|blocked|failed]
  result ls [--task ID]
  spawned-by PARENT_PANE   stamp your pane as spawned by PARENT_PANE
         (display-only Herdr pane metadata, so no --herdr)
  stamp CHILD_PANE PARENT_PANE
         the same stamp, written by a harness that started CHILD_PANE
  group create NAME --kind pod|team [--open-pr-limit N]
  group list [--kind pod|team|room|desk] [--json|--markdown] | group show GROUP
  group add GROUP AGENT [--role builder|lead|reviewer]
  group remove GROUP AGENT
  group lead GROUP AGENT | group reviewers GROUP [AGENT...]
  group now GROUP [ITEM...] | group delete GROUP --yes
  group import FILE --yes [--connection ID] [--mapping JSON]
         one-time Pod table import, no overwrite or file synchronization
         mapping is {"table name":"agent://CONNECTION/ENCODED_NAME"}
  group promote TEAM --name POD_NAME --mapping JSON
         complete explicit [{from:{connection_id,terminal_id},to:"agent://...",
         roles:["builder"]}] mapping, preserving the group ID
         pod/team aliases mean group with --kind pod/team

## Groups

Use a group ID or an unambiguous name. AGENT is an actual Herdr agent name,
agent://CONNECTION/ENCODED_NAME, pane:ID, terminal:ID or verified me. A Pod
keeps away addresses; duplicate live matches are ambiguous, never guessed.
Teams use terminal refs on one host. Rooms and desks are projected from
Herdr and never stored; create/delete/roles are refused (use Herdr's verbs).
Adding to a Room or Desk needs --herdr and one compatible current agent.
A Room add moves the WHOLE DESK: the CLI prints every affected agent before
acting. A Desk add moves one pane. --allow-close-room additionally consents
to closing the last desk's source room. The same Town move queue, generation
checks and observed Board following apply. Results say Done, Partly done,
Not done or Unknown with confirmed locations. Never automatically retry
Unknown. These moves cannot be undone by World.

Membership edits are available to agents. Setting or removing lead/reviewer
roles is owner/FirstMate-only by CREW RULE, including add/remove/promote.
World cannot authenticate that identity; sender claims do not authorize it.
Lead and builder together are exclusive to one Pod; reviewer may span Pods.
Transferring an exclusive role requires --replace --yes, never silently
displaces it, and preserves other roles. PR counts come from current source
links and the Pod's limit defaults to 2; excess is a warning, not a gate.
PR action verbs remain browser UI/RPC only.

For one-time migration, import a table with Pod, Lead, Builders, Reviewers and
optional Now columns. Names must resolve uniquely on the chosen connection;
map away or annotated names explicitly to agent:// addresses. The whole table
is atomic: missing/ambiguous names, role conflicts or existing Pod names refuse
it without partial edits. Limits: 48000 characters, 32 rows, existing member
and Now caps. Afterwards World owns the roster; export with group list --kind
pod --markdown. This is a human rendering, not a full Board backup or two-way
sync. Edit through the CLI; never reimport to update existing Pods.

The CLI never merges PRs or exposes PR actions. It does not directly delete
Herdr panes, tabs or workspaces; moving the last pane can close an empty tab
or, with explicit consent, its room.

## Reaching the owner

Use herdr-world ask from your own pane; no other channel. Ask, then move on
or --wait. Do not prompt the owner's seat, send Herdr custom notifications,
edit shared runbooks/configuration, or substitute issue comments for asking.
Your question waits at reception with ?, first in Town's Needs you list.
The owner answers there, or dismisses it without an answer; --wait hands
either back to your process. Ask through the service's own port, never a
dev proxy, or World cannot verify your pane.
Withdraw your own open ask once its cause clears.

## Output and exit codes

JSON when stdout is not a terminal, or with --json:
  {"ok":true,"actor":{...},"result":...}
  {"ok":false,"code":"refused","error":"..."}
Exit 0 ok, 1 failure or service unavailable, 2 usage, 3 refused, 4 not
found, 5 --wait timed out, 6 ask recorded but no one was alerted.

The CLI talks only to a World service on this machine (loopback), which it
finds from its service settings, with a CLI token derived from the service's
signing secret; that token cannot log a browser in. HERDR_WORLD_URL (a
loopback URL) and HERDR_WORLD_TOKEN reach another local instance.
`;
