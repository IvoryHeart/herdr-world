module runtime_drain {
  pure val BROKEN = false
  type Drain = { kind: int, cleanupFirst: bool, failed: bool, phase: str, gen: int, transportDone: bool, cleanupDone: bool, readySeen: bool, stage: str }
  var drain: Drain
  var op: str
  action init = all {
    drain' = { kind: -1, cleanupFirst: false, failed: false, phase: "absent", gen: 0, transportDone: false, cleanupDone: false, readySeen: false, stage: "empty" }, op' = "init",
  }
  action choose = {
    nondet kind = 0.to(5).oneOf()
    nondet cleanupFirst = Set(false, true).oneOf()
    nondet failed = Set(false, true).oneOf()
    all {
      Set("empty", "done").contains(drain.stage), kind != 5 or not(cleanupFirst),
      drain' = { kind: kind, cleanupFirst: cleanupFirst, failed: failed, phase: "connecting", gen: 1,
        transportDone: false, cleanupDone: false, readySeen: false, stage: "starting" }, op' = "choose",
    }
  }
  action retire = all {
    drain.stage == "starting",
    drain' = { ...drain, phase: if (drain.kind >= 4) "error" else "stopping",
      gen: if (drain.kind == 1) 3 else 2, transportDone: drain.kind == 5, stage: "draining" }, op' = "retire",
  }
  pure def finishedPhase(s) = if (s.kind == 2) "removed" else if (s.failed or s.kind >= 4) "error" else "disconnected"
  action finishFirst = all {
    drain.stage == "draining", drain.kind != 5,
    drain' = { ...drain, cleanupDone: drain.cleanupFirst, transportDone: not(drain.cleanupFirst),
      readySeen: BROKEN and not(drain.cleanupFirst), stage: "half" }, op' = "finishFirst",
  }
  action finishSecond = all {
    drain.stage == "half" or (drain.stage == "draining" and drain.kind == 5),
    drain' = { ...drain, cleanupDone: true, transportDone: true,
      readySeen: drain.readySeen or (BROKEN and drain.kind != 5),
      phase: finishedPhase(drain), stage: "done" }, op' = "finishSecond",
  }
  action step = any { choose, retire, finishFirst, finishSecond }
  val noRetiredReadiness = not(drain.readySeen)
  val drainBeforeRemoval = drain.phase != "removed" or (drain.transportDone and drain.cleanupDone)
  val safety = noRetiredReadiness and drainBeforeRemoval
  val replacedDuringStart = drain.stage == "done" and drain.kind == 1
  val removedDuringStart = drain.stage == "done" and drain.kind == 2
  val shutdownDuringStart = drain.stage == "done" and drain.kind == 3
  val currentErrorDuringStart = drain.stage == "done" and drain.kind == 4
  val failedStart = drain.stage == "done" and drain.kind == 5
  val cleanupBeforeTransport = drain.stage == "done" and drain.cleanupFirst
  val transportBeforeCleanup = drain.stage == "done" and not(drain.cleanupFirst)
  val failedDrain = drain.stage == "done" and drain.failed
}
