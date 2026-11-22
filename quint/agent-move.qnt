module agent_move {
  // world.agent.move (server/src/world/agent-move.ts): hand one agent from a
  // Herdr TUI connection to a herdr-core one, or back. The controller runs its
  // steps in turn (admit, start, recheck + carry the desk, recheck, close, and
  // cleanup on failure). Between steps the outside may change: the source
  // works, splits, goes away or (core) starts a child; either connection drops
  // or reconnects with a new runtime generation. Any reply may be lost.
  //
  // Each side is bound to the connection and generation the browser saw
  // (generation 1). A call on a dropped or reconnected side fails without
  // effect; nothing falls back to the newer generation or another connection.
  //
  // Scenario choices are drawn from weighted integer ranges so the simulator
  // reaches rare paths often; TLC explores every choice either way.
  //
  // FAULT selects one broken rule (negative controls; each must violate
  // safety): no-recheck closes without reading the source again after the
  // desk moved; fallback lets a call on a reconnected side reach the new
  // generation; assume-alive takes an unreadable source after a lost close
  // reply as still running and drops the copy; unnamed-start reports a lost
  // start reply without saying the copy may run.
  pure val FAULT = "none"
  pure def fault(name) = FAULT == name
  pure val EVENT_BOUND = 2
  // shape: the source at admission. src: the source now (idle, busy, split,
  // gone, child). Conns: up, down or regen. alive/copy: the truth of each
  // agent's process. desk: which address holds the desk (colour, pin, links).
  // effects: calls with effect intent, in order, for replay. Script fields
  // record each step's replies and outside events ("-" when not reached).
  type Move = { dir: str, pinned: bool, shape: str, pc: str, src: str,
    srcConn: str, dstConn: str, alive: bool, copy: bool, desk: str,
    outcome: str, reason: str, namesCopy: bool, namesOrig: bool,
    namesDesk: bool, gone: bool, events: int, effects: List[str],
    closedBusy: bool, unfenced: bool,
    startReply: str, startTruth: bool, pinReply: str, rehomeReply: str,
    closeReply: str, closeTruth: bool, stillRead: str, cleanupReply: str,
    cleanupTruth: bool, unhomeReply: str,
    envStart: str, envRehome: str, envClose: str }
  var m: Move
  var op: str

  pure def coreSource(dir) = dir == "core-tui"
  // Outside events at a step boundary; ints 0..8 are events, the rest none.
  pure def eventOf(i, dir, closing) =
    if (i == 0) (if (closing) "none" else "busy")
    else if (i == 1) (if (closing) "none" else "split")
    else if (i == 2) (if (closing) "none" else "gone")
    else if (i == 3 or i == 8) (if (coreSource(dir)) "child" else "none")
    else if (i == 4) "srcDown" else if (i == 5) "srcRegen"
    else if (i == 6) "dstDown" else if (i == 7) "dstRegen" else "none"

  action init = {
    nondet dir = Set("tui-core", "core-tui").oneOf()
    nondet pinned = Set(false, true).oneOf()
    nondet s = 0.to(5).oneOf()
    val shape = if (s == 0) "busy" else if (s == 1) "split"
      else if (s == 2 and coreSource(dir)) "child" else "idle"
    all {
      m' = { dir: dir, pinned: pinned, shape: shape, pc: "admit", src: shape,
        srcConn: "up", dstConn: "up", alive: true, copy: false, desk: "src",
        outcome: "none", reason: "", namesCopy: false, namesOrig: false,
        namesDesk: false, gone: false, events: 0, effects: [],
        closedBusy: false, unfenced: false,
        startReply: "-", startTruth: false, pinReply: "-", rehomeReply: "-",
        closeReply: "-", closeTruth: false, stillRead: "-", cleanupReply: "-",
        cleanupTruth: false, unhomeReply: "-",
        envStart: "-", envRehome: "-", envClose: "-" },
      op' = "init",
    }
  }

  // One outside event, within the bound, recorded for replay in `field`.
  pure def outside(x: Move, i: int, closing: bool): Move = {
    val e = if (x.events >= EVENT_BOUND) "none" else eventOf(i, x.dir, closing)
    val y = if (e == "none") x else { ...x, events: x.events + 1 }
    if (e == "busy" or e == "split" or e == "child") { ...y, src: e }
    else if (e == "gone") { ...y, src: "gone", alive: false, gone: true }
    else if (e == "srcDown") { ...y, srcConn: "down" }
    else if (e == "srcRegen") { ...y, srcConn: "regen" }
    else if (e == "dstDown") { ...y, dstConn: "down" }
    else if (e == "dstRegen") { ...y, dstConn: "regen" }
    else y
  }
  pure def eventName(x: Move, i: int, closing: bool): str =
    if (x.events >= EVENT_BOUND) "none" else eventOf(i, x.dir, closing)
  pure def fx(x: Move, e: str): Move = { ...x, effects: x.effects.append(e) }
  pure def done(x: Move, outcome: str, reason: str): Move =
    { ...x, pc: "done", outcome: outcome, reason: reason }
  // A call with effect reaches its side only at the bound generation.
  pure def reaches(conn: str): bool = conn == "up" or (conn == "regen" and fault("fallback"))
  pure def fenceSlip(conn: str): bool = conn == "regen" and fault("fallback")
  // Close the copy that must not stay; name it if it may still run.
  // cu: the cleanup reply (0 unconfirmed, 1 throws, else ended).
  pure def discard(x: Move, cu: int, truth: bool): Move = {
    val reply = if (cu == 0) "uncertain" else if (cu == 1) "throws" else "ended"
    val y = { ...fx(x, "discard"), cleanupReply: reply, cleanupTruth: truth }
    if (not(reaches(y.dstConn))) { ...y, namesCopy: true }
    else {
      val z = { ...y, unfenced: y.unfenced or fenceSlip(y.dstConn) }
      if (reply == "ended") { ...z, copy: false }
      else { ...z, copy: z.copy and truth, namesCopy: true }
    }
  }
  // Put the desk back on the source; name it when the Board refuses.
  pure def unhome(x: Move, ok: bool): Move = {
    val y = { ...fx(x, "unhome"), unhomeReply: if (ok) "ok" else "fail" }
    if (ok) { ...y, desk: "src" } else { ...y, namesDesk: true }
  }
  // The source read again: idle (or a hidden child) and alone, same agent.
  pure def sourceOk(x: Move): bool = x.srcConn == "up" and (x.src == "idle" or x.src == "child")

  action admit = all {
    m.pc == "admit",
    m' = if (m.shape != "idle") done(m, "refused", m.shape) else { ...m, pc: "start" },
    op' = "admit",
  }
  action start = {
    // One draw per step: reply, truth, outside event, cleanup.
    nondet c = 0.to(1279).oneOf()
    val r = c % 8
    val truth = (c / 8) % 2 == 1
    val e = (c / 16) % 20
    val cu = c / 320
    val reply = if (r == 0) "failed" else if (r == 1) "partial" else if (r == 2) "lost" else "ready"
    val x = { ...fx(m, "start"), startReply: reply, startTruth: truth and reply == "lost" }
    all {
      m.pc == "start",
      m' = if (reply == "ready")
          outside({ ...x, copy: true, pc: "recheck", envStart: eventName(x, e, false) }, e, false)
        else if (reply == "failed") done(x, "refused", "start")
        else if (reply == "partial") done(discard({ ...x, copy: true }, cu, truth), "refused", "start")
        // Lost: World can't tell whether the copy started.
        else done({ ...x, copy: truth, namesCopy: not(fault("unnamed-start")) }, "refused", "start"),
      op' = "start",
    }
  }
  // Read the source again, read the destination, pin, then carry the desk.
  action recheck = {
    nondet c = 0.to(2559).oneOf()
    val pinOk = c % 4
    val rehomeOk = (c / 4) % 4
    val e = (c / 16) % 20
    val cu = (c / 320) % 4
    val truth = c / 1280 == 1
    val pinned = { ...m, pinReply: if (m.pinned) (if (pinOk == 0) "fail" else "ok") else "-" }
    all {
      m.pc == "recheck",
      m' = if (not(sourceOk(m))) done(discard(m, cu, truth), "refused", "changed")
        else if (m.dstConn != "up") done(discard(m, cu, truth), "refused", "target")
        else if (pinned.pinReply == "fail") done(discard(fx(pinned, "pin"), cu, truth), "refused", "pin")
        else {
          val x = if (m.pinned) fx(pinned, "pin") else pinned
          if (rehomeOk == 0) done(discard({ ...x, rehomeReply: "fail" }, cu, truth), "refused", "board")
          else outside({ ...fx(x, "rehome"), rehomeReply: "ok", desk: "dst", pc: "recheck2",
            envRehome: eventName(x, e, false) }, e, false)
        },
      op' = "recheck",
    }
  }
  action recheck2 = {
    nondet c = 0.to(639).oneOf()
    val e = c % 20
    val cu = (c / 20) % 4
    val truth = (c / 80) % 2 == 1
    val ok = c / 160
    all {
      m.pc == "recheck2",
      m' = if (not(sourceOk(m)) and not(fault("no-recheck")))
          done(discard(unhome(m, ok > 0), cu, truth), "refused", "changed")
        else outside({ ...m, pc: "close", envClose: eventName(m, e, true) }, e, true),
      op' = "recheck2",
    }
  }
  action close = {
    nondet c = 0.to(767).oneOf()
    val r = c % 6
    val closeTruth = (c / 6) % 2 == 1
    val read = (c / 12) % 2
    val cu = (c / 24) % 4
    val truth = (c / 96) % 2 == 1
    val ok = c / 192
    // core's kill can answer "unconfirmed"; a TUI pane.close cannot.
    val reply = if (r == 0) "lostEnded" else if (r == 1) "lostAlive"
      else if (r == 2 and coreSource(m.dir)) "uncertain" else "ended"
    val x = { ...fx(m, "close"), closeReply: reply,
      closeTruth: closeTruth and reply == "uncertain" }
    // Core ends only the admitted set: a child started since refuses it.
    val refusedKill = x.src == "child"
    val ends = reaches(x.srcConn) and not(refusedKill) and
      (reply == "ended" or reply == "lostEnded" or (reply == "uncertain" and closeTruth))
    val threw = not(reaches(x.srcConn)) or refusedKill or
      reply == "lostEnded" or reply == "lostAlive"
    // After a failed close World reads the source again.
    val readOk = threw and x.srcConn == "up" and read == 1
    val y = { ...x, alive: x.alive and not(ends),
      closedBusy: x.closedBusy or (ends and x.src != "idle"),
      unfenced: x.unfenced or (ends and fenceSlip(x.srcConn)),
      stillRead: if (not(threw)) "-" else if (readOk) "ok" else "fail" }
    all {
      m.pc == "close",
      m' = if (not(threw) and reply == "uncertain")
          done({ ...y, namesOrig: true }, "uncertain", "close")
        else if (not(threw)) done(y, "moved", "")
        else if (readOk)
          (if (not(y.alive)) done(y, "moved", "")
            else done(discard(unhome(y, ok > 0), cu, truth), "refused", "close"))
        else if (fault("assume-alive")) done(discard(unhome(y, ok > 0), cu, truth), "refused", "close")
        else done({ ...y, namesOrig: true }, "uncertain", "close"),
      op' = "close",
    }
  }
  action settled = all { m.pc == "done", m' = m, op' = "settled" }
  action step = any { admit, start, recheck, recheck2, close, settled }

  val ended = m.pc == "done"
  // Once settled exactly one runs, unless the report names the one that may
  // also run, or the person closed the source themselves.
  val oneOwner = not(ended) or
    (m.alive != m.copy) or (m.alive and m.copy and (m.namesCopy or m.namesOrig)) or
    (not(m.alive) and not(m.copy) and m.gone)
  // A failed move leaves the source running and its desk with it, with a reason.
  val refusedIntact = m.outcome != "refused" or
    ((m.alive or m.gone) and m.reason != "" and (m.desk == "src" or m.namesDesk) and
      (not(m.copy) or m.namesCopy))
  val movedClean = m.outcome != "moved" or (not(m.alive) and m.copy and m.desk == "dst")
  val uncertainNamed = m.outcome != "uncertain" or (m.copy and m.desk == "dst" and m.namesOrig)
  // A busy, split or child-starting source is refused before anything starts.
  val admission = m.shape == "idle" or m.effects.length() == 0
  val safety = oneOwner and refusedIntact and movedClean and uncertainNamed and
    admission and not(m.closedBusy) and not(m.unfenced) and
    (not(ended) or m.outcome != "none")

  // Reachability witnesses for the sampled traces.
  val movedTuiCore = op == "close" and m.outcome == "moved" and m.dir == "tui-core"
  val movedCoreTui = op == "close" and m.outcome == "moved" and m.dir == "core-tui"
  val refusedSplit = op == "admit" and m.shape == "split"
  val lostStart = op == "start" and m.startReply == "lost"
  val changedDuringStart = op == "recheck" and m.reason == "changed"
  val changedDuringRehome = op == "recheck2" and m.reason == "changed"
  val childRefusedKill = op == "close" and m.src == "child" and m.outcome == "refused"
  val closeUnconfirmed = op == "close" and m.closeReply == "uncertain" and m.outcome == "uncertain"
  val lostCloseUnread = op == "close" and m.outcome == "uncertain" and
    m.closeReply == "lostEnded" and m.srcConn == "up" and m.stillRead == "fail"
  val regenFenced = ended and (m.srcConn == "regen" or m.dstConn == "regen") and m.effects.length() > 1
  val cleanupNamed = ended and m.outcome == "refused" and m.namesCopy and m.copy
}
