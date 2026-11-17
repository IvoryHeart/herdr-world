module herdr_core_seen {
  // Shared seen between World and another Herdr client for one core agent
  // (desktop app docs/labels.md, plan M9). World's browser decides when a
  // person looks; World's service writes `herdr.seen` to core. Core has no
  // compare-and-set (upstream Q7), so the service writes only while its
  // ordered observation still holds the label the browser decided on.
  //
  // FAULT selects one broken rule (negative controls; each must violate
  // safety): forget-look shares a turn on every refresh, hidden-look and
  // stale-look decide without a foreground page or a current host,
  // blind-write ignores the decided label and unchecked-write ignores both
  // the decided label and raise-only.
  pure val FAULT = "none"
  pure def fault(name) = FAULT == name
  pure val TURN_BOUND = 2
  // label/expect: -1 is a missing label. looked: the turn this look decided
  // on (-1 none). pending/expect: a write World decided and has not
  // dispatched, and the label it was decided on. unread: another client
  // marked the looked-at turn unread during this look. The remaining flags
  // record forbidden outcomes; refused and writes are for replay.
  type Seen = { turn: int, label: int, looking: bool, front: bool, stale: bool,
    looked: int, pending: int, expect: int, unread: bool, refused: bool,
    blind: bool, lowered: bool, overUnread: bool, hidden: bool, writes: int }
  var s: Seen
  var op: str
  action init = all {
    s' = { turn: 0, label: -1, looking: false, front: true, stale: false,
      looked: -1, pending: -1, expect: -1, unread: false, refused: false,
      blind: false, lowered: false, overUnread: false, hidden: false, writes: 0 },
    op' = "init",
  }
  action change(updated, name) = all { s' = { ...updated, refused: false }, op' = name }
  // Core: the agent leaves working and its turn rises.
  action endTurn = all { s.turn < TURN_BOUND,
    change({ ...s, turn: s.turn + 1, unread: false }, "endTurn") }
  // A World peek draws the agent, or stops drawing it: a look ends.
  action look = all { not(s.looking), change({ ...s, looking: true }, "look") }
  action leave = all { s.looking,
    change({ ...s, looking: false, looked: -1, unread: false }, "leave") }
  // The page leaves the foreground, ending the look, or comes back.
  action background = all { s.front,
    change({ ...s, front: false, looked: -1, unread: false }, "background") }
  action foreground = all { not(s.front), change({ ...s, front: true }, "foreground") }
  // The host stops or starts being current: the look goes on, deciding nothing.
  action flicker = change({ ...s, stale: not(s.stale) }, "flicker")
  // World's browser decides whenever its view updates: once per turn per look.
  action refresh = all {
    s.pending < 0,
    val active = s.looking and (s.front or fault("hidden-look")) and
      (not(s.stale) or fault("stale-look"))
    val decide = active and (s.looked != s.turn or fault("forget-look"))
    val write = decide and s.label < s.turn
    change({ ...s,
      looked: if (decide) s.turn else s.looked,
      pending: if (write) s.turn else -1,
      expect: if (write) s.label else -1,
      // An unread made during this look stands: World never decides over it.
      overUnread: s.overUnread or (write and s.unread),
      hidden: s.hidden or (write and not(s.looking and s.front and not(s.stale))) },
      "refresh"),
  }
  // World's service re-reads its observation, then writes only while the
  // label is the one decided on, only to raise and never past core's turn.
  action dispatch = all {
    s.pending >= 0,
    val matches = s.label == s.expect or fault("blind-write") or fault("unchecked-write")
    val raise = (s.pending > s.label or fault("unchecked-write")) and s.pending <= s.turn
    val ok = matches and raise
    all {
      s' = { ...s, pending: -1, expect: -1, refused: not(ok),
        label: if (ok) s.pending else s.label,
        blind: s.blind or (ok and s.label != s.expect),
        lowered: s.lowered or (ok and s.pending < s.label),
        writes: if (ok and s.writes < 2) s.writes + 1 else s.writes },
      op' = "dispatch",
    },
  }
  // Best effort: the write fails (core away, timeout) and is not retried.
  action lose = all { s.pending >= 0,
    change({ ...s, pending: -1, expect: -1 }, "lose") }
  // Another client marks a seen turn unread (turn - 1), or looks at it.
  action appUnread = all { s.turn > 0, s.label == s.turn,
    change({ ...s, label: s.turn - 1,
      unread: s.unread or s.looked == s.turn }, "appUnread") }
  action appSeen = all { s.label < s.turn,
    change({ ...s, label: s.turn, unread: false }, "appSeen") }
  action step = any { endTurn, look, leave, background, foreground, flicker,
    refresh, refresh, dispatch, dispatch, lose, appUnread, appSeen }
  val safety = s.label <= s.turn and not(s.blind) and not(s.lowered) and
    not(s.overUnread) and not(s.hidden)
  // Reachability witnesses for the sampled traces.
  val sharedTurn = op == "dispatch" and not(s.refused)
  val unreadKept = op == "refresh" and s.unread and s.looking and s.front and s.pending < 0
  val lookedAgain = s.writes >= 2
  val hiddenQuiet = op == "refresh" and s.looking and not(s.front) and s.label < s.turn
  val flickerQuiet = op == "refresh" and s.looking and s.front and s.stale and s.label < s.turn
  val refusedMoved = op == "dispatch" and s.refused
  val lostWrite = op == "lose"
}
