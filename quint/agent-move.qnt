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
  // harness: what a second resume of an open conversation does (probe
  // 2026-11-23, verification/contracts/agent-move-audit.md). "resume"
  // re-attaches to the same conversation (Claude), so the copy starts before
  // the original closes. "lock" waits on a lock screen until the original
  // closes (Codex), so the original closes first. "fork" would start a new
  // conversation and say so: the copy is dropped and the original closes
  // first. Close-first resumes the agent back where it was when the new start
  // fails, and names the saved conversation when that fails too.
  //
  // route "native": both connections reach one runtime (two views of one
  // Herdr, or one core): the runtime moves the desk and nothing closes.
  //
  // again: a second move asked once this one settled ("early": inside the
  // settle window, refused before anything acts; "late": admitted).
  //
  // Scenario choices are drawn from weighted integer ranges so the simulator
  // reaches rare paths often; TLC explores every choice either way.
  //
  // FAULT selects one broken rule (negative controls; each must violate
  // safety): no-recheck closes without reading the source again after the
  // desk moved; fallback lets a call on a reconnected side reach the new
  // generation; assume-alive takes an unreadable source after a lost close
  // reply as still running and drops the copy; unnamed-start reports a lost
  // start reply without saying the copy may run; start-first-lock starts a
  // locking harness before its original closes; no-fork-guard keeps a copy
  // that reported another conversation; native-handoff kills and resumes an
  // agent whose connections are one runtime.
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
    envStart: str, envRehome: str, envClose: str,
    harness: str, route: str, closeFirst: bool, copyConv: bool,
    namesSaved: bool, resumeReply: str, resumeTruth: bool,
    resumeCleanup: str, resumeCleanupTruth: bool, backReply: str,
    backTruth: bool, nativeReply: str, again: str }
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
    nondet h = 0.to(3).oneOf()
    nondet rt = 0.to(4).oneOf()
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
        envStart: "-", envRehome: "-", envClose: "-",
        harness: if (h == 0) "lock" else if (h == 1) "fork" else "resume", route: if (rt == 0) "native" else "across",
        closeFirst: false, copyConv: false, namesSaved: false,
        resumeReply: "-", resumeTruth: false, resumeCleanup: "-",
        resumeCleanupTruth: false, backReply: "-", backTruth: false,
        nativeReply: "-", again: "-" },
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
    m' = if (m.route == "native" and not(fault("native-handoff"))) { ...m, pc: "native" }
      else if (m.shape != "idle") done(m, "refused", m.shape)
      else if (m.harness == "lock" and not(fault("start-first-lock")))
        { ...m, pc: "cfClose", closeFirst: true }
      else { ...m, pc: "start" },
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
    // Started beside its open original, only a re-attaching harness
    // continues the agent's own conversation.
    val x = { ...fx(m, "start"), startReply: reply, startTruth: truth and reply == "lost",
      copyConv: m.harness == "resume" }
    all {
      m.pc == "start",
      m' = if (reply == "ready")
          outside({ ...x, copy: true, pc: "recheck",
            envStart: eventName(x, e, false) }, e, false)
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
        // The copy reports another conversation: drop it, close first.
        else if (m.harness == "fork" and not(fault("no-fork-guard"))) {
          val y = discard(m, cu, truth)
          if (y.namesCopy) done(y, "refused", "start") else { ...y, pc: "cfClose", closeFirst: true }
        }
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
  // Close-first: the original closes, then the copy resumes its
  // conversation. An outside event may land as the close is asked.
  action cfClose = {
    nondet c = 0.to(479).oneOf()
    val r = c % 6
    val closeTruth = (c / 6) % 2 == 1
    val read = (c / 12) % 2
    val e = c / 24
    val w = outside({ ...m, envClose: eventName(m, e, true) }, e, true)
    val reply = if (r == 0) "lostEnded" else if (r == 1) "lostAlive"
      else if (r == 2 and coreSource(w.dir)) "uncertain" else "ended"
    val x = { ...fx(w, "close"), closeReply: reply,
      closeTruth: closeTruth and reply == "uncertain" }
    val refusedKill = x.src == "child"
    val ends = reaches(x.srcConn) and not(refusedKill) and
      (reply == "ended" or reply == "lostEnded" or (reply == "uncertain" and closeTruth))
    val threw = not(reaches(x.srcConn)) or refusedKill or
      reply == "lostEnded" or reply == "lostAlive"
    val readOk = threw and x.srcConn == "up" and read == 1
    val y = { ...x, alive: x.alive and not(ends),
      closedBusy: x.closedBusy or (ends and x.src != "idle"),
      unfenced: x.unfenced or (ends and fenceSlip(x.srcConn)),
      stillRead: if (not(threw)) "-" else if (readOk) "ok" else "fail" }
    all {
      m.pc == "cfClose",
      // Nothing started yet: a close that failed, or can't be confirmed,
      // stops here and names the saved conversation.
      m' = if (not(threw) and reply == "uncertain") done({ ...y, namesSaved: true }, "refused", "close")
        else if (not(threw) or (readOk and not(y.alive))) { ...y, pc: "cfStart" }
        else if (readOk) done(y, "refused", "close")
        else done({ ...y, namesSaved: true }, "refused", "close"),
      op' = "cfClose",
    }
  }
  // The copy resumes the conversation; if it doesn't start, the agent
  // resumes back where it was; if that fails too, the report names it.
  action cfStart = {
    nondet c = 0.to(4095).oneOf()
    val r = c % 8
    val truth = (c / 8) % 2 == 1
    val cu = (c / 16) % 4
    val cuTruth = (c / 64) % 2 == 1
    val b = (c / 128) % 4
    val bTruth = (c / 512) % 2 == 1
    val pinOk = (c / 1024) % 2 == 1
    val boardOk = c / 2048 == 1
    // A destination that reconnected during the close refuses the call:
    // World sees a lost reply and nothing starts there.
    val reached = reaches(m.dstConn)
    val reply = if (not(reached) or r == 2) "lost" else if (r == 0) "failed"
      else if (r == 1) "partial" else "ready"
    val back = if (b == 0) "failed" else if (b == 1) "lost" else "ready"
    val x = { ...fx(m, "start"), resumeReply: reply, resumeTruth: truth and reached and reply == "lost",
      copyConv: true }
    val pinReply = if (m.pinned) (if (pinOk) "ok" else "fail") else "-"
    // A partial copy is closed; a lost reply may have left one running.
    val left = if (reply == "partial") {
        val rc = if (cu == 0) "uncertain" else if (cu == 1) "throws" else "ended"
        val z = { ...fx(x, "discard"), resumeCleanup: rc, resumeCleanupTruth: cuTruth }
        if (rc == "ended") z else { ...z, copy: cuTruth, namesCopy: true }
      } else if (reply == "lost") { ...x, copy: x.resumeTruth, namesCopy: true }
      else x
    val resumed = { ...fx(left, "resume"), backReply: back, backTruth: bTruth and back == "lost" }
    all {
      m.pc == "cfStart",
      m' = if (reply == "ready") {
          val y = { ...x, copy: true, pinReply: pinReply }
          val z = if (m.pinned) fx(y, "pin") else y
          // The original has closed: a desk that can't follow is reported.
          if (pinReply == "fail") done({ ...z, namesDesk: true }, "moved", "")
          else if (boardOk) done({ ...fx(z, "rehome"), rehomeReply: "ok", desk: "dst" }, "moved", "")
          else done({ ...z, rehomeReply: "fail", namesDesk: true }, "moved", "")
        }
        else if (back == "ready") {
          // Back where it was; its desk follows the new terminal there.
          val y = { ...resumed, alive: true, pinReply: pinReply }
          val z = if (m.pinned) fx(y, "pin") else y
          if (pinReply == "fail") done({ ...z, namesDesk: true }, "refused", "start")
          else done({ ...fx(z, "unhome"), unhomeReply: if (boardOk) "ok" else "fail",
            namesDesk: not(boardOk) }, "refused", "start")
        }
        else done({ ...resumed, alive: back == "lost" and bTruth, namesSaved: true }, "refused", "resume"),
      op' = "cfStart",
    }
  }
  // Two views of one runtime: the runtime moves the desk itself.
  action native = {
    nondet r = 0.to(5).oneOf()
    val reply = if (r == 0) "refused" else if (r == 1) "rolledBack" else if (r == 2) "kept" else "moved"
    val x = { ...fx(m, "native"), nativeReply: reply }
    all {
      m.pc == "native",
      m' = if (reply == "moved") done({ ...x, desk: "dst" }, "moved", "")
        else if (reply == "kept") done({ ...x, namesOrig: true }, "uncertain", "native")
        else done(x, "refused", "native"),
      op' = "native",
    }
  }
  // A second move of the same agent once this one landed.
  action again = {
    nondet early = Set(false, true).oneOf()
    all {
      m.pc == "done", m.again == "-",
      m.outcome == "moved" or m.outcome == "uncertain",
      m' = { ...m, again: if (early) "early" else "late" },
      op' = "again",
    }
  }
  action settled = all { m.pc == "done", m' = m, op' = "settled" }
  action step = any { admit, start, recheck, recheck2, close, cfClose, cfStart, native, again, settled }

  val ended = m.pc == "done"
  // Once settled exactly one runs, unless the report names the one that may
  // also run, or the person closed the source themselves.
  val oneOwner = not(ended) or
    (m.alive != m.copy) or (m.alive and m.copy and (m.namesCopy or m.namesOrig)) or
    (not(m.alive) and not(m.copy) and (m.gone or m.namesSaved))
  // A failed move leaves the source running and its desk with it, with a reason.
  val refusedIntact = m.outcome != "refused" or
    ((m.alive or m.gone or m.namesSaved) and m.reason != "" and (m.desk == "src" or m.namesDesk) and
      (not(m.copy) or m.namesCopy))
  // A moved agent continues its own conversation in one place. Close-first
  // can't undo a Board that refused the desk once the original closed: the
  // agent moved, and the report says its desk details stayed behind.
  val movedClean = m.outcome != "moved" or
    (m.route == "native" and m.alive and not(m.copy) and m.desk == "dst" and m.effects == ["native"]) or
    (not(m.alive) and m.copy and m.copyConv and
      (m.desk == "dst" or (m.closeFirst and m.namesDesk and (m.pinReply == "fail" or m.rehomeReply == "fail"))))
  val uncertainNamed = m.outcome != "uncertain" or (m.copy and m.desk == "dst" and m.namesOrig) or
    (m.route == "native" and m.alive and not(m.copy) and m.namesOrig)
  // One runtime: nothing closes or restarts, whatever the runtime answers.
  val nativeKeeps = m.route != "native" or not(ended) or
    (m.alive and not(m.copy) and m.effects == ["native"])
  // A busy, split or child-starting source is refused before anything starts.
  val admission = m.shape == "idle" or m.effects.length() == 0 or m.route == "native"
  val safety = oneOwner and refusedIntact and movedClean and uncertainNamed and
    admission and nativeKeeps and not(m.closedBusy) and not(m.unfenced) and
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
  val forkClosedFirst = op == "cfStart" and m.harness == "fork" and m.outcome == "moved"
  val lockClosedFirst = op == "cfStart" and m.harness == "lock" and m.outcome == "moved"
  val resumedBack = op == "cfStart" and m.backReply == "ready"
  val savedNamed = ended and m.namesSaved
  val nativeMoved = op == "native" and m.outcome == "moved"
  val settleRefused = op == "again" and m.again == "early"
}
