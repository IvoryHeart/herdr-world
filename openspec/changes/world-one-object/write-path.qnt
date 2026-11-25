// Design-stage model for world-one-object: one fact, its source of record,
// World, and two views that change it.
// A view sends a command; World admits it and sends it to the source; the
// source applies or refuses it; World learns the value only by observing the
// source. Observations, acknowledgements, source events and World pushes can
// be late. Someone can also change the source directly, and the host can go
// offline. FENCED = false is the negative control: World applies any late
// observation, takes an acknowledgement as the value, and views take any push.
module world_write_path {
  pure val FENCED = true
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
  // Ghosts.
  var prevWs: int
  var prevVrev: int -> int
  var prevShows: int -> int
  var op: str

  def unresolved(v) = Set("sent", "done", "applied").contains(cst.get(v))
  // The outcome travels in a World revision: the asking view keeps its pending
  // value until its copy reaches that revision, so it never flashes the old value.
  def awaitingOutcome(v) = cst.get(v) == "observed" and vrev.get(v) < crev.get(v)
  // What a view draws: its own pending command's value, else its World copy.
  def shows(v) = if (unresolved(v) or awaitingOutcome(v)) cval.get(v) else vval.get(v)

  action init = all {
    src' = 1, seq' = 1, hist' = Map(1 -> 1), online' = true, events' = 0,
    epoch' = 0, nextRead' = 1, reads' = Set(), lastRead' = 0, changeMark' = 1,
    wv' = 1, ws' = 1, wrev' = 1, stale' = false, pub' = Set({ rev: 1, v: 1 }),
    vrev' = VIEWS.mapBy(v => 1), vval' = VIEWS.mapBy(v => 1),
    cst' = VIEWS.mapBy(v => "none"), cval' = VIEWS.mapBy(v => 0),
    cseq' = VIEWS.mapBy(v => 0), cmark' = VIEWS.mapBy(v => 0), crev' = VIEWS.mapBy(v => 0),
    prevWs' = 1, prevVrev' = VIEWS.mapBy(v => 1), prevShows' = VIEWS.mapBy(v => 1), op' = "init" }

  action keepSource = all { src' = src, seq' = seq, hist' = hist, online' = online }
  action keepWorld = all { epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead,
    changeMark' = changeMark, wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub }
  action keepViews = all { vrev' = vrev, vval' = vval }
  action keepCmds = all { cst' = cst, cval' = cval, cseq' = cseq, cmark' = cmark, crev' = crev }
  action ghost(name) = all { prevWs' = ws, prevVrev' = vrev, prevShows' = VIEWS.mapBy(v => shows(v)), op' = name }

  // A view asks World to change the fact. Offline: refused at once, nothing is sent.
  action issue(v, x) = all { not(unresolved(v)), x != shows(v),
    cst' = cst.set(v, if (online) "sent" else "refused"), cval' = cval.set(v, x),
    cseq' = cseq.set(v, 0), cmark' = cmark, crev' = crev.set(v, 0),
    keepSource, keepWorld, keepViews, events' = events, ghost("issue") }

  // The source applies the command and emits its own change event.
  action sourceApply(v) = all { cst.get(v) == "sent", online, seq < MAXSEQ,
    src' = cval.get(v), seq' = seq + 1, hist' = hist.put(seq + 1, cval.get(v)), online' = online,
    events' = events + 1, cst' = cst.set(v, "done"), cval' = cval, cseq' = cseq.set(v, seq + 1), cmark' = cmark, crev' = crev,
    epoch' = epoch, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, keepViews, ghost("sourceApply") }
  action sourceRefuse(v) = all { cst.get(v) == "sent", online,
    cst' = cst.set(v, "refused"), cval' = cval, cseq' = cseq, cmark' = cmark, crev' = crev,
    keepSource, keepWorld, keepViews, events' = events, ghost("sourceRefuse") }

  // The acknowledgement resolves nothing by itself: World re-reads (epoch + 1)
  // and the command waits for a read that started after it. The broken World
  // takes the acknowledged value as its own.
  action ack(v) = all { cst.get(v) == "done", online,
    cst' = cst.set(v, "applied"), cval' = cval, cseq' = cseq, cmark' = cmark.set(v, nextRead), crev' = crev,
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
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub, keepViews, keepCmds, ghost("externalWrite") }
  action deliverEvent = all { events > 0, online, events' = events - 1,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub,
    keepSource, keepViews, keepCmds, ghost("deliverEvent") }

  // Observation: a read captures the source as it is when it starts.
  action startRead = all { online, nextRead < MAXREAD,
    reads' = reads.union(Set({ n: nextRead, e: epoch, s: seq })), nextRead' = nextRead + 1,
    epoch' = epoch, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub,
    keepSource, events' = events, keepViews, keepCmds, ghost("startRead") }
  // A read is applied only if it started after the newest applied read and in
  // the current epoch (no command result or source event since it started).
  // A pending command it settles records the revision that carries the outcome.
  // The broken World marks the command done without naming a revision, so the
  // view drops its pending value before it has the new one.
  action applyRead(r) = all { reads.contains(r), online,
    val ok = not(FENCED) or (r.n > lastRead and r.e == epoch)
    val x = hist.get(r.s)
    val changed = ok and x != wv
    val settles = VIEWS.filter(v => ok and Set("applied", "uncertain").contains(cst.get(v)) and r.n >= cmark.get(v))
    all {
      reads' = reads.exclude(Set(r)), nextRead' = nextRead, epoch' = epoch, changeMark' = changeMark,
      lastRead' = if (ok) r.n else lastRead,
      wv' = if (ok) x else wv, ws' = if (ok) r.s else ws,
      wrev' = if (changed) wrev + 1 else wrev,
      pub' = if (changed) pub.union(Set({ rev: wrev + 1, v: x })) else pub,
      stale' = if (ok) false else stale,
      cst' = VIEWS.mapBy(v => if (settles.contains(v)) "observed" else cst.get(v)),
      crev' = VIEWS.mapBy(v => if (FENCED and settles.contains(v) and cst.get(v) == "applied")
        (if (changed) wrev + 1 else wrev) else if (settles.contains(v)) 0 else crev.get(v)),
      cval' = cval, cseq' = cseq, cmark' = cmark,
      keepSource, events' = events, keepViews, ghost("applyRead") } }
  action dropRead(r) = all { reads.contains(r), reads' = reads.exclude(Set(r)),
    nextRead' = nextRead, epoch' = epoch, lastRead' = lastRead, changeMark' = changeMark,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub,
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
    keepViews, ghost("goOffline") }
  action goOnline = all { not(online),
    src' = src, seq' = seq, hist' = hist, online' = true, events' = 0,
    epoch' = epoch + 1, nextRead' = nextRead, reads' = reads, lastRead' = lastRead, changeMark' = nextRead,
    wv' = wv, ws' = ws, wrev' = wrev, stale' = stale, pub' = pub,
    keepViews, keepCmds, ghost("goOnline") }

  // A view takes a World push; pushes can arrive late and out of order.
  action adopt(v, p) = all { pub.contains(p), not(FENCED) or p.rev > vrev.get(v),
    vrev' = vrev.set(v, p.rev), vval' = vval.set(v, p.v),
    keepSource, events' = events, keepWorld, keepCmds, ghost("adopt") }

  action step = {
    nondet v = VIEWS.oneOf()
    nondet x = VALS.oneOf()
    any {
      issue(v, x), sourceApply(v), sourceRefuse(v), ack(v), externalWrite(x), deliverEvent, startRead,
      goOffline, goOnline,
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
  // Settled: online, nothing in flight, and World read the source after its last change.
  def settled = online and events == 0 and reads.size() == 0 and lastRead >= changeMark and
    VIEWS.forall(v => not(unresolved(v)) and vrev.get(v) == wrev)
  val settledConverges = not(settled) or (wv == src and not(stale) and VIEWS.forall(v => shows(v) == src))
  val safety = worldTruthful and worldMonotonic and viewsMonotonic and confirmedStays and noFlashBack and offlineRefuses and
    settledConverges

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
  // Two views change the fact at once; both end on the value the source holds.
  run twoViewsConvergeTest = init.then(issue(1, 2)).then(issue(2, 3)).then(sourceApply(2)).then(sourceApply(1))
    .then(deliverEvent).then(deliverEvent).then(ack(1)).then(ack(2)).then(startRead)
    .then(applyRead({ n: 1, e: 4, s: 3 })).then(catchUp)
    .expect(src == 2 and wv == 2 and shows(1) == 2 and shows(2) == 2 and safety)
}
