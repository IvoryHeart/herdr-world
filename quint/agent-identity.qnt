// Model for world-agent-identity: agents, terminals, conversations.
// Agents 1..3 start "free" (not yet issued). Terminal and conversation 0 mean none.
// The negative control sets BROKEN = true: a hand-started terminal running an
// away agent's conversation silently re-binds that agent.
module agent_identity {
  pure val BROKEN = false
  pure val AGENTS = Set(1, 2, 3)
  pure val TERMS = Set(1, 2, 3)
  pure val CONVS = Set(0, 1, 2)

  // Runtime truth, observed by World.
  var alive: int -> bool
  var occ: int -> bool
  var tconv: int -> int
  // World's records.
  var st: int -> str
  var seat: int -> int
  var conv: int -> int
  var offer: int -> int
  var how: int -> str
  var everEnded: int -> bool
  var listing: str
  // Ghosts: the previous step's seats and ends, and the last action.
  var prevSeat: int -> int
  var prevSt: int -> str
  var op: str

  def seated(t) = AGENTS.exists(a => st.get(a) != "free" and st.get(a) != "ended" and seat.get(a) == t)
  def held(a) = st.get(a) != "free" and st.get(a) != "ended"
  def conflicted(a) = conv.get(a) != 0 and AGENTS.exists(b => b != a and st.get(b) == "live" and conv.get(b) == conv.get(a))
  def canAct(a) = st.get(a) == "live" and listing == "complete" and conv.get(a) != 0 and not(conflicted(a))

  action world(s, se, c, o, h, e, l, name) = all {
    st' = s, seat' = se, conv' = c, offer' = o, how' = h, everEnded' = e, listing' = l,
    prevSeat' = seat, prevSt' = st, op' = name }
  action runtime(a2, o2, c2, name) = all {
    alive' = a2, occ' = o2, tconv' = c2,
    world(st, seat, conv, offer, how, everEnded, "stale", name) }
  action still = all { alive' = alive, occ' = occ, tconv' = tconv }

  // TLC needs `init` used only as the init, so scenarios start from `boot`,
  // the same state.
  action init = all {
    alive' = TERMS.mapBy(t => false), occ' = TERMS.mapBy(t => false), tconv' = TERMS.mapBy(t => 0),
    st' = AGENTS.mapBy(a => "free"), seat' = AGENTS.mapBy(a => 0), conv' = AGENTS.mapBy(a => 0),
    offer' = AGENTS.mapBy(a => 0), how' = AGENTS.mapBy(a => "none"), everEnded' = AGENTS.mapBy(a => false),
    listing' = "stale", prevSeat' = AGENTS.mapBy(a => 0), prevSt' = AGENTS.mapBy(a => "free"), op' = "init" }
  action boot = all {
    alive' = TERMS.mapBy(t => false), occ' = TERMS.mapBy(t => false), tconv' = TERMS.mapBy(t => 0),
    st' = AGENTS.mapBy(a => "free"), seat' = AGENTS.mapBy(a => 0), conv' = AGENTS.mapBy(a => 0),
    offer' = AGENTS.mapBy(a => 0), how' = AGENTS.mapBy(a => "none"), everEnded' = AGENTS.mapBy(a => false),
    listing' = "stale", prevSeat' = AGENTS.mapBy(a => 0), prevSt' = AGENTS.mapBy(a => "free"), op' = "init" }

  // Runtime events, by hand or by the runtime itself.
  action openTerminal(t) = all { not(alive.get(t)), runtime(alive.set(t, true), occ, tconv.set(t, 0), "openTerminal") }
  action startHarness(t, c) = all { alive.get(t), not(occ.get(t)), runtime(alive, occ.set(t, true), tconv.set(t, c), "startHarness") }
  action newConversation(t, c) = all { occ.get(t), runtime(alive, occ, tconv.set(t, c), "newConversation") }
  action exitHarness(t) = all { occ.get(t), runtime(alive, occ.set(t, false), tconv.set(t, 0), "exitHarness") }
  action closeTerminal(t) = all { alive.get(t), runtime(alive.set(t, false), occ.set(t, false), tconv.set(t, 0), "closeTerminal") }
  action runtimeRestart = runtime(TERMS.mapBy(t => false), TERMS.mapBy(t => false), TERMS.mapBy(t => 0), "runtimeRestart")

  // World restarts and observations.
  def unresolveAll = AGENTS.mapBy(a => if (held(a)) "unresolved" else st.get(a))
  action worldRestart = all { still, world(unresolveAll, seat, conv, offer, how, everEnded, "stale", "worldRestart") }
  action observePartial = all { still, world(unresolveAll, seat, conv, offer, how, everEnded, "partial", "observePartial") }
  action observeDuplicate(t) = all { still,
    world(AGENTS.mapBy(a => if (held(a) and seat.get(a) == t) "unresolved" else st.get(a)),
      seat, conv, offer, how, everEnded, "duplicate", "observeDuplicate") }
  action observeComplete = {
    def here(a) = held(a) and seat.get(a) != 0 and alive.get(seat.get(a)) and occ.get(seat.get(a))
    def gone(a) = held(a) and not(here(a))
    val s = AGENTS.mapBy(a => if (here(a)) "live" else if (gone(a)) (if (conv.get(a) != 0) "away" else "ended") else st.get(a))
    all { still, world(s,
      AGENTS.mapBy(a => if (gone(a)) 0 else seat.get(a)),
      AGENTS.mapBy(a => if (here(a)) tconv.get(seat.get(a)) else conv.get(a)),
      offer, AGENTS.mapBy(a => if (here(a)) "witness" else how.get(a)),
      AGENTS.mapBy(a => everEnded.get(a) or s.get(a) == "ended"), "complete", "observeComplete") }
  }
  // A newcomer in a complete listing gets a new agent, and an offer if an away agent ran its conversation.
  action admit(t) = {
    val c = tconv.get(t)
    val n = AGENTS.filter(m => st.get(m) == "free").fold(9, (x, y) => if (y < x) y else x)
    val owners = AGENTS.filter(o => st.get(o) == "away" and c != 0 and conv.get(o) == c)
    all { listing == "complete", alive.get(t), occ.get(t), not(seated(t)), still,
      if (BROKEN and owners.size() == 1) {
        val o = owners.fold(0, (x, y) => y)
        world(st.set(o, "live"), seat.set(o, t), conv, offer, how.set(o, "conversation"), everEnded, listing, "admit")
      } else all { n != 9,
        world(st.set(n, "live"), seat.set(n, t), conv.set(n, c),
          offer.set(n, if (owners.size() == 1) owners.fold(0, (x, y) => y) else 0),
          how.set(n, "new"), everEnded, listing, "admit") } }
  }

  // World's own results and the user's choices.
  action worldResume(a, t) = all { listing == "complete", st.get(a) == "away", conv.get(a) != 0,
    alive.get(t), not(occ.get(t)), not(seated(t)),
    alive' = alive, occ' = occ.set(t, true), tconv' = tconv.set(t, conv.get(a)),
    world(st.set(a, "live"), seat.set(a, t), conv, offer, how.set(a, "world"), everEnded, listing, "worldResume") }
  action worldMove(a, t) = all { canAct(a), alive.get(t), not(occ.get(t)), not(seated(t)),
    alive' = alive, occ' = occ.set(seat.get(a), false).set(t, true),
    tconv' = tconv.set(seat.get(a), 0).set(t, conv.get(a)),
    world(st, seat.set(a, t), conv, offer, how.set(a, "world"), everEnded, listing, "worldMove") }
  action userConfirm(n) = all { listing == "complete", st.get(n) == "live", offer.get(n) != 0,
    val o = offer.get(n)
    all { st.get(o) == "away", still,
    world(st.set(o, "live").set(n, "ended"), seat.set(o, seat.get(n)).set(n, 0), conv.set(o, conv.get(n)),
      offer.set(n, 0), how.set(o, "user"), everEnded.set(n, true), listing, "userConfirm") } }
  action userEnd(a) = all { held(a), still,
    world(st.set(a, "ended"), seat.set(a, 0), conv, offer, how, everEnded.set(a, true), listing, "userEnd") }

  action step = {
    nondet t = TERMS.oneOf()
    nondet c = CONVS.oneOf()
    nondet a = AGENTS.oneOf()
    any { openTerminal(t), startHarness(t, c), newConversation(t, c), exitHarness(t), closeTerminal(t),
      runtimeRestart, worldRestart, observePartial, observeDuplicate(t), observeComplete, admit(t),
      worldResume(a, t), worldMove(a, t), userConfirm(a), userEnd(a) }
  }

  // One agent per seat.
  val oneAgentPerSeat = AGENTS.forall(a => AGENTS.forall(b =>
    a == b or not(held(a) and held(b) and seat.get(a) != 0 and seat.get(a) == seat.get(b))))
  // A seat comes only from a witness, a newcomer, World's own result or the user.
  val seatOnlyByDeclaredPaths = AGENTS.forall(a => Set("none", "new", "witness", "world", "user").contains(how.get(a)))
  // A partial or duplicate listing binds, moves and ends nothing.
  val ambiguityBindsNothing = not(Set("observePartial", "observeDuplicate").contains(op)) or
    AGENTS.forall(a => seat.get(a) == prevSeat.get(a) and ((st.get(a) == "ended") == (prevSt.get(a) == "ended")))
  // An ended agent never returns.
  val endedNeverReturns = AGENTS.forall(a => not(everEnded.get(a)) or st.get(a) == "ended")
  // Only a live agent with a known, unconflicted conversation from a complete listing acts, and its record is true.
  val onlyAccurateActs = AGENTS.forall(a => not(canAct(a)) or
    (alive.get(seat.get(a)) and occ.get(seat.get(a)) and tconv.get(seat.get(a)) == conv.get(a)))
  val safety = oneAgentPerSeat and seatOnlyByDeclaredPaths and ambiguityBindsNothing and endedNeverReturns and onlyAccurateActs

  // Scenarios, checked with `quint test`.
  action seatOne = boot.then(openTerminal(1)).then(startHarness(1, 1)).then(observeComplete).then(admit(1))
  run renamedOrRestartedKeepsAgentTest = seatOne.then(worldRestart).then(observeComplete)
    .expect(st.get(1) == "live" and seat.get(1) == 1 and safety)
  run newConversationKeepsAgentTest = seatOne.then(newConversation(1, 2)).then(observeComplete)
    .expect(st.get(1) == "live" and conv.get(1) == 2 and st.get(2) == "free")
  run runtimeRestartThenWorldResumeTest = seatOne.then(runtimeRestart).then(observeComplete)
    .expect(st.get(1) == "away").then(openTerminal(2)).then(observeComplete).then(worldResume(1, 2))
    .expect(st.get(1) == "live" and seat.get(1) == 2 and how.get(1) == "world" and safety)
  run resumeByHandIsOfferedNotMergedTest = seatOne.then(closeTerminal(1)).then(openTerminal(2))
    .then(startHarness(2, 1)).then(observeComplete).then(admit(2))
    .expect(st.get(1) == "away" and st.get(2) == "live" and offer.get(2) == 1)
    .then(userConfirm(2))
    .expect(st.get(1) == "live" and seat.get(1) == 2 and how.get(1) == "user" and st.get(2) == "ended" and safety)
  run duplicateBindsNothingTest = seatOne.then(observeDuplicate(1))
    .expect(st.get(1) == "unresolved" and seat.get(1) == 1 and not(canAct(1)) and safety)
  run sameConversationTwiceConflictsTest = seatOne.then(openTerminal(2)).then(startHarness(2, 1))
    .then(observeComplete).then(admit(2))
    .expect(conflicted(1) and conflicted(2) and not(canAct(1)) and not(canAct(2)) and offer.get(2) == 0 and safety)
  run emptyConversationEndsOnCloseTest = boot.then(openTerminal(1)).then(startHarness(1, 0)).then(observeComplete)
    .then(admit(1)).then(closeTerminal(1)).then(observeComplete).then(openTerminal(1)).then(startHarness(1, 0))
    .then(observeComplete).then(admit(1))
    .expect(st.get(1) == "ended" and st.get(2) == "live" and safety)
}
