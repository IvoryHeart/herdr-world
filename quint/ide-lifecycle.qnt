module ide_lifecycle {
  // IDE servers World starts for the Code view (#1009): two folders, one on
  // World's computer (slot 0) and one on an SSH host (slot 1), at most one
  // server at once. Host scripts take steps on the host; their answers may
  // be lost, and a script whose answer was lost, or whose World restarted,
  // may still run there ("ghost") or die. Only Stop ends a server.
  //
  // Fault flags: each turns one design decision back and must give a
  // counterexample. OLD_* are the counterexamples this model found in the
  // first design, kept as sensitivity controls.
  pure val KEEP_ROUTES = false      // release() leaves streams open
  pure val LOST_IS_FAILED = false   // a start without an answer counts as failed
  pure val STOP_TREE_ONLY = false   // Stop ends the tree, not every marked process
  pure val OLD_LIST = false         // list skips claims, begin marks and stop leftovers
  pure val OLD_STOP = false         // an interrupted Stop's leftover is invisible
  pure val NO_VOID = false          // looking never voids an unanswered start
  pure val OLD_START_EPOCH = false  // a list sent before a start began may still forget it
  pure val OLD_QUEUE = false        // a queued Open runs after its connection changed

  pure val SLOTS = Set(0, 1)
  // Folders a person opens; a run may leave one closed to go deeper on the other.
  pure val ACTIVE = Set(0, 1)
  pure val CAP = 1
  pure val MAX_LAUNCH = 2
  pure val MAX_GEN = 2
  pure val MAX_ATT = 2
  pure val MAX_RESTART = 1
  // Bounds on what a person does and what goes wrong, per behaviour.
  pure val MAX_CLICKS = 4
  pure val MAX_FAULTS = 1
  pure val CLICK_OPS = Set("open", "stop", "forget", "stopByHand")
  pure val FAULT_OPS = Set("lose", "listLose", "ghostDie", "crash", "reconnect",
    "removeConn", "disable", "enable", "forwardDrop", "restart", "poll")
  pure val DONE = 9

  type Script = { kind: str, ph: int, stale: bool, origin: str, inc: int, voided: bool, out: str, moved: int, gen: int }
  type Next = { kind: str, gen: int }
  type Route = { live: bool, att: int, inc: int, gen: int, waiting: bool }
  type Stream = { slot: int, att: int, inc: int, gen: int }
  type State = {
    // The hosts: the folder's server directory, the launch recorded in it,
    // Stop leftovers (renamed directories), begin marks of dead starts,
    // live server trees and re-parented terminals by (slot, launch).
    d: int -> str, hinc: int -> int, left: int -> Set[int], marks: int -> bool,
    proc: Set[(int, int)], orph: Set[(int, int)], launches: int, ended: Set[(int, int)],
    // Scripts: World's one operation per folder, one queued after it, its
    // list per host, and at most one ghost per folder.
    q: int -> Script, nxt: int -> Next, ls: int -> Script, gh: int -> Script,
    // World: each folder's entry, its attachment (route) and streams.
    w: int -> str, stopping: int -> bool, wgen: int -> int, auto: int -> int,
    route: int -> Route, atts: int, streams: Set[Stream],
    localListed: bool, sshListed: int, deferred: bool, restarts: int,
    // Environment: connection generations (0: removed), the provider switch,
    // and whether the person stopped the SSH folder's server by hand.
    cgen: int -> int, enabled: bool, hand: bool,
    clicks: int, faults: int,
  }
  type Op = { name: str, slot: int, arg: str }

  var st: State
  var op: Op

  pure val IDLE: Script = { kind: "none", ph: 0, stale: false, origin: "", inc: 0, voided: false, out: "", moved: -1, gen: -1 }
  pure val NO_NEXT: Next = { kind: "none", gen: -1 }
  pure val NO_ROUTE: Route = { live: false, att: 0, inc: 0, gen: -1, waiting: false }
  pure def both(v) = Map(0 -> v, 1 -> v)

  pure val INITIAL: State = {
    d: both("none"), hinc: both(0), left: both(Set()), marks: both(false),
    proc: Set(), orph: Set(), launches: 0, ended: Set(),
    q: both(IDLE), nxt: both(NO_NEXT), ls: both(IDLE), gh: both(IDLE),
    w: both("none"), stopping: both(false), wgen: both(-1), auto: both(-1),
    route: both(NO_ROUTE), atts: 0, streams: Set(),
    localListed: false, sshListed: -1, deferred: false, restarts: 0,
    cgen: both(1), enabled: true, hand: false,
    clicks: 0, faults: 0,
  }

  action init = all { st' = INITIAL, op' = { name: "init", slot: -1, arg: "" } }

  // ---- World's view -------------------------------------------------------

  pure def busy(s: State, slot: int): bool = s.q.get(slot).kind != "none"
  pure def listed(s: State, slot: int): bool = s.w.get(slot) != "none" and s.w.get(slot) != "failed"
  pure def admitted(s: State, slot: int, g: int): bool =
    s.cgen.get(slot) > 0 and s.cgen.get(slot) == g and s.enabled
  pure def unreachable(s: State, slot: int): bool =
    slot == 1 and s.cgen.get(1) == 0 and listed(s, 1)
  pure def liveOthers(s: State, slot: int): int =
    SLOTS.filter(o => o != slot and listed(s, o)).size()
  pure def staled(x: Script): Script = if (x.kind == "none") x else { ...x, stale: true }

  // Ends World's attachment: in-flight answers go stale, the route retires
  // and its streams close. The server runs on.
  pure def release(s: State, slot: int): State = {
    ...s,
    q: s.q.set(slot, staled(s.q.get(slot))),
    ls: s.ls.set(slot, staled(s.ls.get(slot))),
    route: s.route.set(slot, { ...s.route.get(slot), live: false, waiting: false }),
    streams: if (KEEP_ROUTES) s.streams else s.streams.filter(x => x.slot != slot),
  }
  pure def setW(s: State, slot: int, state: str): State = {
    ...s,
    w: s.w.set(slot, state),
    wgen: if (state == "ready" or state == "starting") s.wgen else s.wgen.set(slot, -1),
  }
  pure def detach(s: State, slot: int): State =
    val r = release(s, slot)
    if (r.w.get(slot) == "failed") r else setW(r, slot, "detached")
  pure def failEntry(s: State, slot: int): State = setW(release(s, slot), slot, "failed")
  pure def attachedNow(s: State, slot: int): bool =
    not(s.stopping.get(slot)) and (s.w.get(slot) == "ready" or s.w.get(slot) == "starting")
  pure def detachAll(s: State, which: int => bool): State =
    SLOTS.fold(s, (acc, slot) => if (attachedNow(acc, slot) and which(slot)) detach(acc, slot) else acc)
  // A new or deleted entry is a different object: a list sent before misses it.
  pure def forgetEntry(s: State, slot: int): State = {
    ...release(s, slot),
    w: s.w.set(slot, "none"), stopping: s.stopping.set(slot, false),
    wgen: s.wgen.set(slot, -1), auto: s.auto.set(slot, -1),
  }

  // A start first makes its begin mark. Only a Stop or a look voids marks:
  // a start racing another (World's lost one, or another World's) finds it
  // through the folder's claim instead (#1009 twin-start race).
  pure def voided(x: Script): Script = if (x.kind == "start" and x.ph == 1) { ...x, voided: true } else x
  pure def voidBegins(s: State, slot: int): State =
    if (NO_VOID) s else {
      ...s,
      marks: s.marks.set(slot, false),
      q: s.q.set(slot, voided(s.q.get(slot))),
      gh: s.gh.set(slot, voided(s.gh.get(slot))),
    }
  pure def sendStart(s: State, slot: int, origin: str, g: int): State =
    { ...s, q: s.q.set(slot, { ...IDLE, kind: "start", ph: 1, origin: origin, gen: g }),
      ls: if (OLD_START_EPOCH) s.ls else s.ls.set(slot, staled(s.ls.get(slot))) }
  pure def sendAttach(s: State, slot: int, origin: str, g: int): State =
    { ...s, q: s.q.set(slot, { ...IDLE, kind: "attach", ph: 1, origin: origin, gen: g }) }
  pure def idle(s: State, slot: int): State = { ...s, q: s.q.set(slot, IDLE) }

  pure def openBody(s: State, slot: int, g: int): State =
    val w = s.w.get(slot)
    if (w != "none" and attachedNow(s, slot) and s.wgen.get(slot) == g) idle(s, slot)
    else if ((w == "none" or w == "failed") and liveOthers(s, slot) >= CAP) idle(s, slot)
    else if (w == "none")
      sendStart({ ...release(s, slot), w: s.w.set(slot, "starting"), wgen: s.wgen.set(slot, g), auto: s.auto.set(slot, g) }, slot, "open", g)
    else
      val r = release(s, slot)
      val s1 = setW({ ...r, auto: r.auto.set(slot, g), wgen: r.wgen.set(slot, g) }, slot, "starting")
      if (w == "failed") sendStart(s1, slot, "open", g) else sendAttach(s1, slot, "open", g)

  pure def stopBody(s: State, slot: int): State =
    if (s.w.get(slot) == "none") idle(s, slot)
    else { ...s, q: s.q.set(slot, { ...IDLE, kind: "stop", ph: 1, origin: "stop" }) }

  pure def reattachBody(s: State, slot: int, g: int): State =
    if (s.w.get(slot) != "detached" or s.stopping.get(slot)) idle(s, slot)
    else sendAttach(setW({ ...s, wgen: s.wgen.set(slot, g) }, slot, "starting"), slot, "reattach", g)

  // A queued Open or reattach runs only while its connection is still the
  // one it was asked under.
  pure def runOp(s: State, slot: int, n: Next): State =
    if (n.kind != "stop" and not(OLD_QUEUE) and not(admitted(s, slot, n.gen))) idle(s, slot)
    else if (n.kind == "open") openBody(s, slot, n.gen)
    else if (n.kind == "stop") stopBody(s, slot)
    else reattachBody(s, slot, n.gen)

  // The operation ends; the queued one starts.
  pure def finish(s: State, slot: int): State =
    val n = s.nxt.get(slot)
    val s1 = { ...idle(s, slot), nxt: s.nxt.set(slot, NO_NEXT) }
    if (n.kind == "none") s1 else runOp(s1, slot, n)

  pure def enqueue(s: State, slot: int, n: Next): State =
    if (busy(s, slot)) { ...s, nxt: s.nxt.set(slot, n) } else runOp(s, slot, n)

  // Reattach, once per generation, to detached servers whose connection is back.
  pure def wantsReattach(s: State, slot: int): bool =
    s.w.get(slot) == "detached" and not(s.stopping.get(slot)) and s.cgen.get(slot) > 0
      and s.enabled and s.auto.get(slot) != s.cgen.get(slot)
  pure def reattachAdmitted(s: State): State =
    SLOTS.fold(s, (acc, slot) =>
      if (wantsReattach(acc, slot))
        enqueue({ ...acc, auto: acc.auto.set(slot, acc.cgen.get(slot)) }, slot, { kind: "reattach", gen: acc.cgen.get(slot) })
      else acc)
  // The model keeps one queued operation per folder.
  pure def reattachFits(s: State): bool =
    SLOTS.forall(slot => not(wantsReattach(s, slot)) or not(busy(s, slot)) or s.nxt.get(slot).kind == "none")

  pure def wantsSshList(s: State, refresh: bool): bool =
    s.cgen.get(1) > 0 and (refresh or s.sshListed != s.cgen.get(1))
  pure def sendList(s: State, slot: int): State =
    { ...s, ls: s.ls.set(slot, { ...IDLE, kind: "list", ph: 1, gen: s.cgen.get(slot), origin: if (s.w.get(slot) == "none") "new" else "known" }) }
  // Detach what is no longer admitted, list each host, reattach.
  pure def reconcile(s: State, refresh: bool): State =
    val s1 = detachAll(s, slot => not(admitted(s, slot, s.wgen.get(slot))))
    val s2 = if (wantsSshList(s1, refresh)) { ...sendList(s1, 1), sshListed: s1.cgen.get(1) } else s1
    val s3 = if (s2.ls.get(0).kind == "none" and (refresh or not(s2.localListed))) { ...sendList(s2, 0), localListed: true } else s2
    if (s3.ls.get(0).kind != "none") { ...s3, deferred: true } else reattachAdmitted(s3)
  pure def reconcileFits(s: State, refresh: bool): bool =
    val s1 = detachAll(s, slot => not(admitted(s, slot, s.wgen.get(slot))))
    (not(wantsSshList(s1, refresh)) or s1.ls.get(1).kind == "none")
      and (s1.ls.get(0).kind != "none" or (refresh or not(s1.localListed)) or reattachFits(s1))

  // World attaches to a launch: a fresh route under the generation.
  pure def connect(s: State, slot: int, inc: int, g: int): State =
    val r = release(s, slot)
    setW({ ...r, atts: r.atts + 1, wgen: r.wgen.set(slot, g),
      route: r.route.set(slot, { live: true, att: r.atts + 1, inc: inc, gen: g, waiting: true }) }, slot, "starting")

  // ---- Host scripts -------------------------------------------------------

  pure def pendingBegin(s: State, slot: int): bool =
    s.marks.get(slot)
      or Set(s.q.get(slot), s.gh.get(slot)).exists(x => x.kind == "start" and x.ph == 1 and not(x.voided))
  pure def kill(s: State, slot: int, incs: Set[int]): State =
    val killed = incs.map(i => (slot, i))
    { ...s, proc: s.proc.exclude(killed), orph: if (STOP_TREE_ONLY) s.orph else s.orph.exclude(killed),
      ended: s.ended.union(killed.filter(k => k._2 > 0)) }
  pure def canAdvance(s: State, slot: int, x: Script): bool =
    x.ph >= 1 and x.ph < DONE
      and not(x.kind == "start" and x.ph == 2 and s.d.get(slot) == "claimed" and s.launches >= MAX_LAUNCH)
  // One step of a script on its host; DONE carries its answer.
  pure def advance(s: State, slot: int, x: Script): (State, Script) =
    val d = s.d.get(slot)
    val leftover = not(OLD_STOP) and s.left.get(slot) != Set()
    if (x.kind == "start" and x.ph == 1)
      if (x.voided) (s, { ...x, ph: DONE, out: "voided" })
      else if (leftover) (s, { ...x, ph: DONE, out: "running" })
      else if (d == "none" or d == "exited")
        ({ ...s, d: s.d.set(slot, "claimed"), hinc: s.hinc.set(slot, 0) }, { ...x, ph: 2 })
      else (s, { ...x, ph: DONE, out: "running" })
    else if (x.kind == "start" and x.ph == 2)
      if (d == "claimed")
        ({ ...s, d: s.d.set(slot, "recorded"), hinc: s.hinc.set(slot, s.launches + 1), launches: s.launches + 1 },
         { ...x, ph: 3, inc: s.launches + 1 })
      else (s, { ...x, ph: DONE, out: "running" })
    else if (x.kind == "start")
      if (d == "recorded" and s.hinc.get(slot) == x.inc)
        // Worst case: a terminal in it at once starts a session of its own.
        ({ ...s, d: s.d.set(slot, "running"), proc: s.proc.union(Set((slot, x.inc))), orph: s.orph.union(Set((slot, x.inc))) },
         { ...x, ph: DONE, out: "started" })
      else (s, { ...x, ph: DONE, out: "started" })
    else if (x.kind == "attach")
      val v = voidBegins(s, slot)
      val out =
        if (d == "none") (if (leftover) "stopping" else "gone")
        else if (d == "claimed" or d == "recorded") "starting"
        else if (d == "running") "running"
        else "exited"
      (v, { ...x, ph: DONE, out: out, inc: if (d == "running") s.hinc.get(slot) else 0 })
    else if (x.kind == "list")
      val out =
        if (d == "recorded" or d == "running") "seen"
        else if (not(OLD_LIST) and (pendingBegin(s, slot) or d == "claimed" or s.left.get(slot) != Set())) "pending"
        else if (d == "exited") "exited"
        else "absent"
      (s, { ...x, ph: DONE, out: out })
    else if (x.ph == 1)
      // Stop: void begin marks, then rename the folder away.
      val v = voidBegins(s, slot)
      if (d == "none")
        if (leftover) (v, { ...x, ph: 2 }) else (v, { ...x, ph: DONE, out: "gone" })
      else
        ({ ...v, d: v.d.set(slot, "none"), hinc: v.hinc.set(slot, 0), left: v.left.set(slot, v.left.get(slot).union(Set(s.hinc.get(slot)))) },
         { ...x, ph: 2, moved: s.hinc.get(slot) })
    else
      // Stop: end every marked process of the renamed folders, remove them.
      val targets = if (OLD_STOP) Set(x.moved) else s.left.get(slot)
      val k = kill(s, slot, targets)
      ({ ...k, left: k.left.set(slot, k.left.get(slot).exclude(targets)) }, { ...x, ph: DONE, out: "stopped" })

  // ---- World handles answers -----------------------------------------------

  pure def wanted(s: State, slot: int, x: Script): bool =
    not(x.stale) and not(s.stopping.get(slot)) and s.w.get(slot) == "starting"

  pure def answer(s: State, slot: int, x: Script): State =
    if (x.kind == "start")
      if (not(wanted(s, slot, x))) finish(s, slot)
      else if (x.out == "voided") finish(failEntry(s, slot), slot)
      else if (x.out == "running") sendAttach(s, slot, "start", x.gen)
      else finish(connect(s, slot, x.inc, x.gen), slot)
    else if (x.kind == "attach")
      if (not(wanted(s, slot, x))) finish(s, slot)
      else if (x.out == "gone")
        if (x.origin == "open") sendStart(s, slot, "open", x.gen)
        else if (x.origin == "reattach") finish(forgetEntry(s, slot), slot)
        else finish(failEntry(s, slot), slot)
      else if (x.out == "stopping") finish(setW(s, slot, "detached"), slot)
      else if (x.out == "starting") sendAttach(s, slot, x.origin, x.gen)
      else if (x.out == "running") finish(connect(s, slot, x.inc, x.gen), slot)
      else finish(failEntry(s, slot), slot)
    else
      val s1 = { ...s, stopping: s.stopping.set(slot, false) }
      if (x.out == "stopped" or x.out == "gone") finish(forgetEntry(s1, slot), slot)
      else finish(s1, slot)

  pure def lost(s: State, slot: int, x: Script): State =
    if (x.kind == "start" or x.kind == "attach")
      if (not(wanted(s, slot, x))) finish(s, slot)
      else if (x.kind == "start" and LOST_IS_FAILED) finish(failEntry(s, slot), slot)
      else finish(setW(s, slot, "detached"), slot)
    else
      val s1 = { ...s, stopping: s.stopping.set(slot, false) }
      if (s1.w.get(slot) == "failed") finish(forgetEntry(s1, slot), slot)
      else finish(setW(s1, slot, "detached"), slot)

  // discover(): merge one host's list.
  pure def merged(s: State, slot: int, x: Script): State =
    val w = s.w.get(slot)
    val quiet = not(x.stale) and x.origin == "known" and not(s.stopping.get(slot)) and not(busy(s, slot))
    if (x.out == "seen" or x.out == "exited")
      if (w == "none")
        if (busy(s, slot)) s else setW(s, slot, if (x.out == "exited") "failed" else "detached")
      else if (x.out == "exited" and w != "failed" and quiet) failEntry(s, slot)
      else if (x.out == "seen" and w == "failed" and not(s.stopping.get(slot)) and not(busy(s, slot))) setW(s, slot, "detached")
      else s
    else if (x.out == "absent" and w == "detached" and quiet) forgetEntry(s, slot)
    else s

  pure def listDone(s: State, slot: int, x: Script, ok: bool): State =
    val s1 = { ...s, ls: s.ls.set(slot, IDLE) }
    val s2 = if (ok) merged(s1, slot, x) else s1
    if (slot == 1)
      if (ok) reattachAdmitted(s2) else { ...s2, sshListed: if (s2.sshListed == x.gen) -1 else s2.sshListed }
    else if (s2.deferred) reattachAdmitted({ ...s2, deferred: false })
    else s2
  // As for reconcile: the model never queues a reattach behind a queued operation.
  pure def listDoneFits(s: State, slot: int, x: Script, ok: bool): bool =
    val s1 = { ...s, ls: s.ls.set(slot, IDLE) }
    val s2 = if (ok) merged(s1, slot, x) else s1
    not(if (slot == 1) ok else s2.deferred) or reattachFits(s2)

  // ---- Actions ---------------------------------------------------------------

  action go(after: State, name: str, slot: int, arg: str): bool = {
    val counted = { ...after,
      clicks: after.clicks + (if (CLICK_OPS.contains(name)) 1 else 0),
      faults: after.faults + (if (FAULT_OPS.contains(name)) 1 else 0) }
    all {
      counted.atts <= MAX_ATT, counted.clicks <= MAX_CLICKS, counted.faults <= MAX_FAULTS,
      st' = counted, op' = { name: name, slot: slot, arg: arg },
    }
  }

  action open(slot: int): bool = all {
    st.cgen.get(slot) > 0, st.enabled,
    not(busy(st, slot)) or st.nxt.get(slot).kind == "none",
    go(enqueue(st, slot, { kind: "open", gen: st.cgen.get(slot) }), "open", slot, ""),
  }
  action stop(slot: int): bool = all {
    listed(st, slot) or st.w.get(slot) == "failed",
    not(st.stopping.get(slot)), not(unreachable(st, slot)),
    not(busy(st, slot)) or st.nxt.get(slot).kind == "none",
    go(enqueue(release({ ...st, stopping: st.stopping.set(slot, true) }, slot), slot, { kind: "stop", gen: -1 }), "stop", slot, ""),
  }
  action forget(slot: int): bool = all {
    unreachable(st, slot), st.hand, not(st.stopping.get(slot)), not(busy(st, slot)),
    go(forgetEntry(st, slot), "forget", slot, ""),
  }
  action stopByHand(slot: int): bool = all {
    unreachable(st, slot), not(st.hand),
    val v = voidBegins(st, slot)
    val incs = st.left.get(slot).union(if (st.d.get(slot) == "running") Set(st.hinc.get(slot)) else Set())
    val killed = incs.map(i => (slot, i))
    go({ ...v, proc: v.proc.exclude(killed), d: v.d.set(slot, "none"), hinc: v.hinc.set(slot, 0),
      left: v.left.set(slot, Set()), hand: true }, "stopByHand", slot, ""),
  }
  action hostStep(slot: int): bool = all {
    canAdvance(st, slot, st.q.get(slot)),
    val r = advance(st, slot, st.q.get(slot))
    go({ ...r._1, q: r._1.q.set(slot, r._2) }, "hostStep", slot, ""),
  }
  action reply(slot: int): bool = all {
    st.q.get(slot).ph == DONE,
    go(answer({ ...st, q: st.q.set(slot, IDLE) }, slot, st.q.get(slot)), "reply", slot, st.q.get(slot).out),
  }
  // The answer is lost; the script runs on as a ghost, or dies there.
  action loseAs(slot: int, survives: bool): bool = {
    val x = st.q.get(slot)
    val ghost = survives and (x.kind == "start" or x.kind == "stop") and x.ph < DONE and st.gh.get(slot).kind == "none"
    val dead = not(ghost) and x.kind == "start" and x.ph == 1
    all {
      x.kind != "none",
      survives implies ghost,
      go(lost({ ...st, q: st.q.set(slot, IDLE),
        gh: if (ghost) st.gh.set(slot, { ...x, stale: true }) else st.gh,
        marks: if (dead) st.marks.set(slot, true) else st.marks }, slot, x),
        "lose", slot, if (ghost) "ghost" else "dead"),
    }
  }
  action lose(slot: int): bool = {
    nondet survives = Set(false, true).oneOf()
    loseAs(slot, survives)
  }
  action listStep(slot: int): bool = all {
    canAdvance(st, slot, st.ls.get(slot)),
    val r = advance(st, slot, st.ls.get(slot))
    go({ ...r._1, ls: r._1.ls.set(slot, r._2) }, "listStep", slot, ""),
  }
  action listReply(slot: int): bool = all {
    st.ls.get(slot).ph == DONE, listDoneFits(st, slot, st.ls.get(slot), true),
    go(listDone(st, slot, st.ls.get(slot), true), "listReply", slot, st.ls.get(slot).out),
  }
  action listLose(slot: int): bool = all {
    st.ls.get(slot).kind != "none", listDoneFits(st, slot, st.ls.get(slot), false),
    go(listDone(st, slot, st.ls.get(slot), false), "listLose", slot, ""),
  }
  action ghostStep(slot: int): bool = all {
    canAdvance(st, slot, st.gh.get(slot)),
    val r = advance(st, slot, st.gh.get(slot))
    go({ ...r._1, gh: r._1.gh.set(slot, if (r._2.ph == DONE) IDLE else r._2) }, "ghostStep", slot, ""),
  }
  action ghostDie(slot: int): bool = all {
    st.gh.get(slot).kind != "none",
    val x = st.gh.get(slot)
    go({ ...st, gh: st.gh.set(slot, IDLE),
      marks: if (x.kind == "start" and x.ph == 1 and not(x.voided)) st.marks.set(slot, true) else st.marks },
      "ghostDie", slot, ""),
  }
  // waitReady: the server answers on the folder's socket.
  action ready(slot: int): bool = all {
    st.route.get(slot).waiting, st.w.get(slot) == "starting", st.d.get(slot) == "running",
    go({ ...setW(st, slot, "ready"), route: st.route.set(slot, { ...st.route.get(slot), waiting: false }) }, "ready", slot, ""),
  }
  // A browser request on the route: admission first, then the server there.
  action request(slot: int): bool = all {
    st.w.get(slot) != "none",
    if (not(admitted(st, slot, st.wgen.get(slot))))
      all { attachedNow(st, slot), go(detachAll(st, o => o == slot), "request", slot, "stale") }
    else all {
      st.w.get(slot) == "ready", not(st.stopping.get(slot)), st.d.get(slot) == "running",
      not(st.streams.exists(x => x.slot == slot and x.att == st.route.get(slot).att)),
      go({ ...st, streams: st.streams.union(Set({ slot: slot, att: st.route.get(slot).att, inc: st.hinc.get(slot), gen: st.wgen.get(slot) })) },
        "request", slot, "stream"),
    },
  }
  // The server exits on its own; its supervisor ends what it left.
  action crash(slot: int): bool = {
    nondet i = st.proc.filter(p => p._1 == slot).map(p => p._2).oneOf()
    all {
      st.proc.exists(p => p._1 == slot),
      go({ ...st, proc: st.proc.exclude(Set((slot, i))), orph: st.orph.exclude(Set((slot, i))),
        d: if (st.d.get(slot) == "running" and st.hinc.get(slot) == i) st.d.set(slot, "exited") else st.d,
        streams: st.streams.filter(x => not(x.slot == slot and x.inc == i)) }, "crash", slot, ""),
    }
  }
  action reconnect(slot: int): bool = all {
    st.cgen.get(slot) > 0, st.cgen.get(slot) < MAX_GEN,
    val s1 = { ...st, cgen: st.cgen.set(slot, st.cgen.get(slot) + 1) }
    all { reconcileFits(s1, false), go(reconcile(s1, false), "reconnect", slot, "") },
  }
  action poll(refresh: bool): bool = all {
    reconcileFits(st, refresh),
    go(reconcile(st, refresh), "poll", -1, if (refresh) "refresh" else ""),
  }
  action removeConn: bool = all {
    st.cgen.get(1) > 0,
    val s1 = { ...st, cgen: st.cgen.set(1, 0) }
    all { reconcileFits(s1, false),
      go({ ...detachAll(reconcile(s1, false), slot => slot == 1), sshListed: -1 }, "removeConn", 1, "") },
  }
  action disable: bool = all { st.enabled, go(detachAll({ ...st, enabled: false }, slot => true), "disable", -1, "") }
  action enable: bool = all { not(st.enabled), go({ ...st, enabled: true }, "enable", -1, "") }
  // The SSH forward exits: World detaches; the server runs on.
  action forwardDrop: bool = all {
    st.route.get(1).live,
    go(detach(st, 1), "forwardDrop", 1, ""),
  }
  pure def survivor(s: State, slot: int, keep: bool): bool =
    val x = s.q.get(slot)
    s.gh.get(slot).kind == "none" and keep and (x.kind == "start" or x.kind == "stop") and x.ph < DONE
  pure def ghostAfterRestart(s: State, slot: int, keep: bool): Script =
    if (survivor(s, slot, keep)) { ...s.q.get(slot), stale: true } else s.gh.get(slot)
  pure def markAfterRestart(s: State, slot: int, keep: bool): bool =
    val x = s.q.get(slot)
    s.marks.get(slot) or (x.kind == "start" and x.ph == 1 and not(x.voided) and not(survivor(s, slot, keep)))
  pure def restarted(s: State, keep0: bool, keep1: bool): State = { ...s,
    gh: Map(0 -> ghostAfterRestart(s, 0, keep0), 1 -> ghostAfterRestart(s, 1, keep1)),
    marks: Map(0 -> markAfterRestart(s, 0, keep0), 1 -> markAfterRestart(s, 1, keep1)),
    q: both(IDLE), nxt: both(NO_NEXT), ls: both(IDLE),
    w: Map(0 -> (if (listed(s, 0)) "detached" else "none"), 1 -> (if (listed(s, 1)) "detached" else "none")),
    stopping: both(false), wgen: both(-1), auto: both(-1), route: both(NO_ROUTE), streams: Set(),
    localListed: false, sshListed: -1, deferred: false, restarts: s.restarts + 1,
  }
  // World restarts: its own answers are gone; scripts run on as ghosts or die.
  action restartAs(keep0: bool, keep1: bool): bool = all {
    st.restarts < MAX_RESTART,
    go(restarted(st, keep0, keep1), "restart", -1, if (keep0 and keep1) "01" else if (keep0) "0" else if (keep1) "1" else ""),
  }
  action restart: bool = {
    nondet keep0 = Set(false, true).oneOf()
    nondet keep1 = Set(false, true).oneOf()
    restartAs(keep0, keep1)
  }

  // The environment is one branch, so sampled traces reach a folder's own
  // actions (a lost answer among them) as often as World-wide ones.
  action world = any {
    nondet refresh = Set(false, true).oneOf()
    poll(refresh),
    removeConn, disable, enable, forwardDrop, restart,
  }
  action step = any {
    nondet slot = ACTIVE.oneOf()
    any {
      open(slot), stop(slot), hostStep(slot), reply(slot), lose(slot), listStep(slot), listReply(slot),
      listLose(slot), ghostStep(slot), ghostDie(slot), ready(slot), request(slot), crash(slot),
      reconnect(slot), forget(slot), stopByHand(slot),
    },
    world,
  }

  // ---- Properties --------------------------------------------------------------

  // At most one server per folder per host, an interrupted Stop's included.
  val onePerFolder = SLOTS.forall(slot => st.proc.filter(p => p._1 == slot).size() <= 1)
  // Every server that may run is listed (and so counted and stoppable).
  val everyServerListed = st.proc.forall(p => listed(st, p._1))
  // Stop ends every process the server started, re-parented ones too.
  val stopEndsAll = st.ended.forall(k => not(st.proc.contains(k)) and not(st.orph.contains(k)))
  // A stream reaches only the launch and generation its live route was
  // issued for; a retired route reaches nothing.
  val routesQualified = st.streams.forall(x =>
    val r = st.route.get(x.slot)
    r.live and x.att == r.att and x.inc == r.inc and x.gen == r.gen and admitted(st, x.slot, x.gen))
  // Only a person's Stop ends a server: World's own stops come from Stop.
  val stopsFromStop = SLOTS.forall(slot => st.q.get(slot).kind != "stop" or st.stopping.get(slot))
  val safety = onePerFolder and everyServerListed and stopEndsAll and routesQualified and stopsFromStop
}
