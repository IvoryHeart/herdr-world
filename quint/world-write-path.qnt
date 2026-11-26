// World write path (openspec world-one-object): one fact, its source of
// record, World, and two browsers that change it. Each browser has one
// replica every view in it draws from (Town and Board share pending values).
// A view sends a command; World admits it and sends it to the source; the
// source applies or refuses it; World learns the value only by observing the
// source. Observations, acknowledgements, source events and World pushes can
// be late. Someone can also change the source directly, and the host can go
// offline, and World can restart. FENCED = false is the negative control:
// World applies any late observation, takes an acknowledgement as the value,
// and views take any push. CAS = false is the compare-and-set control: World
// sends a command whose expected value is not World's current one.
// The adapter (world-write-path.ts) replays the scenarios below through the
// real WorldSnapshotService fence, WorldCommands and the browser replica.
module world_write_path {
  pure val FENCED = true
  pure val CAS = true
  pure val MAXRESTART = 1
  // The views inside one browser; all draw from its replica.
  pure val SCREENS = Set("town", "board")
  pure val VIEWS = Set(1, 2)
  pure val VALS = Set(1, 2, 3)
  pure val MAXSEQ = 4
  pure val MAXREAD = 6

  type Read = { n: int, e: int, s: int }
  type Push = { rev: int, v: int }

  // The source of record: its value, version and history of values.
  var src: int
  var seq: int
  var hist: int -> int
  var online: bool
  // Source events not yet delivered to World.
  var events: int
  // World: its write epoch, reads in flight, the newest read applied.
  var epoch: int
  var nextRead: int
  var reads: Set[Read]
  var lastRead: int
  var changeMark: int
  var wv: int
  var ws: int
  var wrev: int
  var stale: bool
  var pub: Set[Push]
  // Each view's World copy and its one command.
  var vrev: int -> int
  var vval: int -> int
  var cst: int -> str
  var cval: int -> int
  var cseq: int -> int
  var cmark: int -> int
  // The World revision that carries the command's observed outcome (0: none to wait for).
  var crev: int -> int
  // Which in-flight command is newer (2) when both are in flight.
  var cord: int -> int
  var restarts: int
  // Ghosts.
  var prevWs: int
  var prevVrev: int -> int
  var prevShows: int -> int
  var prevCurrent: int
  var op: str

  def unresolved(v) = Set("sent", "done", "applied").contains(cst.get(v))
  // The outcome travels in a World revision: the asking view keeps its pending
  // value until its copy reaches that revision, so it never flashes the old value.
  def awaitingOutcome(v) = cst.get(v) == "observed" and vrev.get(v) < crev.get(v)
  // What a view draws: its own pending command's value, else its World copy.
  def shows(v) = if (unresolved(v) or awaitingOutcome(v)) cval.get(v) else vval.get(v)
  // Every view in a browser draws the same replica: no view keeps its own copy.
  def draws(v, screen) = if (SCREENS.contains(screen)) shows(v) else vval.get(v)
  // Compare-and-set target: the newest command in flight, else World's value.
  def current = VIEWS.fold((0, wv), (acc, u) =>
    if (unresolved(u) and cord.get(u) > acc._1) (cord.get(u), cval.get(u)) else acc)._2
  // The outcome reached the browser: it holds the revision that carries it.
  def delivered(v) = cst.get(v) == "observed" and vrev.get(v) >= crev.get(v)

  action init = all {
    src' = 1, seq' = 1, hist' = Map(1 -> 1), online' = true, events' = 0,
    epoch' = 0, nextRead' = 1, reads' = Set(), lastRead' = 0, changeMark' = 1,
    wv' = 1, ws' = 1, wrev' = 1, stale' = false, pub' = Set({ rev: 1, v: 1 }),
    vrev' = VIEWS.mapBy(v => 1), vval' = VIEWS.mapBy(v => 1),
    cst' = VIEWS.mapBy(v => "none"), cval' = VIEWS.mapBy(v => 0),
    cseq' = VIEWS.mapBy(v => 0), cmark' = VIEWS.mapBy(v => 0), crev' = VIEWS.mapBy(v => 0),
    cord' = VIEWS.mapBy(v => 0), restarts' = 0,
    prevWs' = 1, prevVrev' = VIEWS.mapBy(v => 1), prevShows' = VIEWS.mapBy(v => 1), prevCurrent' = 1, op' = "init" }

  action keepSource = all { src' = src, seq' = seq, hist' = hist, online' = online }
  action keepWorld = all { epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead,
    changeMark' = changeMark, wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts }
  action keepViews = all { vrev' = vrev, vval' = vval }
  action keepCmds = all { cst' = cst, cval' = cval, cseq' = cseq, cmark' = cmark, crev' = crev, cord' = cord }
  action ghost(name) = all { prevWs' = ws, prevVrev' = vrev, prevShows' = VIEWS.mapBy(v => shows(v)),
    prevCurrent' = current, op' = name }

  // A browser asks World to change the fact, naming the value it shows. World
  // refuses at once, sending nothing, when offline or when that value is not
  // World's current one (compare-and-set).
  action issue(v, x) = all { not(unresolved(v)), x != shows(v),
    val admitted = online and (not(CAS) or shows(v) == current)
    all {
      cst' = cst.set(v, if (admitted) "sent" else "refused"), cval' = cval.set(v, x),
      cseq' = cseq.set(v, 0), cmark' = cmark, crev' = crev.set(v, 0),
      cord' = if (admitted) VIEWS.mapBy(u => if (u == v) 2 else 1) else cord,
      keepSource, keepWorld, keepViews, events' = events, ghost("issue") } }

  // The source applies the command and emits its own change event.
  action sourceApply(v) = all { cst.get(v) == "sent", online, seq < MAXSEQ,
    src' = cval.get(v), seq' = seq + 1, hist' = hist.put(seq + 1, cval.get(v)), online' = online,
    events' = events + 1, cst' = cst.set(v, "done"), cval' = cval, cseq' = cseq.set(v, seq + 1), cmark' = cmark, crev' = crev,
    cord' = cord, restarts' = restarts,
    epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, keepViews, ghost("sourceApply") }
  // A command World lost in a restart may still reach the source.
  action sourceApplyLost(v) = all { cst.get(v) == "lost", cseq.get(v) == 0, online, seq < MAXSEQ,
    src' = cval.get(v), seq' = seq + 1, hist' = hist.put(seq + 1, cval.get(v)), online' = online,
    events' = events + 1, cst' = cst, cval' = cval, cseq' = cseq.set(v, seq + 1), cmark' = cmark, crev' = crev,
    cord' = cord, restarts' = restarts,
    epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, keepViews, ghost("sourceApplyLost") }
  action sourceRefuse(v) = all { cst.get(v) == "sent", online,
    cst' = cst.set(v, "refused"), cval' = cval, cseq' = cseq, cmark' = cmark, crev' = crev, cord' = cord,
    keepSource, keepWorld, keepViews, events' = events, ghost("sourceRefuse") }

  // The acknowledgement resolves nothing by itself: World re-reads (epoch + 1)
  // and the command waits for a read that started after it. The broken World
  // takes the acknowledged value as its own.
  action ack(v) = all { cst.get(v) == "done", online,
    cst' = cst.set(v, "applied"), cval' = cval, cseq' = cseq, cmark' = cmark.set(v, nextRead), crev' = crev,
    cord' = cord, restarts' = restarts,
    keepSource, events' = events, keepViews,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = changeMark,
    stale' = stale,
    if (FENCED) all { wv' = wv, ws' = ws, wrev' = wrev, pub' = pub }
    else all { wv' = cval.get(v), ws' = cseq.get(v), wrev' = wrev + 1,
      pub' = pub.union(Set({ rev: wrev + 1, v: cval.get(v) })) },
    ghost("ack") }

  // Someone changes the source directly (a rename in the runtime's own UI).
  // While offline, its event never reaches World.
  action externalWrite(x) = all { seq < MAXSEQ, x != src,
    src' = x, seq' = seq + 1, hist' = hist.put(seq + 1, x), online' = online,
    events' = if (online) events + 1 else events,
    epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts,
    keepViews, keepCmds, ghost("externalWrite") }
  action deliverEvent = all { events > 0, online, events' = events - 1,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts,
    keepSource, keepViews, keepCmds, ghost("deliverEvent") }

  // Observation: a read captures the source as it is when it starts.
  action startRead = all { online, nextRead < MAXREAD,
    reads' = reads.union(Set({ n: nextRead, e: epoch, s: seq })), nextRead' = nextRead + 1,
    epoch' = epoch, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts,
    keepSource, events' = events, keepViews, keepCmds, ghost("startRead") }
  // A read is applied only if it started after the newest applied read and in
  // the current epoch (no command result or source event since it started).
  // A pending command it settles records the revision that carries the
  // outcome; a settle always publishes, even when the value is unchanged, so
  // the asking browser learns the outcome. The broken World marks the command
  // done without naming a revision, so the view drops its pending value before
  // it has the new one.
  action applyRead(r) = all { reads.contains(r), online,
    val ok = not(FENCED) or (r.n > lastRead and r.e == epoch)
    val x = hist.get(r.s)
    val changed = ok and x != wv
    val settles = VIEWS.filter(v => ok and Set("applied", "uncertain").contains(cst.get(v)) and r.n >= cmark.get(v))
    val bump = changed or settles.size() > 0
    all {
      reads' = reads.exclude(Set(r)), nextRead' = nextRead, epoch' = epoch, changeMark' = changeMark,
      lastRead' = if (ok) r.n else lastRead,
      wv' = if (ok) x else wv, ws' = if (ok) r.s else ws,
      wrev' = if (bump) wrev + 1 else wrev,
      pub' = if (bump) pub.union(Set({ rev: wrev + 1, v: if (ok) x else wv })) else pub,
      stale' = if (ok) false else stale,
      cst' = VIEWS.mapBy(v => if (settles.contains(v)) "observed" else cst.get(v)),
      crev' = VIEWS.mapBy(v => if (FENCED and settles.contains(v) and cst.get(v) == "applied")
        wrev + 1 else if (settles.contains(v)) 0 else crev.get(v)),
      cval' = cval, cseq' = cseq, cmark' = cmark, cord' = cord, restarts' = restarts,
      keepSource, events' = events, keepViews, ghost("applyRead") } }
  action dropRead(r) = all { reads.contains(r), reads' = reads.exclude(Set(r)),
    nextRead' = nextRead, epoch' = epoch, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts,
    keepSource, events' = events, keepViews, keepCmds, ghost("dropRead") }

  // The host goes offline: reads fail, World's copy is stale, unacknowledged
  // commands become uncertain until an observation after reconnection. On
  // reconnection World must read again before anything counts as settled.
  action goOffline = all { online,
    src' = src, seq' = seq, hist' = hist, online' = false, events' = 0,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = Set(), lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = true, pub' = pub,
    cst' = VIEWS.mapBy(v => if (unresolved(v)) "uncertain" else cst.get(v)),
    cval' = cval, cseq' = VIEWS.mapBy(v => if (cst.get(v) == "sent") 0 else cseq.get(v)),
    cmark' = VIEWS.mapBy(v => if (unresolved(v)) nextRead else cmark.get(v)), crev' = crev,
    cord' = cord, restarts' = restarts, keepViews, ghost("goOffline") }
  action goOnline = all { not(online),
    src' = src, seq' = seq, hist' = hist, online' = true, events' = 0,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, restarts' = restarts,
    keepViews, keepCmds, ghost("goOnline") }

  // World restarts: its reads and source events in flight are gone, and its
  // commands in flight are lost: World recorded each when it accepted it, and
  // the new World settles that record as uncertain. Each browser sees the new
  // service and drops its pending values (the outcome is unknown; the person
  // is told to look again). World must read the
  // source again before anything is settled. Revisions stay ordered across the
  // restart (the replica orders by service incarnation, then revision).
  action restart = all { restarts < MAXRESTART,
    src' = src, seq' = seq, hist' = hist, online' = online, events' = 0,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = Set(), lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = true, pub' = pub, restarts' = restarts + 1,
    cst' = VIEWS.mapBy(v => if (unresolved(v) or awaitingOutcome(v)) "lost" else cst.get(v)),
    cval' = cval, cseq' = cseq, cmark' = cmark, crev' = crev, cord' = cord,
    keepViews, ghost("restart") }

  // A view takes a World push; pushes can arrive late and out of order.
  action adopt(v, p) = all { pub.contains(p), not(FENCED) or p.rev > vrev.get(v),
    vrev' = vrev.set(v, p.rev), vval' = vval.set(v, p.v),
    keepSource, events' = events, keepWorld, keepCmds, ghost("adopt") }

  action step = {
    nondet v = VIEWS.oneOf()
    nondet x = VALS.oneOf()
    any {
      issue(v, x), sourceApply(v), sourceApplyLost(v), sourceRefuse(v), ack(v), externalWrite(x), deliverEvent,
      startRead, goOffline, goOnline, restart,
      if (reads.size() > 0) { nondet r = reads.oneOf() any { applyRead(r), dropRead(r) } } else startRead,
      if (pub.size() > 0) { nondet p = pub.oneOf() adopt(v, p) } else startRead,
    }
  }

  // World's value is one the source really held, and never goes back in time.
  val worldTruthful = hist.get(ws) == wv
  val worldMonotonic = ws >= prevWs
  // A view's copy is one World published, and never goes back in time.
  val viewsMonotonic = VIEWS.forall(v => vrev.get(v) >= prevVrev.get(v) and pub.contains({ rev: vrev.get(v), v: vval.get(v) }))
  // A confirmed command is never undone by a late observation.
  val confirmedStays = VIEWS.forall(v => cst.get(v) != "observed" or cseq.get(v) == 0 or ws >= cseq.get(v))
  // Settling a command never makes a view show anything but World's current
  // value: a requested value that World now holds never flashes back to the old one.
  val noFlashBack = op != "applyRead" or VIEWS.forall(v => shows(v) == prevShows.get(v) or shows(v) == wv)
  // Nothing is sent to an offline source; a refused command never shows its value.
  val offlineRefuses = op != "issue" or online or VIEWS.forall(v => cst.get(v) != "sent")
  // Compare-and-set: World sends a command only over the value it currently
  // holds or has in flight, never over one the browser saw before a change.
  val sendsOverCurrent = op != "issue" or VIEWS.forall(v =>
    // The issuing browser is the one whose shown value changed.
    cst.get(v) != "sent" or prevShows.get(v) == shows(v) or prevShows.get(v) == prevCurrent)
  // A restart drops every pending value: each view shows its World copy.
  val restartDropsPending = op != "restart" or VIEWS.forall(v => shows(v) == vval.get(v))
  // Settled: online, nothing in flight, and World read the source after its last change.
  def settled = online and events == 0 and reads.size() == 0 and lastRead >= changeMark and
    VIEWS.forall(v => not(unresolved(v)) and vrev.get(v) == wrev)
  val settledConverges = not(settled) or (wv == src and not(stale) and VIEWS.forall(v => shows(v) == src))
  val safety = worldTruthful and worldMonotonic and viewsMonotonic and confirmedStays and noFlashBack and offlineRefuses and
    sendsOverCurrent and restartDropsPending and settledConverges

  // Scenarios, checked with `quint test`.
  action catchUp = adopt(1, { rev: wrev, v: wv }).then(adopt(2, { rev: wrev, v: wv }))
  // A read that started before a command's result is never applied over it.
  run lateReadIsDiscardedTest = init.then(startRead).then(issue(1, 2)).then(sourceApply(1)).then(deliverEvent)
    .then(ack(1)).expect(shows(1) == 2 and shows(2) == 1)
    .then(applyRead({ n: 1, e: 0, s: 1 }))
    .expect(lastRead == 0 and wrev == 1 and cst.get(1) == "applied" and shows(1) == 2 and safety)
    .then(startRead).then(applyRead({ n: 2, e: 2, s: 2 }))
    .expect(wv == 2 and cst.get(1) == "observed" and shows(1) == 2 and shows(2) == 1).then(catchUp)
    .expect(shows(1) == 2 and shows(2) == 2 and safety)
  // A change made at the source after a view's command wins in every view.
  run sourceChangeAfterCommandWinsTest = init.then(issue(1, 2)).then(sourceApply(1)).then(deliverEvent)
    .then(ack(1)).then(externalWrite(3)).then(deliverEvent).then(startRead)
    .then(applyRead({ n: 1, e: 3, s: 3 })).then(catchUp)
    .expect(wv == 3 and cst.get(1) == "observed" and shows(1) == 3 and shows(2) == 3 and safety)
  // A refusal shows the World value again at once.
  run refusalRestoresTest = init.then(issue(2, 3)).then(sourceRefuse(2))
    .expect(cst.get(2) == "refused" and shows(2) == 1 and safety)
  // Offline: the copy is stale, a new command is refused, an unacknowledged one is uncertain
  // until the first observation after reconnection settles it.
  run offlineTest = init.then(issue(1, 2)).then(sourceApply(1)).then(goOffline)
    .expect(stale and cst.get(1) == "uncertain" and shows(1) == 1)
    .then(issue(2, 3)).expect(cst.get(2) == "refused")
    .then(goOnline).then(startRead).then(applyRead({ n: 1, e: 2, s: 2 })).then(catchUp)
    .expect(not(stale) and wv == 2 and cst.get(1) == "observed" and shows(2) == 2 and safety)
  // A settled command keeps showing its value until the view has World's new revision.
  run observedHoldsUntilAdoptedTest = init.then(issue(1, 2)).then(sourceApply(1)).then(ack(1))
    .then(startRead).then(applyRead({ n: 1, e: 1, s: 2 }))
    .expect(cst.get(1) == "observed" and wv == 2 and crev.get(1) == 2 and vrev.get(1) == 1 and vval.get(1) == 1
      and shows(1) == 2 and shows(2) == 1 and safety)
    .then(adopt(1, { rev: 2, v: 2 })).expect(shows(1) == 2 and safety)
    .then(adopt(2, { rev: 2, v: 2 })).expect(shows(2) == 2 and safety)
  // Compare-and-set: a browser that has not seen the newest value is refused
  // and nothing is sent; once it has, its change goes through and both end
  // on the value the source holds.
  run compareAndSetTest = init.then(issue(1, 2)).then(issue(2, 3))
    .expect(cst.get(1) == "sent" and cst.get(2) == "refused" and shows(2) == 1 and safety)
    .then(sourceApply(1)).then(deliverEvent).then(ack(1)).then(startRead).then(applyRead({ n: 1, e: 2, s: 2 }))
    .then(catchUp).then(issue(2, 3)).expect(cst.get(2) == "sent" and safety)
    .then(sourceApply(2)).then(deliverEvent).then(ack(2)).then(startRead).then(applyRead({ n: 2, e: 4, s: 3 }))
    .then(catchUp).expect(src == 3 and wv == 3 and shows(1) == 3 and shows(2) == 3 and settled and safety)
  // The outcome is delivered when the final value is unchanged: someone put
  // the old value back before World read the source. The settle still
  // publishes a revision, and the browser learns the outcome from it.
  run outcomeWhenValueUnchangedTest = init.then(issue(1, 2)).then(sourceApply(1)).then(deliverEvent).then(ack(1))
    .then(externalWrite(1)).then(deliverEvent).then(startRead).then(applyRead({ n: 1, e: 3, s: 3 }))
    .expect(wv == 1 and wrev == 2 and cst.get(1) == "observed" and crev.get(1) == 2 and not(delivered(1))
      and shows(1) == 2 and safety)
    .then(adopt(1, { rev: 2, v: 1 })).expect(delivered(1) and shows(1) == 1 and safety)
  // Pending values are shared within one browser: every view in the asking
  // browser shows the pending value; the other browser keeps World's value.
  run pendingSharedInBrowserTest = init.then(issue(1, 2))
    .expect(draws(1, "town") == 2 and draws(1, "board") == 2 and draws(2, "town") == 1 and draws(2, "board") == 1)
    .then(sourceApply(1)).then(ack(1)).then(startRead).then(applyRead({ n: 1, e: 1, s: 2 }))
    .expect(draws(1, "town") == 2 and draws(1, "board") == 2 and safety)
    .then(catchUp).expect(SCREENS.forall(screen => draws(1, screen) == 2 and draws(2, screen) == 2) and safety)
  // Recovery after a restart: the pending value is dropped (outcome unknown),
  // the lost command may still land, and World reads the source again before
  // anything is settled; both browsers end on the source's value.
  run restartRecoveryTest = init.then(issue(1, 2)).then(restart)
    .expect(cst.get(1) == "lost" and shows(1) == 1 and stale and not(settled) and safety)
    .then(sourceApplyLost(1)).then(deliverEvent).then(startRead).then(applyRead({ n: 1, e: 2, s: 2 }))
    .then(catchUp).expect(not(stale) and wv == 2 and shows(1) == 2 and shows(2) == 2 and settled and safety)
}
